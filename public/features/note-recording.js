import { MAX_NOTES, sectionProject } from '../../shared/project.js';

// A take belongs to the project, section, and track armed at its start.
export function createNoteRecording({
  state,
  markDirty,
  renderRoll,
  renderTracks,
  releaseAllKeys,
  notify,
}) {
  let take = null;
  let historyProject = null;
  const lastPasses = new Map();

  function resetHistory() {
    if (historyProject !== state.project) {
      lastPasses.clear();
      historyProject = state.project;
    }
  }

  function prepare(rerecord = false) {
    resetHistory();
    const key = `${state.selectedSectionId ?? ''}:${state.selectedTrackId}`;
    const previousIds = rerecord ? lastPasses.get(key) : new Set();
    if (!previousIds) {
      notify('No previous recording pass on this instrument in this session.', true);
      return null;
    }
    const sectionId = state.selectedSectionId;
    const project = structuredClone(sectionProject(state.project, sectionId));
    const track = project.tracks.find((track) => track.id === state.selectedTrackId);
    track.notes = track.notes.filter((note) => !previousIds.has(note.id));
    return { project, sectionId, trackId: track.id, sourceProject: state.project, previousIds };
  }

  function begin(capture, prepared) {
    resetHistory();
    // Delete only after the engine successfully starts, so a failed restart loses no notes.
    const project = prepared?.sourceProject ?? state.project;
    const sectionId = prepared?.sectionId ?? state.selectedSectionId;
    if (prepared && project === state.project) {
      const track = sectionProject(project, sectionId).tracks.find(
        (track) => track.id === capture.trackId,
      );
      const remaining = track.notes.filter((note) => !prepared.previousIds.has(note.id));
      if (remaining.length !== track.notes.length) {
        track.notes = remaining;
        markDirty();
        renderRoll();
        renderTracks();
      }
    }
    take = {
      id: capture.id,
      project,
      sectionId,
      seen: new Set(),
      addedIds: new Set(),
      added: 0,
      skipped: 0,
    };
  }

  function update(capture) {
    if (!take || !capture || capture.id !== take.id || state.project !== take.project) return;
    const track = sectionProject(take.project, take.sectionId).tracks.find(
      (track) => track.id === capture.trackId,
    );
    let changed = false;
    for (const note of capture.notes) {
      if (take.seen.has(note.id)) continue;
      take.seen.add(note.id);
      const overlaps = track?.notes.some(
        (other) =>
          other.midi === note.midi &&
          note.start < other.start + other.length &&
          other.start < note.start + note.length,
      );
      if (!track || track.notes.length >= MAX_NOTES || overlaps) {
        take.skipped++;
        continue;
      }
      track.notes.push({ ...note });
      take.addedIds.add(note.id);
      take.added++;
      changed = true;
    }
    if (changed) {
      markDirty();
      renderRoll();
      renderTracks();
    }
    if (capture.phase === 'finished') {
      lastPasses.set(`${take.sectionId ?? ''}:${capture.trackId}`, take.addedIds);
      releaseAllKeys();
      notify(
        `Recorded ${take.added} notes.${take.skipped ? ` Skipped ${take.skipped} conflicting notes or notes beyond the track limit.` : ''}`,
      );
      take = null;
    }
  }

  return { prepare, begin, update };
}
