import { sectionProject } from '../shared/project.js';

// Shared session state only. Each feature owns its transient UI state.
export function createStudioState() {
  return {
    project: null,
    selectedTrackId: null,
    selectedSectionId: null,
    engine: { state: 'starting', playing: false, recording: null, step: -1 },
  };
}

export const TRACK_COLORS = ['#cbef87', '#e2b185', '#bda9df', '#8cbed7'];

export function currentProject(state) {
  return sectionProject(state.project, state.selectedSectionId);
}

export function currentTrack(state) {
  return currentProject(state).tracks.find((track) => track.id === state.selectedTrackId);
}

export function trackColor(state) {
  return TRACK_COLORS[
    currentProject(state).tracks.findIndex((track) => track.id === state.selectedTrackId)
  ];
}
