import { preset, validateRecipe } from './instruments.js';
import { synthDef } from './synthdef.js';
import { assert, number, text } from './validation.js';

/**
 * @typedef {import('./instruments.js').Recipe} Recipe
 *
 * @typedef {object} Note
 * @property {string} id
 * @property {number} start Sixteenth step from 0 to STEPS - 1.
 * @property {number} length Whole steps.
 * @property {number} midi
 * @property {number} velocity
 *
 * @typedef {object} SoundVersion
 * @property {string} prompt
 * @property {Recipe} recipe
 * @property {string} code Canonical SynthDef generated from the recipe.
 *
 * @typedef {object} Track
 * @property {string} id
 * @property {string} name
 * @property {Recipe} recipe
 * @property {string} code
 * @property {number} volume
 * @property {number} reverb
 * @property {boolean} muted
 * @property {Note[]} notes
 * @property {SoundVersion[]} history
 *
 * @typedef {object} LoopProject Version-one loop, also used for section snapshots.
 * @property {1} version
 * @property {string} name
 * @property {number} tempo
 * @property {Track[]} tracks
 *
 * @typedef {object} Section
 * @property {string} id
 * @property {string} name
 * @property {Track[]} tracks
 *
 * @typedef {object} ArrangementEntry
 * @property {string} sectionId
 * @property {number} repeats
 *
 * @typedef {object} SongProject
 * @property {2} version
 * @property {string} name
 * @property {number} tempo
 * @property {Section[]} sections
 * @property {ArrangementEntry[]} arrangement
 *
 * @typedef {LoopProject | SongProject} Project
 */

export const STEPS = 32;
export const MIN_MIDI = 24;
export const MAX_MIDI = 96;
export const MAX_NOTES = 256;
// Bound serialized project data, not the number of instruments.
export const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
export const MAX_SECTIONS = 16;
export const MAX_ARRANGEMENT = 32;
const clone = (value) => structuredClone(value);

/** @returns {SoundVersion} */
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

/** @returns {Project} */
export function validateProject(value) {
  return value?.version === 2 ? validateSong(value) : validateLoop(value);
}

/** @returns {LoopProject} */
function validateLoop(value) {
  assert(value && value.version === 1, 'Unsupported project format.');
  const name = text(value.name, 100, 'project name');
  const tempo = number(value.tempo, 40, 240, 'tempo');
  assert(Array.isArray(value.tracks) && value.tracks.length >= 1, 'Use at least one instrument.');
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
    assert(Array.isArray(track.notes) && track.notes.length <= MAX_NOTES, 'Too many notes.');
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
      const midi = number(note.midi, MIN_MIDI, MAX_MIDI, 'pitch');
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

/** @returns {SongProject} */
function validateSong(value) {
  const name = text(value.name, 100, 'project name');
  const tempo = number(value.tempo, 40, 240, 'tempo');
  assert(
    Array.isArray(value.sections) &&
      value.sections.length >= 1 &&
      value.sections.length <= MAX_SECTIONS,
    'Use one to sixteen sections.',
  );
  const ids = new Set();
  const sections = value.sections.map((section) => {
    assert(
      section && /^s_[a-z0-9_]{1,40}$/.test(section.id) && !ids.has(section.id),
      'Invalid or duplicate section ID.',
    );
    ids.add(section.id);
    const sectionName = text(section.name, 60, 'section name');
    const { tracks } = validateLoop({ version: 1, name, tempo, tracks: section.tracks });
    return { id: section.id, name: sectionName, tracks };
  });
  assert(
    Array.isArray(value.arrangement) &&
      value.arrangement.length >= 1 &&
      value.arrangement.length <= MAX_ARRANGEMENT,
    'Use one to thirty-two arrangement entries.',
  );
  const arrangement = value.arrangement.map((entry) => {
    assert(entry && ids.has(entry.sectionId), 'Unknown arrangement section.');
    const repeats = number(entry.repeats, 1, 16, 'section repeats');
    assert(Number.isInteger(repeats), 'Section repeats must be whole numbers.');
    return { sectionId: entry.sectionId, repeats };
  });
  return { version: 2, name, tempo, sections, arrangement };
}

// Legacy loops remain valid. The browser upgrades them without reinterpreting sounds.
/** @returns {SongProject} */
export function makeSong(value) {
  const project = validateProject(value);
  if (project.version === 2) return project;
  return {
    version: 2,
    name: project.name,
    tempo: project.tempo,
    sections: [{ id: 's_first', name: 'Section 1', tracks: project.tracks }],
    arrangement: [{ sectionId: 's_first', repeats: 1 }],
  };
}

/**
 * @param {Project} project
 * @param {string} sectionId
 * @returns {LoopProject}
 */
export function sectionProject(project, sectionId) {
  if (project.version === 1) return project;
  const section = project.sections.find((section) => section.id === sectionId);
  assert(section, 'Unknown section.');
  return { version: 1, name: project.name, tempo: project.tempo, tracks: section.tracks };
}

/** @returns {Track} */
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
/** @returns {Project} */
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
