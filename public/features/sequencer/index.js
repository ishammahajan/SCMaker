import { $, element } from '../../ui/dom.js';
import { currentTrack, trackColor } from '../../state.js';
import { STEPS, noteName } from '/shared/music.js';
import { bindNoteDrag } from './note-drag.js';

export function createSequencer({ state, notify, markDirty, renderTracks }) {
  const getCurrentTrack = () => currentTrack(state);
  let selectedNoteId = null;
  let rollBase = 36;
  function updateNoteTools() {
    const note = getCurrentTrack().notes.find((note) => note.id === selectedNoteId);
    $('delete-note').disabled = !note;
    if (note) {
      $('note-length').value = note.length;
      $('note-velocity').value = Math.round(note.velocity * 100);
    }
    $('velocity-value').value = `${$('note-velocity').value}%`;
  }
  function noteOverlaps(note, start, midi, length) {
    return getCurrentTrack().notes.some(
      (other) =>
        other.id !== note.id &&
        other.midi === midi &&
        start < other.start + other.length &&
        other.start < start + length,
    );
  }
  function noteMoveTarget(note, start, midi) {
    const nextStart = Math.max(0, Math.min(STEPS - note.length, start));
    const nextMidi = Math.max(rollBase, Math.min(rollBase + 24, midi));
    return { start: nextStart, midi: nextMidi };
  }
  function moveNote(note, start, midi) {
    const { start: nextStart, midi: nextMidi } = noteMoveTarget(note, start, midi);
    if (noteOverlaps(note, nextStart, nextMidi, note.length)) {
      notify('That space already has a note on this pitch.', true);
      return false;
    }
    selectedNoteId = note.id;
    if (note.start === nextStart && note.midi === nextMidi) {
      renderRoll();
      return true;
    }
    note.start = nextStart;
    note.midi = nextMidi;
    markDirty();
    renderRoll();
    renderTracks();
    return true;
  }
  function noteLengthTarget(note, length) {
    return Math.max(1, Math.min(STEPS - note.start, Math.floor(length)));
  }
  function resizeNote(note, length) {
    const nextLength = noteLengthTarget(note, length);
    if (noteOverlaps(note, note.start, note.midi, nextLength)) {
      notify('That space already has a note on this pitch.', true);
      return false;
    }
    selectedNoteId = note.id;
    if (note.length !== nextLength) {
      note.length = nextLength;
      markDirty();
      renderTracks();
    }
    renderRoll();
    return true;
  }
  function rollPointToStepMidi(event) {
    const roll = $('piano-roll');
    const first = roll.querySelector('.cell').getBoundingClientRect();
    const bottomRight = roll
      .querySelector(`.cell[data-start="${STEPS - 1}"][data-midi="${rollBase}"]`)
      .getBoundingClientRect();
    const viewport = roll.parentElement.getBoundingClientRect();
    // Measure the cells, including grid gaps, rather than duplicating CSS dimensions.
    const stepWidth = (bottomRight.left - first.left) / (STEPS - 1);
    const rowHeight = (bottomRight.top - first.top) / 24;
    const { clientX: x, clientY: y } = event;
    if (
      x < Math.max(first.left, viewport.left) ||
      x >= Math.min(bottomRight.right, viewport.right) ||
      y < first.top ||
      y >= bottomRight.bottom
    )
      return null;
    const start = Math.floor((x - first.left) / stepWidth);
    const row = Math.floor((y - first.top) / rowHeight);
    return { start, midi: rollBase + 24 - row };
  }
  function renderRoll() {
    const track = getCurrentTrack();
    $('sequencer-heading').replaceChildren(
      document.createTextNode(`${track.name} `),
      element('span', 'muted', 'sequence'),
    );
    $('roll-range').textContent = `${noteName(rollBase)}–${noteName(rollBase + 24)}`;
    const offscreen = track.notes.filter(
      (note) => note.midi < rollBase || note.midi > rollBase + 24,
    ).length;
    $('note-count').textContent =
      `${track.notes.length} notes${offscreen ? ` · ${offscreen} outside this octave view` : ''}`;
    $('piano-roll').replaceChildren();
    $('piano-roll').style.setProperty('--track-color', trackColor(state));
    $('piano-roll').append(element('div', 'step-label', 'NOTE'));
    for (let step = 0; step < STEPS; step++) {
      const label = element(
        'div',
        `step-label${step % 4 === 0 ? ' beat' : ''}`,
        step % 4 === 0 ? `${Math.floor(step / 16) + 1}.${Math.floor((step % 16) / 4) + 1}` : '·',
      );
      label.dataset.step = step;
      $('piano-roll').append(label);
    }
    renderPitchRows(track);
    track.notes.forEach(renderNote);
    const head = element('div', 'playhead');
    head.id = 'playhead';
    head.style.gridRow = '2 / span 25';
    $('piano-roll').append(head);
    paintStep();
    updateNoteTools();
  }
  function deleteNote() {
    getCurrentTrack().notes = getCurrentTrack().notes.filter((note) => note.id !== selectedNoteId);
    selectedNoteId = null;
    markDirty();
    renderRoll();
    renderTracks();
  }
  function paintStep() {
    const step = state.engine.playing ? state.engine.step : -1;
    $('playhead').hidden = step < 0;
    if (step >= 0) $('playhead').style.gridColumn = step + 2;
    document
      .querySelectorAll('.step-label[data-step]')
      .forEach((node) => node.classList.toggle('current', Number(node.dataset.step) === step));
  }

  function renderPitchRows(track) {
    for (let midi = rollBase + 24; midi >= rollBase; midi--) {
      const black = [1, 3, 6, 8, 10].includes(midi % 12);
      const row = rollBase + 24 - midi + 2;
      const label = element('div', `pitch-label${black ? ' black' : ''}`, noteName(midi));
      label.style.gridRow = row;
      label.style.gridColumn = 1;
      $('piano-roll').append(label);
      for (let step = 0; step < STEPS; step++) {
        const cell = element(
          'button',
          `cell${black ? ' black' : ''}${step % 4 === 0 ? ' beat' : ''}`,
        );
        cell.dataset.start = step;
        cell.dataset.midi = midi;
        cell.style.gridRow = row;
        cell.style.gridColumn = step + 2;
        cell.setAttribute('aria-label', `Add ${noteName(midi)} at step ${step + 1}`);
        cell.tabIndex = midi === rollBase + 12 && step === 0 ? 0 : -1;
        cell.onclick = () => {
          const overlap = track.notes.find(
            (note) => note.midi === midi && step >= note.start && step < note.start + note.length,
          );
          if (overlap) {
            selectedNoteId = overlap.id;
            renderRoll();
            return;
          }
          if (track.notes.length >= 256) {
            notify('This instrument has reached the 256-note limit.', true);
            return;
          }
          const length = Math.min(
            STEPS - step,
            Math.max(1, Math.floor(Number($('note-length').value) || 1)),
          );
          const note = {
            id: `n_${crypto.randomUUID().replaceAll('-', '')}`,
            start: step,
            midi,
            length,
            velocity: Number($('note-velocity').value) / 100,
          };
          track.notes.push(note);
          selectedNoteId = note.id;
          markDirty();
          renderRoll();
          renderTracks();
        };
        cell.onkeydown = (event) => {
          const moves = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, 1],
            ArrowDown: [0, -1],
          };
          const move = moves[event.key];
          if (!move) return;
          event.preventDefault();
          $('piano-roll')
            .querySelector(
              `[data-start="${Math.max(0, Math.min(31, step + move[0]))}"][data-midi="${Math.max(rollBase, Math.min(rollBase + 24, midi + move[1]))}"]`,
            )
            ?.focus();
        };
        $('piano-roll').append(cell);
      }
    }
  }
  function renderNote(note) {
    if (note.midi < rollBase || note.midi > rollBase + 24) return;
    const button = element('button', `roll-note${selectedNoteId === note.id ? ' selected' : ''}`);
    const label = element('span', 'note-label', note.length > 1 ? noteName(note.midi) : '');
    const remove = element('span', 'note-remove', '×');
    remove.title = `Delete ${noteName(note.midi)} note`;
    remove.setAttribute('aria-hidden', 'true');
    const resize = element('span', 'note-resize');
    resize.title = 'Drag to change note length';
    resize.setAttribute('aria-hidden', 'true');
    button.replaceChildren(label, remove, resize);
    button.dataset.noteId = note.id;
    button.style.gridRow = rollBase + 24 - note.midi + 2;
    button.style.gridColumn = `${note.start + 2} / span ${note.length}`;
    button.style.opacity = 0.45 + note.velocity * 0.55;
    button.setAttribute(
      'aria-label',
      `${noteName(note.midi)}, step ${note.start + 1}, ${note.length} steps, velocity ${Math.round(note.velocity * 100)}. Select note, drag to move, drag right edge or press Shift+Left/Right to resize, or press Delete to remove`,
    );
    button.onclick = () => {
      if (drag.wasDragged()) return;
      selectedNoteId = note.id;
      renderRoll();
      focusNote(note.id);
    };
    remove.onclick = (event) => {
      event.stopPropagation();
      selectedNoteId = note.id;
      deleteNote();
    };
    button.ondblclick = () => {
      selectedNoteId = note.id;
      deleteNote();
    };
    const drag = bindNoteDrag(button, {
      note,
      remove,
      resize,
      rollBase,
      pointToNote: rollPointToStepMidi,
      resolveTarget: noteMoveTarget,
      resolveLength: noteLengthTarget,
      overlaps: noteOverlaps,
      selectNote: () => {
        selectedNoteId = note.id;
      },
      dropNote: (target) => {
        const committed =
          target.length === undefined
            ? moveNote(note, target.start, target.midi)
            : resizeNote(note, target.length);
        if (committed) focusNote(note.id);
      },
    });
    button.onkeydown = (event) => {
      const moves = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, 1],
        ArrowDown: [0, -1],
      };
      if (['Delete', 'Backspace'].includes(event.key)) {
        event.preventDefault();
        selectedNoteId = note.id;
        deleteNote();
        return;
      }
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      if (event.shiftKey && move[0]) resizeNote(note, note.length + move[0]);
      else moveNote(note, note.start + move[0], note.midi + move[1]);
      focusNote(note.id);
    };
    $('piano-roll').append(button);
  }
  function focusNote(id) {
    $('piano-roll').querySelector(`[data-note-id="${id}"]`)?.focus({ preventScroll: true });
  }

  function selectTrack() {
    selectedNoteId = null;
    const track = getCurrentTrack();
    rollBase = ['pad', 'pluck'].includes(track.recipe.kind)
      ? 48
      : track.recipe.kind === 'hat'
        ? 60
        : 36;
    if (track.notes.length) {
      const min = Math.min(...track.notes.map((n) => n.midi));
      const max = Math.max(...track.notes.map((n) => n.midi));
      if (min < rollBase || max > rollBase + 24)
        rollBase = Math.min(72, Math.max(24, Math.floor(min / 12) * 12));
    }

    return rollBase;
  }

  $('note-length').onchange = () => {
    const note = getCurrentTrack().notes.find((note) => note.id === selectedNoteId);
    const length = Math.max(
      1,
      Math.min(note ? STEPS - note.start : STEPS, Math.floor(Number($('note-length').value) || 1)),
    );
    $('note-length').value = length;
    if (note) {
      note.length = length;
      markDirty();
      renderRoll();
    }
  };
  $('note-velocity').oninput = () => {
    const note = getCurrentTrack().notes.find((note) => note.id === selectedNoteId);
    $('velocity-value').value = `${$('note-velocity').value}%`;
    if (note) {
      note.velocity = Number($('note-velocity').value) / 100;
      markDirty();
    }
  };
  $('note-velocity').onchange = () => {
    if (selectedNoteId) renderRoll();
  };
  $('delete-note').onclick = deleteNote;
  $('clear-notes').onclick = () => {
    if (
      !getCurrentTrack().notes.length ||
      !confirm(`Clear all notes from ${getCurrentTrack().name}?`)
    )
      return;
    getCurrentTrack().notes = [];
    selectedNoteId = null;
    markDirty();
    renderRoll();
    renderTracks();
  };
  $('octave-down').onclick = () => {
    rollBase = Math.max(24, rollBase - 12);
    renderRoll();
  };
  $('octave-up').onclick = () => {
    rollBase = Math.min(72, rollBase + 12);
    renderRoll();
  };

  return { render: renderRoll, paintStep, selectTrack };
}
