// Hardware integration check. Intentionally separate from the portable unit suite.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Engine } from '../server/engine.js';
import {
  defaultProject,
  KINDS,
  makeTrack,
  synthDef,
  makeSong,
  sectionProject,
} from '../shared/music.js';

const directory = await mkdtemp(path.join(os.tmpdir(), 'scmaker-audio-test-'));
const engine = new Engine(directory);
try {
  await engine.start();
  assert.equal(engine.state, 'ready', `${engine.error}\n${engine.logs.join('\n')}`);
  for (const kind of KINDS)
    await engine.run(() => engine.compile(makeTrack(kind, `t_${kind}`, kind)));
  // Captured from live Muse Spark requests. Compile and play real custom graphs.
  const customTracks = [];
  for (const kind of ['whistle', 'yodel']) {
    const sound = JSON.parse(
      await readFile(new URL(`./fixtures/ai-${kind}.json`, import.meta.url)),
    );
    const track = makeTrack('custom', `t_ai_${kind}`, kind);
    track.recipe = sound.recipe;
    track.code = synthDef(track.id, track.recipe);
    await engine.run(() => engine.compile(track));
    customTracks.push(track);
  }
  // Each custom instrument must produce signal on its own, not hide behind stock tracks.
  for (const track of customTracks) {
    const take = await engine.run(() => engine.startRecording('wav'));
    await engine.run(() => engine.note(track, 60, `voice_${track.id}`, true));
    await new Promise((resolve) => setTimeout(resolve, 650));
    await engine.run(() => engine.note(track, 60, `voice_${track.id}`, false));
    await new Promise((resolve) => setTimeout(resolve, 500));
    await engine.run(() => engine.stopRecording());
    await new Promise((resolve) => setTimeout(resolve, 100));
    const wav = await readFile(path.join(directory, 'recordings', take));
    let peak = 0;
    for (let offset = 12; offset + 8 <= wav.length; ) {
      const size = wav.readUInt32LE(offset + 4);
      if (wav.toString('ascii', offset, offset + 4) === 'data') {
        for (let i = offset + 8; i + 1 < offset + 8 + size; i += 2)
          peak = Math.max(peak, Math.abs(wav.readInt16LE(i) / 32768));
      }
      offset += 8 + size + (size % 2);
    }
    assert.ok(
      peak > 0.01 && peak < 0.99,
      `${track.name} must be audible and unclipped.\n${engine.logs.join('\n')}`,
    );
  }
  // Fifth and sixth loop instruments must each produce signal alone. Preview
  // audio is silenced so it cannot conceal a broken workspace channel.
  const many = defaultProject();
  for (let index = 3; index < 6; index++) {
    const extra = makeTrack('bass', `t_extra_${index}`, `Extra ${index + 1}`);
    extra.notes = [{ id: 'extra', start: 0, midi: 48 + index, length: 8, velocity: 0.7 }];
    many.tracks.push(extra);
  }
  many.tempo = 240;
  await engine.run(() => engine.command('~preview[1].set(\\level, 0);'));
  for (const index of [4, 5]) {
    many.tracks.forEach((track, i) => {
      track.muted = i !== index;
    });
    const take = await engine.run(() => engine.startRecording('wav'));
    await engine.run(() => engine.play(many));
    await new Promise((resolve) => setTimeout(resolve, 850));
    await engine.run(() => engine.stop());
    await engine.run(() => engine.stopRecording());
    const bytes = await readFile(path.join(directory, 'recordings', take));
    let peak = 0;
    for (let offset = 12; offset + 8 <= bytes.length; ) {
      const size = bytes.readUInt32LE(offset + 4);
      if (bytes.toString('ascii', offset, offset + 4) === 'data')
        for (let i = offset + 8; i + 1 < offset + 8 + size; i += 2)
          peak = Math.max(peak, Math.abs(bytes.readInt16LE(i) / 32768));
      offset += 8 + size + (size % 2);
    }
    assert.ok(peak > 0.01 && peak < 0.99, `Instrument ${index + 1} must be audible alone.`);
  }
  const project = defaultProject();
  project.tracks[0].recipe = customTracks[0].recipe;
  project.tracks[0].code = synthDef(project.tracks[0].id, project.tracks[0].recipe);
  const name = await engine.run(() => engine.startRecording('wav'));
  await engine.run(() => engine.play(project));
  await new Promise((resolve) => setTimeout(resolve, 2200));
  assert.ok(engine.step > 0, 'The SuperCollider clock must advance.');
  // Changes while playing must not reset or stop the musical clock.
  project.tracks[0].reverb = 0.2;
  await engine.run(() => engine.sync(project));
  assert.equal(engine.playing, true);
  await engine.run(() => engine.audition(project.tracks[0].recipe));
  await engine.run(() => engine.audition(customTracks[1].recipe));
  await engine.run(() => engine.note(project.tracks[0], 48, 'test_voice', true));
  await new Promise((resolve) => setTimeout(resolve, 250));
  await engine.run(() => engine.note(project.tracks[0], 48, 'test_voice', false));
  await engine.run(() => engine.stop());
  await engine.run(() => engine.stopRecording());
  await new Promise((resolve) => setTimeout(resolve, 250));
  const wav = await readFile(path.join(directory, 'recordings', name));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  let channels = 0,
    sampleRate = 0,
    audio;
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const type = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (type === 'fmt ') {
      assert.equal(wav.readUInt16LE(offset + 8), 1, 'Expected PCM WAV.');
      channels = wav.readUInt16LE(offset + 10);
      sampleRate = wav.readUInt32LE(offset + 12);
      assert.equal(wav.readUInt16LE(offset + 22), 16);
    }
    if (type === 'data') audio = wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  assert.equal(channels, 2, 'Recording must be stereo.');
  assert.ok(sampleRate >= 44100);
  assert.ok(
    audio?.length > sampleRate * channels * 2,
    'Recording must contain more than one second.',
  );
  let peak = 0,
    energy = 0;
  for (let i = 0; i < audio.length; i += 2) {
    const sample = audio.readInt16LE(i) / 32768;
    peak = Math.max(peak, Math.abs(sample));
    energy += sample * sample;
  }
  const rms = Math.sqrt(energy / (audio.length / 2));
  assert.ok(peak > 0.01 && rms > 0.001, 'Recording must contain audible, non-silent signal.');
  assert.ok(peak < 0.99, 'Master output must not clip.');
  // Note entry is timed and quantized by SuperCollider, including early stop and loop end.
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 20000;
    while (!predicate()) {
      assert.ok(
        Date.now() < deadline,
        `Timed out waiting for note capture.\n${engine.logs.join('\n')}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  project.tempo = 120;
  const track = project.tracks[0];
  await engine.run(() => engine.startNoteCapture(project, track.id, 0.6));
  assert.equal(engine.noteCapture.phase, 'count-in');
  await engine.run(() => engine.note(track, 70, 'count_in', true));
  await engine.run(() => engine.note(track, 70, 'count_in', false));
  assert.equal(engine.noteCapture.notes.length, 0, 'Count-in notes must not be recorded.');
  await waitFor(() => engine.noteCapture.phase === 'recording');
  // Wait until step two is audible, then play and release a chord for two steps.
  await waitFor(() => engine.step === 2);
  await new Promise((resolve) => setTimeout(resolve, 80));
  await engine.run(() => engine.note(track, 72, 'chord_a', true));
  await engine.run(() => engine.note(track, 76, 'chord_b', true));
  await new Promise((resolve) => setTimeout(resolve, 250));
  await engine.run(() => engine.note(track, 72, 'chord_a', false));
  await engine.run(() => engine.note(track, 76, 'chord_b', false));
  await waitFor(() => engine.noteCapture.notes.length === 2);
  assert.deepEqual(
    engine.noteCapture.notes.map((note) => note.midi),
    [72, 76],
  );
  for (const note of engine.noteCapture.notes) {
    assert.equal(note.start, 2);
    assert.equal(note.length, 2);
    assert.equal(note.velocity, 0.6);
  }
  await waitFor(() => engine.step === 30);
  await new Promise((resolve) => setTimeout(resolve, 80));
  await engine.run(() => engine.note(track, 79, 'boundary', true));
  await waitFor(() => engine.noteCapture.phase === 'finished');
  assert.equal(engine.playing, false);
  assert.equal(engine.step, -1);
  const boundary = engine.noteCapture.notes.at(-1);
  assert.equal(boundary.start, 30);
  assert.equal(
    boundary.start + boundary.length,
    32,
    'Held notes are clipped at the loop boundary.',
  );
  await engine.run(() => engine.note(track, 79, 'boundary', false));
  await engine.run(() => engine.startNoteCapture(project, track.id, 0.75));
  await engine.run(() => engine.stop());
  assert.equal(engine.noteCapture.phase, 'finished');
  assert.equal(engine.noteCapture.notes.length, 0, 'Stopping during count-in records nothing.');
  await engine.run(() => engine.startNoteCapture(project, track.id, 0.75));
  await waitFor(() => engine.step === 2);
  await new Promise((resolve) => setTimeout(resolve, 80));
  await engine.run(() => engine.note(track, 72, 'early_stop', true));
  await new Promise((resolve) => setTimeout(resolve, 250));
  await engine.run(() => engine.stop());
  assert.equal(engine.noteCapture.phase, 'finished');
  assert.equal(engine.noteCapture.notes.length, 1, 'Early stop must finalize held notes.');
  assert.equal(engine.noteCapture.notes[0].length, 2);
  // An arranged take must finish without a browser or a manual recording stop.
  const song = makeSong(defaultProject());
  song.tempo = 240;
  const first = song.sections[0];
  first.name = 'Intro';
  first.tracks = [makeTrack('bass', 't_bass', 'Bass')];
  first.tracks[0].notes = [{ id: 'intro', start: 0, midi: 48, length: 28, velocity: 0.8 }];
  const chorus = structuredClone(first);
  chorus.id = 's_chorus';
  chorus.name = 'Chorus';
  chorus.tracks[0].recipe.wave = 'sine';
  chorus.tracks[0].code = synthDef('t_bass', chorus.tracks[0].recipe);
  chorus.tracks[0].notes[0].midi = 60;
  const outro = { id: 's_outro', name: 'Outro', tracks: [makeTrack('pad', 't_bass', 'Pad')] };
  outro.tracks[0].recipe.release = 1.2;
  outro.tracks[0].code = synthDef('t_bass', outro.tracks[0].recipe);
  outro.tracks[0].notes = [{ id: 'outro', start: 0, midi: 55, length: 32, velocity: 0.8 }];
  // The only audible outro voice is beyond the former four-track limit.
  outro.tracks.unshift(
    ...Array.from({ length: 5 }, (_, index) =>
      makeTrack('bass', `t_silent_${index}`, `Silent ${index}`),
    ),
  );
  song.sections.push(chorus, outro);
  song.arrangement = [
    { sectionId: first.id, repeats: 1 },
    { sectionId: chorus.id, repeats: 2 },
    { sectionId: outro.id, repeats: 1 },
  ];
  await engine.run(() => engine.playSong(song, 'wav'));
  const positions = new Set();
  // Editing/syncing the workspace cannot mute a later section in this frozen take.
  chorus.tracks[0].muted = true;
  await engine.run(() => engine.sync(sectionProject(song, chorus.id)));
  await waitFor(() => {
    positions.add(`${engine.song.position}:${engine.song.repeat}`);
    return engine.song.phase === 'finished';
  });
  assert.deepEqual([...positions], ['0:1', '1:1', '1:2', '2:1']);
  assert.equal(engine.playing, false);
  assert.equal(engine.recording, null);
  assert.ok(engine.song.name.endsWith('.wav'));
  const arrangedWav = await readFile(path.join(directory, 'recordings', engine.song.name));
  let arrangedAudio;
  for (let offset = 12; offset + 8 <= arrangedWav.length; ) {
    const size = arrangedWav.readUInt32LE(offset + 4);
    if (arrangedWav.toString('ascii', offset, offset + 4) === 'data')
      arrangedAudio = arrangedWav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  const duration = arrangedAudio.length / (sampleRate * 4);
  assert.ok(
    duration >= 12.2 && duration < 13.5,
    `Expected all eight bars and ending tail, got ${duration}s.`,
  );
  const windowRms = (start, end) => {
    let energy = 0,
      count = 0;
    for (let i = Math.floor(start * sampleRate) * 4; i < Math.floor(end * sampleRate) * 4; i += 2) {
      const sample = arrangedAudio.readInt16LE(i) / 32768;
      energy += sample * sample;
      count++;
    }
    return Math.sqrt(energy / count);
  };
  for (const start of [0.3, 2.3, 4.3, 6.8])
    assert.ok(
      windowRms(start, start + 0.4) > 0.001,
      `Section at ${start}s must contain real audio.`,
    );
  assert.ok(windowRms(8.2, 8.6) > 0.001, 'The outro release must survive the song boundary.');
  assert.ok(
    windowRms(11.8, 12.1) < windowRms(8.2, 8.6) * 0.1,
    'The ending must decay before recording closes.',
  );
  assert.doesNotMatch(engine.logs.join('\n'), /ERROR:|FAILURE IN SERVER/);
  await engine.run(() =>
    engine.command('if(~songChannels.notEmpty, { Error("Song channels leaked.").throw; });'),
  );
  // Exhaust the actual bus allocator. A failed song must stop, close its take,
  // and report the error rather than keep playing with missing instruments.
  await engine.run(() =>
    engine.command(`
~blockedBus = s.audioBusAllocator.alloc(s.options.numAudioBusChannels - s.options.firstPrivateBus - 4);
if(~blockedBus.isNil, { Error("Could not reserve test buses.").throw; });
`),
  );
  await engine.run(() => engine.playSong(makeSong(defaultProject()), 'wav'));
  await waitFor(() => engine.song.phase === 'finished');
  assert.match(engine.audioError, /audio buses exhausted/);
  assert.match(engine.song.error, /audio buses exhausted/);
  assert.equal(engine.recording, null);
  assert.equal(engine.playing, false);
  assert.ok((await readFile(path.join(directory, 'recordings', engine.song.name))).length >= 44);
  await engine.run(() => engine.command('s.audioBusAllocator.free(~blockedBus);'));
  await engine.run(() => engine.play(defaultProject()));
  assert.equal(engine.audioError, null, 'Playback recovers once resources are available.');
  await engine.run(() => engine.stop());
  // Server-side /fail replies must reject the command, not just appear in a log.
  await assert.rejects(
    engine.run(() => engine.command('Synth(\\scmakerMissingDefinition);')),
    /SuperCollider audio resource failure/,
  );
  assert.match(engine.audioError, /not found/);
  console.log(
    'PASS: fifth and sixth instruments audible alone; dynamic song routing freed; real bus exhaustion and server failures reported; failed recording finalized; playback recovered.',
  );
  console.log(
    `PASS: arranged SuperCollider song, independent section sounds, ordered repeats, automatic stereo recording, ${duration.toFixed(2)}s including an audible ending tail.`,
  );
  console.log(
    `PASS: real SuperCollider stereo WAV, ${sampleRate} Hz, ${(audio.length / (sampleRate * channels * 2)).toFixed(2)} s, peak ${peak.toFixed(3)}, RMS ${rms.toFixed(3)}. All stock and custom instruments compiled; live notes, clock updates, and quantized note recording worked.`,
  );
} finally {
  await engine.close();
  await rm(directory, { recursive: true, force: true });
}
