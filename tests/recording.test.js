import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { Engine } from '../server/engine.js';

const hasFFmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

// A short stereo PCM WAV, without requiring an audio device.
function wav() {
  const data = Buffer.alloc(44 + 44100 * 4);
  data.write('RIFF');
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(44100, 24);
  data.writeUInt32LE(44100 * 4, 28);
  data.writeUInt16LE(4, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(data.length - 44, 40);
  for (let i = 44; i < data.length; i += 4) {
    const sample = Math.round(8000 * Math.sin(((i - 44) / 4 / 44100) * 440 * 2 * Math.PI));
    data.writeInt16LE(sample, i);
    data.writeInt16LE(sample, i + 2);
  }
  return data;
}

test('recording rejects unsupported formats before sending engine commands', async () => {
  const engine = new Engine('/unused');
  engine.command = () => assert.fail('Invalid format must not reach SuperCollider.');
  for (const format of ['ogg', '../mp3', null, 3])
    await assert.rejects(engine.startRecording(format), /Unknown recording format/);
});

test(
  'WAV stays unchanged; default MP3 and FLAC convert finalized stereo audio',
  {
    skip: !hasFFmpeg,
  },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'scmaker-recording-'));
    const engine = new Engine(directory);
    engine.command = async () => {};
    try {
      for (const format of [undefined, 'wav', 'flac']) {
        const sourceName = await engine.startRecording(format);
        const source = path.join(directory, 'recordings', sourceName);
        await writeFile(source, wav());
        await assert.rejects(engine.startRecording('wav'), /Already recording/);
        const name = await engine.stopRecording();
        const extension = format ?? 'mp3';
        assert.ok(name.endsWith(`.${extension}`));
        const bytes = await readFile(path.join(directory, 'recordings', name));
        assert.equal(
          bytes.toString('ascii', 0, extension === 'mp3' ? 3 : 4),
          { mp3: 'ID3', wav: 'RIFF', flac: 'fLaC' }[extension],
        );
        assert.deepEqual(await readFile(source), wav(), 'Original WAV is retained.');
        assert.equal(engine.recording, null);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const sourceName = await engine.startRecording();
      await writeFile(path.join(directory, 'recordings', sourceName), 'invalid WAV');
      await assert.rejects(engine.stopRecording(), /original WAV is safe/);
      assert.equal(engine.recording, null);
      assert.equal(
        (await readdir(path.join(directory, 'recordings'))).some((name) => name.endsWith('.tmp')),
        false,
      );
      assert.equal(
        await readFile(path.join(directory, 'recordings', sourceName), 'utf8'),
        'invalid WAV',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
