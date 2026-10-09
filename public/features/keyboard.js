import { $, element } from '../ui/dom.js';
import { currentTrack } from '../state.js';
import { noteName } from '/shared/music.js';

export const KEY_MAP = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k'];

export function createKeyboard({ state, api, notify, action }) {
  const heldKeys = new Map();
  const getCurrentTrack = () => currentTrack(state);
  function renderKeyboard() {
    $('keyboard').replaceChildren();
    const base = Number($('keyboard-octave').value);
    for (let offset = 0; offset <= 24; offset++) {
      const midi = base + offset;
      if (midi > 96) continue;
      const black = [1, 3, 6, 8, 10].includes(midi % 12);
      const button = element(
        'button',
        `piano-key${black ? ' black' : ''}`,
        KEY_MAP[offset]?.toUpperCase() || (midi % 12 === 0 ? noteName(midi) : ''),
      );
      button.dataset.midi = midi;
      button.setAttribute('aria-label', `Play ${noteName(midi)}`);
      button.onpointerdown = (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        startKey(`pointer_${event.pointerId}`, midi);
      };
      button.onpointerup = (event) => endKey(`pointer_${event.pointerId}`);
      button.onpointercancel = (event) => endKey(`pointer_${event.pointerId}`);
      button.onlostpointercapture = (event) => endKey(`pointer_${event.pointerId}`);
      // Enter/Space activates one short note for keyboard-only users.
      button.onclick = action(async (event) => {
        if (event.detail === 0) await audition(midi);
      });
      $('keyboard').append(button);
    }
  }
  async function audition(midi) {
    const track = getCurrentTrack();
    await api('audition', {
      recipe: track.recipe,
      midi: midi ?? Number($('keyboard-octave').value),
      reverb: track.reverb,
    });
  }
  function startKey(id, midi) {
    if (heldKeys.has(id) || state.engine.state !== 'ready') return;
    const held = {
      midi,
      trackId: state.selectedTrackId,
      voiceId: `v_${id}`,
      project: structuredClone(state.project),
    };
    heldKeys.set(id, held);
    document.querySelector(`#keyboard [data-midi="${midi}"]`)?.classList.add('held');
    // Capture the track/project so note-off still targets the original voice after selection changes.
    held.started = api('note', { ...held, on: true }).catch((error) => {
      notify(error.message, true);
    });
  }
  async function endKey(id) {
    const held = heldKeys.get(id);
    if (!held) return;
    heldKeys.delete(id);
    if (![...heldKeys.values()].some((item) => item.midi === held.midi))
      document.querySelector(`#keyboard [data-midi="${held.midi}"]`)?.classList.remove('held');
    await held.started;
    try {
      await api('note', {
        midi: held.midi,
        trackId: held.trackId,
        voiceId: held.voiceId,
        project: held.project,
        on: false,
      });
    } catch (error) {
      notify(error.message, true);
    }
  }
  function releaseAllKeys() {
    for (const id of [...heldKeys.keys()]) endKey(id);
  }

  $('keyboard-octave').onchange = () => {
    releaseAllKeys();
    renderKeyboard();
  };

  return { render: renderKeyboard, audition, startKey, endKey, releaseAllKeys };
}
