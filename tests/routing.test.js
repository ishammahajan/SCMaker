import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  defaultProject,
  makeTrack,
  makeSong,
  validateProject,
  MAX_PROJECT_BYTES,
} from '../shared/music.js';
import { Engine } from '../server/engine.js';
import {
  bootstrap,
  projectCode,
  auditionCode,
  noteOnCode,
  songSetupCode,
  songSectionCode,
  songPlaybackCode,
} from '../server/supercollider.js';
import { readJson } from '../server/http.js';
import { createApp } from '../server/app.js';

function manyTracks(count) {
  const project = defaultProject();
  project.tracks = Array.from({ length: count }, (_, i) =>
    makeTrack('bass', `t_voice_${i}`, `Voice ${i + 1}`),
  );
  return project;
}

test('loops and songs have no fixed instrument-count ceiling and still validate every track', () => {
  const loop = manyTracks(96);
  const song = makeSong(loop);
  assert.equal(validateProject(loop).tracks.length, 96);
  assert.equal(validateProject(song).sections[0].tracks.length, 96);
  loop.tracks[95].code += '0.exit;';
  assert.throws(() => validateProject(loop), /does not match/);
  assert.throws(() => validateProject({ ...loop, tracks: [] }), /at least one/);
});

test('workspace routing is keyed by ID, bounded per command, and preview has its own channel', async () => {
  const project = manyTracks(96);
  for (const track of project.tracks)
    track.notes = Array.from({ length: 256 }, (_, i) => ({
      id: `n_${i}`,
      start: i % 32,
      length: 1,
      midi: 48,
      velocity: 0.5,
    }));
  const commands = projectCode(project);
  assert.ok(commands.every((code) => Buffer.byteLength(code) < 60000));
  for (const track of project.tracks) {
    assert.ok(commands.some((code) => code.includes(`\\${track.id}, [[`)));
    assert.ok(commands.some((code) => code.includes(`~channels[\\${track.id}]`)));
  }
  assert.ok(commands.at(-1).includes('~tracks = ~nextTracks'));
  assert.ok(commands.some((code) => code.includes('~freeChannel')));
  assert.ok(
    !projectCode(project, true).some((code) => code.includes('~freeChannel')),
    'Live updates retain release channels until Stop.',
  );
  const init = bootstrap({ token: 'test', replyPort: 1234, audioPort: 1235 });
  assert.match(init, /IdentityDictionary.new/);
  assert.match(init, /bus.isNil/);
  assert.match(init, /audioError/);
  assert.match(auditionCode(48, 0.2), /~preview\[0\]/);
  assert.match(noteOnCode(project.tracks[95], 48, 'voice'), /~preview\[0\]/);
  assert.doesNotMatch(init, /Array.fill\(5/);
  const batched = new Engine('/unused');
  const sent = [];
  batched.command = async (code) => sent.push(code);
  await batched.sync(project);
  assert.ok(sent.length < project.tracks.length, 'Batching avoids a round trip for every track.');
  assert.ok(sent.every((code) => Buffer.byteLength(code) <= 48000));
  assert.equal(batched.compiled.size, 96);
  for (const track of project.tracks)
    assert.ok(sent.some((code) => code.includes(`\\${track.id}`)));
  const engine = new Engine('/unused');
  engine.state = 'ready';
  await assert.rejects(engine.command('x'.repeat(60000)), /safe bridge packet size/);
});

test('song routing is allocated only for sounding sections and unused sections are not compiled', async () => {
  const song = makeSong(manyTracks(12));
  for (const track of song.sections[0].tracks)
    track.notes = [{ id: 'n_one', start: 0, length: 1, midi: 48, velocity: 0.5 }];
  const unused = structuredClone(song.sections[0]);
  unused.id = 's_unused';
  song.sections.push(unused);
  assert.doesNotMatch(songSetupCode(song), /Array.fill|Bus.audio/);
  const chunks = songSectionCode(song.sections[0].tracks, 0);
  assert.equal(chunks.length, 13);
  const play = songPlaybackCode(song, 1);
  assert.match(play, /track\[1\].notEmpty/);
  assert.match(play, /~newChannel/);
  assert.match(play, /~releaseSongChannels/);
  const engine = new Engine('/unused');
  engine.command = async () => {};
  await engine.playSong(song);
  const compiled = [...engine.compiled.keys()];
  assert.equal(compiled.length, 12);
  assert.ok(compiled.every((id) => id.startsWith('t_song_0_')));
});

test('larger projects save and reopen above 1 MiB while request parsing remains bounded', async () => {
  const project = manyTracks(32);
  for (const track of project.tracks)
    track.history = Array.from({ length: 40 }, () => ({
      ...track.history[0],
      prompt: 'x'.repeat(1000),
    }));
  const input = JSON.stringify({ project });
  assert.ok(Buffer.byteLength(input) > 1024 * 1024);
  assert.ok(Buffer.byteLength(input) < MAX_PROJECT_BYTES);
  await assert.rejects(readJson(Readable.from([Buffer.from(input)])), /data limit/);
  assert.deepEqual(await readJson(Readable.from([Buffer.from(input)]), MAX_PROJECT_BYTES), {
    project,
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scmaker-large-project-'));
  const { server } = await createApp({
    dataDir: directory,
    engine: { status: () => ({ state: 'ready' }) },
    startEngine: false,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const { token } = await (await fetch(`${base}/session`)).json();
    const response = await fetch(`${base}/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SCMaker-Token': token },
      body: input,
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await (await fetch(`${base}/project`)).json()).project, project);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
