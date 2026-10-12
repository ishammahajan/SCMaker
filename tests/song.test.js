import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  defaultProject,
  makeSong,
  validateProject,
  sectionProject,
  synthDef,
} from '../shared/music.js';
import { Engine } from '../server/engine.js';
import { songInstruments, songPlaybackCode } from '../server/supercollider.js';
import { createApp } from '../server/app.js';
import { createNoteRecording } from '../public/features/note-recording.js';

function songFixture() {
  const song = makeSong(defaultProject());
  const second = structuredClone(song.sections[0]);
  second.id = 's_chorus';
  second.name = 'Chorus';
  second.tracks[0].notes[0].midi = 48;
  second.tracks[0].recipe.wave = 'sine';
  second.tracks[0].code = synthDef(second.tracks[0].id, second.tracks[0].recipe);
  song.sections.push(second);
  song.arrangement.push({ sectionId: second.id, repeats: 2 });
  return song;
}

test('legacy loops become songs without losing exact sounds, versions, or notes', () => {
  const legacy = defaultProject();
  const song = makeSong(legacy);
  assert.equal(song.version, 2);
  assert.deepEqual(sectionProject(song, 's_first'), legacy);
  assert.deepEqual(validateProject(legacy), legacy, 'Version one remains readable unchanged.');
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(songFixture()))), songFixture());
  const duplicate = songFixture();
  duplicate.sections[1].tracks[0].notes[0].start = 4;
  assert.equal(duplicate.sections[0].tracks[0].notes[0].start, 0);
});

test('song validation bounds sections and repetitions and rejects invalid references and code', () => {
  const reject = (mutate, pattern) => {
    const song = songFixture();
    mutate(song);
    assert.throws(() => validateProject(song), pattern);
  };
  reject((s) => {
    s.sections = [];
  }, /sections/);
  reject((s) => {
    s.sections = Array(17).fill(s.sections[0]);
  }, /sections/);
  reject((s) => {
    s.sections[1].id = s.sections[0].id;
  }, /duplicate section/);
  reject((s) => {
    s.sections[1].id = 's_bad); 0.exit;';
  }, /section ID/);
  reject((s) => {
    s.arrangement = [];
  }, /arrangement entries/);
  reject((s) => {
    s.arrangement = Array(33).fill(s.arrangement[0]);
  }, /arrangement entries/);
  reject((s) => {
    s.arrangement[0].sectionId = 's_missing';
  }, /Unknown arrangement/);
  for (const repeats of [0, 17, 1.5, '2', Infinity])
    reject((s) => {
      s.arrangement[0].repeats = repeats;
    }, /repeats/);
  reject((s) => {
    s.sections[1].tracks[0].code += '0.exit;';
  }, /does not match/);
  reject((s) => {
    s.sections[1].tracks[0].notes[0].length = 33;
  }, /note length/);
});

test('song scheduling uses independent definitions, the arrangement order, and an ending tail', () => {
  const song = songFixture();
  const instruments = songInstruments(song);
  assert.notEqual(instruments[0][0].id, instruments[1][0].id);
  for (const tracks of instruments)
    for (const track of tracks) assert.equal(track.code, synthDef(track.id, track.recipe));
  const code = songPlaybackCode(song, 7);
  assert.match(code, /\[\[0, 0, 1\],\[1, 1, 1\],\[1, 1, 2\]\]/);
  assert.match(code, /32.do/);
  assert.match(code, /clock.sched/);
  assert.match(code, /songTail/);
  assert.match(code, /1.8 \+ 3 \+ s.latency/);
  assert.match(code, /songFinished", ~secret, 7/);
  assert.doesNotMatch(code, /loop \{/);
});

test('song recording starts before playback, ignores stale completion, and finalizes once', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scmaker-song-unit-'));
  const engine = new Engine(directory);
  const commands = [];
  engine.command = async (code) => {
    commands.push(code);
  };
  try {
    await engine.playSong(songFixture(), 'wav');
    assert.equal(engine.playing, true);
    assert.equal(engine.song.phase, 'playing');
    assert.ok(
      commands.findIndex((code) => code.includes('s.record;')) <
        commands.findIndex((code) => code.includes('songFinished')),
    );
    const count = commands.length;
    await engine.sync(defaultProject());
    assert.equal(commands.length, count, 'Workspace sync cannot change a running song.');
    await assert.rejects(engine.audition(defaultProject().tracks[0].recipe), /Stop song/);
    await engine.finishSong(engine.song.id + 1);
    assert.equal(engine.playing, true);
    await engine.finishSong(engine.song.id);
    await engine.finishSong(engine.song.id);
    assert.equal(engine.song.phase, 'finished');
    assert.equal(engine.playing, false);
    assert.equal(engine.recording, null);
    assert.match(engine.song.url, /recordings\/take-.*\.wav$/);
    assert.equal(commands.filter((code) => code.includes('s.stopRecording')).length, 1);
    const previousId = engine.song.id;
    await engine.playSong(songFixture(), 'wav');
    await engine.finishSong(previousId);
    assert.equal(engine.song.phase, 'playing', 'A previous song cannot finish the new take.');
    await engine.stop();
    assert.equal(engine.song.phase, 'finished', 'Early stop also closes the take.');
    assert.equal(engine.recording, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed song playback closes its recording and conversion failure is visible in status', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scmaker-song-failure-'));
  const engine = new Engine(directory);
  engine.command = async (code) => {
    if (code.includes('songFinished')) throw new Error('Playback rejected.');
  };
  try {
    await assert.rejects(engine.playSong(songFixture(), 'wav'), /Playback rejected/);
    assert.equal(engine.recording, null);
    assert.equal(engine.playing, false);
    engine.command = async () => {};
    await engine.playSong(songFixture(), 'wav');
    engine.stopRecording = async () => {
      engine.recording = null;
      throw new Error('Conversion failed. Original WAV retained.');
    };
    await engine.finishSong(engine.song.id);
    assert.equal(engine.song.phase, 'finished');
    assert.match(engine.status().song.error, /Original WAV retained/);
    assert.equal(engine.song.url, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('song API persists arrangements and authenticates and validates playback and recording', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scmaker-song-api-'));
  let played = null;
  const engine = {
    run: (fn) => fn(),
    status: () => ({ state: 'ready' }),
    playSong: async (project, format) => {
      played = { project, format };
    },
  };
  const { server } = await createApp({ dataDir: directory, engine, startEngine: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const { token } = await (await fetch(`${base}/session`)).json();
    const post = (route, input, extra = {}) =>
      fetch(`${base}/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SCMaker-Token': token, ...extra },
        body: JSON.stringify(input),
      });
    const project = songFixture();
    assert.equal((await post('project', { project })).status, 200);
    assert.deepEqual((await (await fetch(`${base}/project`)).json()).project, project);
    for (const route of ['song/play', 'song/record']) {
      assert.equal((await post(route, { project }, { 'X-SCMaker-Token': '' })).status, 403);
      assert.equal(
        (await post(route, { project }, { Origin: 'https://evil.example' })).status,
        403,
      );
      assert.equal((await post(route, { project: defaultProject() })).status, 400);
      assert.equal((await post(route, { project, format: 'wav' })).status, 200);
      assert.deepEqual(played, { project, format: route === 'song/record' ? 'wav' : undefined });
    }
    for (const format of ['ogg', 1, null])
      assert.equal((await post('song/record', { project, format })).status, 400);
    project.arrangement[0].sectionId = 's_missing';
    assert.equal((await post('song/play', { project })).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('note recording and rerecord history stay attached to their armed section', () => {
  const state = { project: songFixture(), selectedSectionId: 's_first', selectedTrackId: 't_bass' };
  const recorder = createNoteRecording({
    state,
    markDirty() {},
    renderRoll() {},
    renderTracks() {},
    releaseAllKeys() {},
    notify() {},
  });
  const prepared = recorder.prepare();
  const capture = { id: 1, trackId: 't_bass', phase: 'recording', notes: [] };
  recorder.begin(capture, prepared);
  state.selectedSectionId = 's_chorus';
  capture.notes.push({ id: 'n_take', midi: 72, start: 4, length: 2, velocity: 0.6 });
  capture.phase = 'finished';
  recorder.update(capture);
  assert.ok(state.project.sections[0].tracks[0].notes.some((note) => note.id === 'n_take'));
  assert.ok(!state.project.sections[1].tracks[0].notes.some((note) => note.id === 'n_take'));
  assert.equal(recorder.prepare(true), null);
  state.selectedSectionId = 's_first';
  assert.ok(!recorder.prepare(true).project.tracks[0].notes.some((note) => note.id === 'n_take'));
});
