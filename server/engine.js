import dgram from 'node:dgram';
import { spawn, spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { encodeOSC, decodeOSC } from './osc.js';
import { synthDef } from '../shared/music.js';
import {
  bootstrap,
  projectCode,
  playbackCode,
  auditionCode,
  noteOffCode,
  noteOnCode,
  safetyReleaseCode,
  recordingCode,
} from './supercollider.js';

export { bootstrap, scString } from './supercollider.js';

// All interpolated code comes from validated numeric recipes or generated identifiers.
const executeFile = promisify(execFile);
const hasCommand = (name) => spawnSync('which', [name], { stdio: 'ignore' }).status === 0;
async function freePort() {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

export class Engine {
  constructor(directory) {
    this.directory = directory;
    this.token = randomBytes(24).toString('hex');
    this.state = 'starting';
    this.error = null;
    this.logs = [];
    this.pending = new Map();
    this.sequence = 0;
    this.step = -1;
    this.playing = false;
    this.recording = null;
    this.noteCapture = null;
    this.captureSequence = 0;
    this.capturePrefix = randomBytes(8).toString('hex');
    this.compiled = new Map();
    this.queue = Promise.resolve();
  }
  log(chunk) {
    const lines = chunk.toString().trim().split('\n');
    this.logs.push(...lines);
    this.logs = this.logs.slice(-80);
  }
  async start() {
    try {
      if (!hasCommand(process.env.SCLANG_PATH || 'sclang'))
        throw new Error('sclang was not found. Install SuperCollider, then restart the app.');
      await mkdir(this.directory, { recursive: true });
      this.socket = dgram.createSocket('udp4');
      await new Promise((resolve, reject) => {
        this.socket.once('error', reject);
        this.socket.bind(0, '127.0.0.1', resolve);
      });
      const replyPort = this.socket.address().port;
      this.langPort = await freePort();
      const audioPort = await freePort();
      const scriptPath = path.join(this.directory, 'engine.scd');
      await writeFile(scriptPath, bootstrap({ token: this.token, replyPort, audioPort }), {
        mode: 0o600,
      });
      const ready = new Promise((resolve, reject) => {
        this.readyResolve = resolve;
        this.readyReject = reject;
        this.bootTimer = setTimeout(
          () =>
            reject(
              new Error(
                'SuperCollider did not boot within 30 seconds. Check the audio device and engine log.',
              ),
            ),
          30000,
        );
      });
      this.socket.on('message', (buffer, remote) => {
        if (remote.address !== '127.0.0.1' || remote.port !== this.langPort) return;
        try {
          const { address, args } = decodeOSC(buffer);
          if (args[0] !== this.token) return;
          if (address === '/scmaker/ready') {
            this.state = 'ready';
            this.readyResolve();
          }
          if (address === '/scmaker/step') {
            this.step = args[1];
            this.stepAt = Date.now() + 80;
          }
          if (this.noteCapture && args[1] === this.noteCapture.id) {
            if (address === '/scmaker/countIn') this.noteCapture.countIn = args[2];
            if (address === '/scmaker/captureStarted') {
              this.noteCapture.countIn = 0;
              this.noteCapture.phase = 'recording';
            }
            if (address === '/scmaker/captured') {
              const [, , midi, start, length] = args;
              if (
                Number.isInteger(midi) &&
                midi >= 24 &&
                midi <= 96 &&
                Number.isInteger(start) &&
                start >= 0 &&
                start < 32 &&
                Number.isInteger(length) &&
                length >= 1 &&
                start + length <= 32 &&
                this.noteCapture.notes.length < 256
              )
                this.noteCapture.notes.push({
                  id: `n_${this.capturePrefix}_${this.noteCapture.id}_${this.noteCapture.notes.length}`,
                  midi,
                  start,
                  length,
                  velocity: this.noteCapture.velocity,
                });
            }
            if (address === '/scmaker/captureFinished') {
              this.noteCapture.phase = 'finished';
              this.playing = false;
              this.step = -1;
            }
          }
          if (address === '/scmaker/reply') {
            const item = this.pending.get(args[1]);
            if (item) {
              clearTimeout(item.timer);
              this.pending.delete(args[1]);
              args[2] ? item.resolve() : item.reject(new Error(args[3]));
            }
          }
        } catch {
          /* Ignore unrelated or malformed UDP packets. */
        }
      });
      const executable = process.env.SCLANG_PATH || 'sclang';
      const usePipeWire =
        process.platform === 'linux' &&
        hasCommand('pw-jack') &&
        process.env.SCMAKER_USE_PW_JACK !== '0';
      this.child = spawn(
        usePipeWire ? 'pw-jack' : executable,
        [...(usePipeWire ? [executable] : []), '-D', '-u', String(this.langPort), scriptPath],
        {
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, QT_QPA_PLATFORM: 'offscreen', QTWEBENGINE_DISABLE_SANDBOX: '1' },
        },
      );
      this.child.stdout.on('data', (chunk) => this.log(chunk));
      this.child.stderr.on('data', (chunk) => this.log(chunk));
      this.child.on('error', (error) => this.fail(error));
      this.child.on('exit', (code, signal) => {
        if (this.state !== 'closed')
          this.fail(new Error(`SuperCollider exited (${signal || code}). See the engine log.`));
      });
      await ready;
      clearTimeout(this.bootTimer);
    } catch (error) {
      this.fail(error);
      this.kill();
    }
  }
  fail(error) {
    this.state = 'error';
    this.error = error.message;
    clearTimeout(this.bootTimer);
    this.readyReject?.(error);
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }
  kill() {
    if (this.child?.pid) {
      try {
        process.kill(-this.child.pid, 'SIGTERM');
      } catch {
        /* Already exited. */
      }
    }
  }
  command(code, waitForServer = true) {
    if (this.state !== 'ready')
      return Promise.reject(new Error(this.error || 'The audio engine is still starting.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('SuperCollider command timed out.'));
      }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(
        encodeOSC('/scmaker/eval', [this.token, id, code, waitForServer ? 1 : 0]),
        this.langPort,
        '127.0.0.1',
        (error) => {
          if (error) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(error);
          }
        },
      );
    });
  }
  run(action) {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
  async compile(track) {
    if (this.compiled.get(track.id) !== track.code) {
      await this.command(track.code);
      this.compiled.set(track.id, track.code);
    }
  }
  async sync(project) {
    for (const track of project.tracks) await this.compile(track);
    await this.command(projectCode(project));
  }
  async play(project) {
    await this.sync(project);
    if (this.playing) return;
    await this.command(playbackCode(project));
    this.playing = true;
  }
  async startNoteCapture(project, trackId, velocity) {
    await this.stop();
    await this.sync(project);
    this.noteCapture = {
      id: ++this.captureSequence,
      trackId,
      velocity,
      phase: 'count-in',
      countIn: 4,
      notes: [],
    };
    await this.command(`~captureTrack = \\${trackId};`);
    await this.command(playbackCode(project, this.noteCapture.id));
    this.playing = true;
  }
  async stop() {
    await this.command(
      'if(~routine.notNil, { ~routine.stop; }); if(~captureActive, { ~finishCapture.(); }); ~clock.clear; ~live.clear; 0.12.wait; ~voices.freeAll;',
    );
    this.playing = false;
    this.step = -1;
    if (this.noteCapture) this.noteCapture.phase = 'finished';
  }
  async audition(recipe, midi = 48, reverb = 0.05) {
    const code = synthDef('t_preview', recipe);
    await this.compile({ id: 't_preview', code });
    await this.command(auditionCode(midi, reverb));
  }
  async note(track, midi, voiceId, on) {
    if (!on) {
      await this.command(noteOffCode(voiceId), false);
      return;
    }
    await this.compile(track);
    // Keep note-on and its disconnect safeguard in one command to avoid an extra
    // round trip on the keyboard input path.
    await this.command(noteOnCode(track, midi, voiceId) + safetyReleaseCode(voiceId), false);
  }
  async startRecording(format = 'mp3') {
    if (!['mp3', 'wav', 'flac'].includes(format)) throw new Error('Unknown recording format.');
    if (this.recording) throw new Error('Already recording.');
    if (format !== 'wav' && !hasCommand('ffmpeg'))
      throw new Error('Install FFmpeg for MP3 or FLAC recording, or select WAV.');
    const name = `take-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
    const file = path.join(this.directory, 'recordings', name);
    await mkdir(path.dirname(file), { recursive: true });
    await this.command(recordingCode(file));
    this.recording = name;
    this.recordingFormat = format;
    return name;
  }
  async stopRecording() {
    if (!this.recording) throw new Error('Not recording.');
    const name = this.recording;
    await this.command('s.stopRecording; s.sync;');
    this.recording = null;
    const format = this.recordingFormat;
    if (format === 'wav') return name;
    const outputName = name.replace(/\.wav$/, `.${format}`);
    const source = path.join(this.directory, 'recordings', name);
    const output = path.join(this.directory, 'recordings', outputName);
    const temporary = `${output}.tmp`;
    try {
      await executeFile(
        'ffmpeg',
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-n',
          '-i',
          source,
          '-map',
          '0:a:0',
          '-c:a',
          format === 'mp3' ? 'libmp3lame' : 'flac',
          ...(format === 'mp3' ? ['-b:a', '192k'] : []),
          '-f',
          format,
          temporary,
        ],
        { timeout: 300000 },
      );
      await rename(temporary, output);
    } catch {
      await rm(temporary, { force: true });
      throw new Error(`Recording conversion failed. The original WAV is safe: ${name}`);
    }
    return outputName;
  }
  status() {
    return {
      state: this.state,
      error: this.error,
      playing: this.playing,
      recording: this.recording,
      noteCapture: this.noteCapture,
      step: this.step,
      stepAt: this.stepAt,
      log: this.logs.join('\n'),
    };
  }
  async close() {
    if (this.state === 'ready') {
      try {
        if (this.recording) await this.stopRecording();
        await this.stop();
        await this.command('s.quit;');
      } catch {
        /* Ensure child processes are still terminated. */
      }
    }
    this.state = 'closed';
    clearTimeout(this.bootTimer);
    this.kill();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* Not bound. */
      }
    }
  }
}
