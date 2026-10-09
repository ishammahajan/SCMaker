import { preset, validateRecipe } from './instruments.js';
import { synthDef } from './synthdef.js';
import { assert, number, text } from './validation.js';

export const STEPS = 32;
export const MAX_TRACKS = 4;
const clone = (value) => structuredClone(value);

function validateSnapshot(value, id) {
  assert(value && typeof value === 'object', 'Invalid sound version.');
  const recipe = validateRecipe(value.recipe);
  const code = synthDef(id, recipe);
  assert(
    value.code === code,
    'The saved SynthDef does not match its recipe. Custom code execution is not supported in this version.',
  );
  return { prompt: text(value.prompt, 1000, 'version description'), recipe, code };
}

export function validateProject(value) {
  assert(value && value.version === 1, 'Unsupported project format.');
  const name = text(value.name, 100, 'project name');
  const tempo = number(value.tempo, 40, 240, 'tempo');
  assert(
    Array.isArray(value.tracks) && value.tracks.length >= 1 && value.tracks.length <= MAX_TRACKS,
    'Use one to four instruments.',
  );
  const ids = new Set();
  const tracks = value.tracks.map((track) => {
    assert(
      track &&
        /^t_[a-z0-9_]{1,40}$/.test(track.id) &&
        track.id !== 't_preview' &&
        !ids.has(track.id),
      'Invalid or duplicate instrument ID.',
    );
    ids.add(track.id);
    const snapshot = validateSnapshot(
      { prompt: 'Current sound', recipe: track.recipe, code: track.code },
      track.id,
    );
    assert(typeof track.muted === 'boolean', 'Invalid mute state.');
    assert(Array.isArray(track.notes) && track.notes.length <= 256, 'Too many notes.');
    const noteIds = new Set();
    const notes = track.notes.map((note) => {
      assert(
        note &&
          typeof note.id === 'string' &&
          /^[a-z0-9_]{1,60}$/.test(note.id) &&
          !noteIds.has(note.id),
        'Invalid or duplicate note ID.',
      );
      noteIds.add(note.id);
      const start = number(note.start, 0, STEPS - 1, 'note start');
      const length = number(note.length, 1, STEPS - start, 'note length');
      const midi = number(note.midi, 24, 96, 'pitch');
      assert(
        [start, length, midi].every(Number.isInteger),
        'Notes must use whole steps and MIDI pitches.',
      );
      return {
        id: note.id,
        start,
        length,
        midi,
        velocity: number(note.velocity, 0.05, 1, 'velocity'),
      };
    });
    assert(
      Array.isArray(track.history) && track.history.length >= 1 && track.history.length <= 40,
      'Invalid sound history.',
    );
    return {
      id: track.id,
      name: text(track.name, 60, 'instrument name'),
      recipe: snapshot.recipe,
      code: snapshot.code,
      volume: number(track.volume, 0, 1, 'level'),
      reverb: number(track.reverb, 0, 1, 'reverb'),
      muted: track.muted,
      notes,
      history: track.history.map((item) => validateSnapshot(item, track.id)),
    };
  });
  return { version: 1, name, tempo, tracks };
}

export function makeTrack(kind, id, name) {
  const recipe = preset(kind);
  const code = synthDef(id, recipe);
  return {
    id,
    name,
    recipe,
    code,
    volume: 0.7,
    muted: false,
    reverb: kind === 'pad' ? 0.35 : 0.05,
    notes: [],
    history: [{ prompt: `${kind} starting point`, recipe: clone(recipe), code }],
  };
}
export function defaultProject() {
  const bass = makeTrack('bass', 't_bass', 'Bass 01');
  bass.notes = [0, 6, 8, 14, 16, 22, 24, 28].map((start, i) => ({
    id: `bass_${i}`,
    start,
    midi: [36, 36, 43, 39, 36, 46, 43, 39][i],
    length: 2,
    velocity: 0.75,
  }));
  const kick = makeTrack('kick', 't_kick', 'Kick 01');
  kick.notes = [0, 8, 16, 24].map((start, i) => ({
    id: `kick_${i}`,
    start,
    midi: 36,
    length: 1,
    velocity: 0.9,
  }));
  const pad = makeTrack('pad', 't_pad', 'Pad 01');
  pad.notes = [48, 55, 60].map((midi, i) => ({
    id: `pad_${i}`,
    start: 0,
    midi,
    length: 28,
    velocity: 0.45,
  }));
  return validateProject({
    version: 1,
    name: 'First light',
    tempo: 108,
    tracks: [bass, kick, pad],
  });
}
