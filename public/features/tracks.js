import { $, element } from '../ui/dom.js';
import { MAX_TRACKS, makeTrack } from '/shared/music.js';
import { TRACK_COLORS } from '../state.js';

export function createTracks({ state, markDirty, selectTrack, openWorkshop }) {
  function renderTracks() {
    $('track-count').textContent = `${state.project.tracks.length} / ${MAX_TRACKS}`;
    $('add-track').disabled = state.project.tracks.length >= MAX_TRACKS;
    $('tracks').replaceChildren();
    state.project.tracks.forEach((track, index) => {
      const card = element(
        'div',
        `track-card${track.id === state.selectedTrackId ? ' selected' : ''}`,
      );
      card.style.setProperty('--track-color', TRACK_COLORS[index]);
      const head = element('div', 'track-head');
      head.append(element('span', 'track-number', `0${index + 1}`));
      const select = element('button', 'track-select');
      select.setAttribute('aria-pressed', String(track.id === state.selectedTrackId));
      select.append(
        element('strong', '', track.name),
        element('small', '', `${track.recipe.kind} · ${track.notes.length} notes`),
      );
      select.onclick = () => selectTrack(track.id);
      const mute = element('button', 'mute', 'M');
      mute.setAttribute('aria-label', `Mute ${track.name}`);
      mute.setAttribute('aria-pressed', String(track.muted));
      mute.onclick = () => {
        track.muted = !track.muted;
        markDirty();
        renderTracks();
      };
      head.append(select, mute);
      card.append(head);
      for (const [key, label] of [
        ['volume', 'Level'],
        ['reverb', 'Verb'],
      ]) {
        const row = element('label', 'track-control');
        const slider = element('input');
        slider.type = 'range';
        slider.min = 0;
        slider.max = 100;
        slider.value = Math.round(track[key] * 100);
        slider.setAttribute('aria-label', `${label} for ${track.name}`);
        const output = element('output', '', slider.value);
        slider.oninput = () => {
          track[key] = Number(slider.value) / 100;
          output.value = slider.value;
          markDirty();
        };
        row.append(element('span', '', label), slider, output);
        card.append(row);
      }
      $('tracks').append(card);
    });
  }

  $('add-track').onclick = () => {
    $('new-name').value = `Voice 0${state.project.tracks.length + 1}`;
    $('add-dialog').showModal();
  };
  $('cancel-add').onclick = () => $('add-dialog').close();
  $('add-form').onsubmit = (event) => {
    event.preventDefault();
    if (state.project.tracks.length >= MAX_TRACKS) return;
    const track = makeTrack(
      $('new-kind').value,
      `t_${crypto.randomUUID().replaceAll('-', '')}`,
      $('new-name').value.trim().slice(0, 60) || 'New voice',
    );
    state.project.tracks.push(track);
    $('add-dialog').close();
    selectTrack(track.id);
    markDirty();
    if (track.recipe.kind === 'custom') {
      $('prompt-provider').value = 'llm';
      $('prompt-mode').value = 'create';
      $('prompt').value = '';
    } else {
      $('prompt-mode').value = 'refine';
    }
    openWorkshop();
  };

  return { render: renderTracks };
}
