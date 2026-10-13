import test from 'node:test';
import assert from 'node:assert/strict';
import { songPositionText, transportView } from '../public/features/transport-view.js';

const idle = { songScope: false, songBusy: false, captureBusy: false, recordingBusy: false };
const ready = { state: 'ready', playing: false, recording: null, step: -1 };

test('transport reports engine startup and errors', () => {
  const starting = transportView({ state: 'starting' }, idle);
  assert.equal(starting.status, 'Starting SuperCollider…');
  assert.equal(starting.light, 'waiting');
  assert.ok(starting.disabled.play && starting.disabled.stop && starting.disabled.record);
  const failed = transportView({ state: 'error', error: 'sclang was not found.' }, idle);
  assert.equal(failed.status, 'sclang was not found.');
  assert.equal(failed.light, 'error');
  const stopped = transportView({ ...ready, audioError: 'Buses exhausted.' }, idle);
  assert.equal(stopped.status, 'Audio stopped: Buses exhausted.');
  assert.equal(stopped.light, '');
});

test('transport labels follow loop and song scope', () => {
  assert.equal(transportView(ready, idle).playAria, 'Play loop');
  assert.equal(transportView(ready, idle).recordAria, 'Record stereo audio');
  const songScope = transportView(ready, { ...idle, songScope: true });
  assert.equal(songScope.playAria, 'Play song');
  assert.equal(songScope.recordAria, 'Record song');
  const loop = transportView({ ...ready, playing: true }, idle);
  assert.equal(loop.playLabel, ' Stop');
  assert.equal(loop.playAria, 'Stop loop');
});

test('an active song locks editing controls but keeps Stop available', () => {
  const song = { phase: 'playing', entries: [], position: 0, repeat: 1 };
  const view = transportView(
    { ...ready, playing: true, recording: 'take.wav', song },
    { ...idle, songScope: true },
  );
  assert.equal(view.playAria, 'Stop song');
  assert.equal(view.recordLabel, 'Recording…');
  assert.equal(view.recordAria, 'Recording song');
  assert.equal(view.disabled.play, false);
  assert.ok(view.disabled.record && view.disabled.playbackScope && view.disabled.arrangement);
  assert.ok(view.disabled.audition && view.disabled.recordNotes);
  const tail = transportView({ ...ready, song: { ...song, phase: 'tail' } }, idle);
  assert.equal(tail.disabled.play, true);
});

test('manual recording blocks starting a song', () => {
  const view = transportView({ ...ready, recording: 'take.wav' }, { ...idle, songScope: true });
  assert.equal(view.recordLabel, 'Finish take');
  assert.equal(view.disabled.play, true);
  assert.equal(view.disabled.record, false);
  assert.equal(view.disabled.recordingFormat, true);
});

test('note capture shows count-in, then recording state', () => {
  const countIn = transportView({ ...ready, noteCapture: { phase: 'count-in', countIn: 3 } }, idle);
  assert.equal(countIn.recordNotesLabel, 'Count-in: 3 · Stop');
  assert.equal(countIn.capturing, true);
  const recording = transportView({ ...ready, noteCapture: { phase: 'recording' } }, idle);
  assert.equal(recording.recordNotesLabel, 'Stop recording notes');
  const finished = transportView({ ...ready, noteCapture: { phase: 'finished' } }, idle);
  assert.equal(finished.recordNotesLabel, 'Record notes');
  assert.equal(finished.capturing, false);
});

test('song position describes the entry, repetition, and bar', () => {
  const song = {
    phase: 'playing',
    position: 1,
    repeat: 2,
    entries: [
      { name: 'Intro', repeats: 1 },
      { name: 'Chorus', repeats: 4 },
    ],
  };
  assert.equal(songPositionText(song, 20), '2/2: Chorus · repeat 2/4 · bar 2/2');
  assert.equal(songPositionText(song, -1), '2/2: Chorus · repeat 2/4 · bar 1/2');
  assert.equal(songPositionText({ phase: 'tail' }, -1), 'Ending tail…');
  assert.equal(songPositionText({ phase: 'finishing' }, -1), 'Preparing recording…');
  assert.equal(songPositionText({ phase: 'finished' }, -1), 'Song stopped');
  assert.equal(songPositionText(null, -1), '');
});
