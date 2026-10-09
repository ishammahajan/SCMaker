// Stable entry point for music-domain functions used by the UI, server, and tests.
export { KINDS, WAVES, CONTROLS, preset, validateRecipe, noteName } from './instruments.js';
export { STEPS, MAX_TRACKS, validateProject, makeTrack, defaultProject } from './project.js';
export { interpretPrompt } from './prompts.js';
export { synthDef } from './synthdef.js';
