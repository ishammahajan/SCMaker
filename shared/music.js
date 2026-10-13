// Stable entry point for music-domain functions used by the UI, server, and tests.
export { KINDS, WAVES, CONTROLS, preset, validateRecipe, noteName } from './instruments.js';
export {
  STEPS,
  MIN_MIDI,
  MAX_MIDI,
  MAX_NOTES,
  MAX_PROJECT_BYTES,
  MAX_SECTIONS,
  MAX_ARRANGEMENT,
  validateProject,
  makeSong,
  sectionProject,
  makeTrack,
  defaultProject,
} from './project.js';
export { interpretPrompt } from './prompts.js';
export { synthDef } from './synthdef.js';
