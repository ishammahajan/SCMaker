import { sectionProject } from '../shared/project.js';

/**
 * @typedef {object} StudioState
 * @property {import('../shared/project.js').SongProject} project Null until the studio opens.
 * @property {string} selectedTrackId
 * @property {string} selectedSectionId
 * @property {import('../shared/playback.js').EngineStatus} engine
 */

// Shared session state only. Each feature owns its transient UI state.
/** @returns {StudioState} */
export function createStudioState() {
  return {
    project: null,
    selectedTrackId: null,
    selectedSectionId: null,
    engine: { state: 'starting', playing: false, recording: null, step: -1 },
  };
}

export const TRACK_COLORS = ['#cbef87', '#e2b185', '#bda9df', '#8cbed7'];

/** @param {StudioState} state */
export function currentProject(state) {
  return sectionProject(state.project, state.selectedSectionId);
}

/** @param {StudioState} state */
export function currentTrack(state) {
  return currentProject(state).tracks.find((track) => track.id === state.selectedTrackId);
}

/** @param {StudioState} state */
export function trackColor(state) {
  return TRACK_COLORS[
    currentProject(state).tracks.findIndex((track) => track.id === state.selectedTrackId) %
      TRACK_COLORS.length
  ];
}
