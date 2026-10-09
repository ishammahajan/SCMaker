import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoteRecording } from '../public/features/note-recording.js';
import { defaultProject, validateProject } from '../shared/music.js';

function setup() {
  const state = { project: defaultProject() };
  const track = state.project.tracks[0];
  state.selectedTrackId = track.id;
  track.notes = [{ id: 'n_existing', start: 0, midi: 72, length: 4, velocity: 0.8 }];
  const calls = { dirty: 0, roll: 0, tracks: 0, released: 0, notices: [] };
  const recorder = createNoteRecording({
    state,
    markDirty: () => calls.dirty++,
    renderRoll: () => calls.roll++,
    renderTracks: () => calls.tracks++,
    releaseAllKeys: () => calls.released++,
    notify: (message) => calls.notices.push(message),
  });
  const capture = { id: 1, trackId: track.id, phase: 'recording', notes: [] };
  recorder.begin(capture);
  return { state, track, calls, recorder, capture };
}

const note = (id, midi, start, length = 2) => ({ id, midi, start, length, velocity: 0.6 });

test('rerecord removes only the last pass, and only after a successful start', () => {
  const { state, track, recorder, capture } = setup();
  capture.notes = [note('n_first', 76, 4), note('n_skipped', 72, 2)];
  capture.phase = 'finished';
  recorder.update(capture);
  const second = { ...capture, id: 2, notes: [note('n_second', 79, 8)] };
  recorder.begin(second);
  recorder.update(second);
  track.notes.push(note('n_manual', 81, 12));
  // Editing a recorded note does not change its ownership by the previous pass.
  track.notes.find((note) => note.id === 'n_second').start = 10;
  const before = structuredClone(state.project);
  const prepared = recorder.prepare(true);
  assert.deepEqual(state.project, before, 'Preparing or failing a restart must not delete notes.');
  assert.deepEqual(
    prepared.project.tracks[0].notes.map((note) => note.id),
    ['n_existing', 'n_first', 'n_manual'],
  );
  validateProject(prepared.project);
  const replacement = { ...capture, id: 3, phase: 'recording', notes: [] };
  recorder.begin(replacement, prepared);
  assert.deepEqual(track.notes, prepared.project.tracks[0].notes);
  replacement.notes = [note('n_replacement', 79, 8)];
  replacement.phase = 'finished';
  recorder.update(replacement);
  assert.deepEqual(
    recorder.prepare(true).project.tracks[0].notes.map((note) => note.id),
    ['n_existing', 'n_first', 'n_manual'],
  );
});

test('rerecord history is per instrument and cannot affect a new project', () => {
  const { state, track, recorder, capture, calls } = setup();
  assert.equal(recorder.prepare(true), null);
  assert.match(calls.notices.at(-1), /No previous recording pass/);
  capture.notes = [note('n_take', 76, 4)];
  capture.phase = 'finished';
  recorder.update(capture);
  state.selectedTrackId = state.project.tracks[1].id;
  assert.equal(recorder.prepare(true), null);
  state.selectedTrackId = track.id;
  assert.equal(recorder.prepare(true).project.tracks[0].notes.length, 1);
  state.project = structuredClone(state.project);
  assert.equal(recorder.prepare(true), null, 'Even importing the same IDs resets history.');
  assert.equal(state.project.tracks[0].notes.length, 2);
});

test('recorded notes preserve existing notes, reject overlaps, and are applied once', () => {
  const { state, track, calls, recorder, capture } = setup();
  capture.notes = [note('n_conflict', 72, 2), note('n_chord_a', 72, 4), note('n_chord_b', 76, 4)];
  recorder.update(capture);
  assert.deepEqual(
    track.notes.map((note) => note.id),
    ['n_existing', 'n_chord_a', 'n_chord_b'],
  );
  assert.equal(calls.dirty, 1);
  assert.equal(calls.roll, 1);
  assert.equal(calls.tracks, 1);
  validateProject(state.project);
  // A manual deletion during a take must not be undone by repeated status polls.
  track.notes.pop();
  recorder.update(capture);
  assert.equal(track.notes.length, 2);
  assert.equal(calls.dirty, 1);
  capture.phase = 'finished';
  recorder.update(capture);
  recorder.update(capture);
  assert.equal(calls.released, 1);
  assert.match(calls.notices[0], /Recorded 2 notes.*Skipped 1/);
});

test('takes stay attached to the armed project and track, not later selections or imports', () => {
  const { state, track, recorder, capture } = setup();
  state.selectedTrackId = state.project.tracks[1].id;
  capture.notes.push(note('n_take', 76, 4));
  recorder.update(capture);
  assert.equal(track.notes.at(-1).id, 'n_take');
  recorder.update({ ...capture, id: 2, notes: [note('n_other', 79, 8)] });
  assert.equal(track.notes.length, 2);
  state.project = defaultProject();
  const before = structuredClone(state.project);
  recorder.update({ ...capture, phase: 'finished', notes: [note('n_late', 79, 8)] });
  assert.deepEqual(state.project, before);
});

test('recording respects the track note limit and cannot replay an old take after reload', () => {
  const { state, track, calls, recorder, capture } = setup();
  const before = structuredClone(state.project);
  const fresh = createNoteRecording({ state });
  fresh.update({ ...capture, notes: [note('n_old', 76, 4)] });
  assert.deepEqual(state.project, before);
  track.notes = Array.from({ length: 256 }, (_, i) => note(`n_${i}`, 48, 0, 1));
  capture.notes = [note('n_limit', 76, 4)];
  capture.phase = 'finished';
  recorder.update(capture);
  assert.equal(track.notes.length, 256);
  assert.equal(calls.dirty, 0);
  assert.match(calls.notices[0], /Recorded 0 notes.*Skipped 1/);
});
