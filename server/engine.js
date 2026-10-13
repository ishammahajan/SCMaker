import dgram from 'node:dgram';
import { spawn, spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { encodeOSC, decodeOSC } from './osc.js';
import { MAX_MIDI, MAX_NOTES, MIN_MIDI, STEPS, synthDef } from '../shared/music.js';
import { RECORDING_FORMATS, isSongActive } from '../shared/playback.js';
import {
  bootstrap,
  projectCode,
  playbackCode,
  songInstruments,
  songSetupCode,
  songSectionCode,
  songPlaybackCode,
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
/** @returns {Promise<void>} */
function bindLoopback(socket) {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', resolve);
  });
}
async function freePort() {
  const socket = dgram.createSocket('udp4');
  await bindLoopback(socket);
  const port = socket.address().port;
  await /** @type {Promise<void>} */ (new Promise((resolve) => socket.close(resolve)));
  return port;
}

const validCapturedNote = (midi, start, length) =>
  Number.isInteger(midi) &&
  midi >= MIN_MIDI &&
  midi <= MAX_MIDI &&
  Number.isInteger(start) &&
  start >= 0 &&
  start < STEPS &&
  Number.isInteger(length) &&
  length >= 1 &&
  start + length <= STEPS;

export class Engine {
  constructor(directory) {
    this.directory = directory;
    this.token = randomBytes(24).toString('hex');
    /** @type {import('../shared/playback.js').EngineStatus['state']} */
    this.state = 'starting';
    this.error = null;
    this.audioError = null;
    this.logs = [];
    this.pending = new Map();
    this.sequence = 0;
    this.step = -1;
    this.playing = false;
    this.recording = null;
    /** @type {import('../shared/playback.js').NoteCapture | null} */
    this.noteCapture = null;
    this.captureSequence = 0;
    /** @type {import('../shared/playback.js').Song | null} */
    this.song = null;
    this.songSequence = 0;
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
      await bindLoopback(this.socket);
      const replyPort = this.socket.address().port;
      this.langPort = await freePort();
      const audioPort = await freePort();
      const scriptPath = path.join(this.directory, 'engine.scd');
      await writeFile(scriptPath, bootstrap({ token: this.token, replyPort, audioPort }), {
        mode: 0o600,
      });
      /** @type {Promise<void>} */
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
          if (args[0] === this.token) this.handleMessage(address, args);
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
  // Authenticated replies from sclang. args[0] is the session token.
  handleMessage(address, args) {
    if (address === '/scmaker/ready') {
      this.state = 'ready';
      this.readyResolve();
    }
    if (address === '/scmaker/audioError') {
      this.audioError = String(args[1]);
      this.log(this.audioError);
      this.run(async () => {
        if (!this.playing && !this.songActive) return;
        if (this.songActive) this.song.error = this.audioError;
        await this.stop();
      }).catch((error) => this.log(`Audio cleanup failed: ${error.message}`));
    }
    if (address === '/scmaker/step') {
      this.step = args[1];
      this.stepAt = Date.now() + 80;
    }
    if (this.songActive && args[1] === this.song.id) this.handleSongMessage(address, args);
    if (this.noteCapture && args[1] === this.noteCapture.id)
      this.handleCaptureMessage(address, args);
    if (address === '/scmaker/reply') {
      const item = this.pending.get(args[1]);
      if (item) {
        clearTimeout(item.timer);
        this.pending.delete(args[1]);
        args[2] ? item.resolve() : item.reject(new Error(args[3]));
      }
    }
  }
  handleSongMessage(address, args) {
    if (address === '/scmaker/songStep') {
      this.step = args[2];
      this.stepAt = Date.now() + 80;
      this.song.position = args[3];
      this.song.repeat = args[4];
    }
    if (address === '/scmaker/songTail') {
      this.song.phase = 'tail';
      this.step = -1;
    }
    if (address === '/scmaker/songFinished')
      this.run(() => this.finishSong(args[1])).catch((error) => this.log(error.message));
  }
  handleCaptureMessage(address, args) {
    const capture = this.noteCapture;
    if (address === '/scmaker/countIn') capture.countIn = args[2];
    if (address === '/scmaker/captureStarted') {
      capture.countIn = 0;
      capture.phase = 'recording';
    }
    if (address === '/scmaker/captured') {
      const [, , midi, start, length] = args;
      if (validCapturedNote(midi, start, length) && capture.notes.length < MAX_NOTES)
        capture.notes.push({
          id: `n_${this.capturePrefix}_${capture.id}_${capture.notes.length}`,
          midi,
          start,
          length,
          velocity: capture.velocity,
        });
    }
    if (address === '/scmaker/captureFinished') {
      capture.phase = 'finished';
      this.playing = false;
      this.step = -1;
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
    const packet = encodeOSC('/scmaker/eval', [this.token, id, code, waitForServer ? 1 : 0]);
    if (packet.length > 60000)
      return Promise.reject(
        new Error('SuperCollider command exceeds the safe bridge packet size.'),
      );
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('SuperCollider command timed out.'));
      }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(packet, this.langPort, '127.0.0.1', (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }
  run(action) {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
  async commands(codes) {
    let batch = '';
    let bytes = 0;
    for (const code of codes) {
      const size = Buffer.byteLength(code) + 1;
      if (batch && bytes + size > 48000) {
        await this.command(batch);
        batch = '';
        bytes = 0;
      }
      batch += `${code}\n`;
      bytes += size;
    }
    if (batch) await this.command(batch);
  }
  async compileTracks(tracks) {
    const changed = tracks.filter((track) => this.compiled.get(track.id) !== track.code);
    await this.commands(changed.map((track) => track.code));
    for (const track of changed) this.compiled.set(track.id, track.code);
  }
  async compile(track) {
    await this.compileTracks([track]);
  }
  get songActive() {
    return isSongActive(this.song);
  }
  async sync(project) {
    // Song playback uses a frozen arrangement. Workspace edits apply next time.
    if (this.songActive) return;
    await this.compileTracks(project.tracks.filter((track) => !track.muted && track.notes.length));
    await this.commands(projectCode(project, this.playing));
  }
  async play(project) {
    await this.sync(project);
    if (this.playing) return;
    this.audioError = null;
    await this.command(playbackCode(project));
    this.playing = true;
  }
  async playSong(project, format) {
    if (this.recording) throw new Error('Finish the current recording before starting a song.');
    await this.stop();
    this.audioError = null;
    const sections = songInstruments(project);
    const usedSections = new Set(
      project.arrangement.map((entry) =>
        project.sections.findIndex((section) => section.id === entry.sectionId),
      ),
    );
    try {
      await this.compileTracks(
        [...usedSections].flatMap((index) =>
          sections[index].filter((track) => !track.muted && track.notes.length),
        ),
      );
      await this.commands([
        songSetupCode(project),
        ...[...usedSections].flatMap((index) => songSectionCode(sections[index], index)),
      ]);
      if (format !== undefined) await this.startRecording(format);
      this.song = {
        id: ++this.songSequence,
        phase: 'playing',
        recorded: format !== undefined,
        position: 0,
        repeat: 1,
        entries: project.arrangement.map((entry) => ({
          ...entry,
          name: project.sections.find((section) => section.id === entry.sectionId).name,
        })),
      };
      this.playing = true;
      await this.command(songPlaybackCode(project, this.song.id));
    } catch (error) {
      try {
        await this.stop();
        if (this.recording) await this.stopRecording();
      } catch (cleanupError) {
        this.log(`Song cleanup failed: ${cleanupError.message}`);
      }
      throw error;
    }
  }
  async finishSong(id) {
    if (!this.songActive || this.song.id !== id) return;
    this.playing = false;
    this.step = -1;
    this.song.phase = 'finishing';
    try {
      if (this.song.recorded && this.recording) {
        const name = await this.stopRecording();
        this.song.name = name;
        this.song.url = `/api/recordings/${name}`;
      }
    } catch (error) {
      this.song.error = error.message;
    }
    this.song.phase = 'finished';
  }
  async startNoteCapture(project, trackId, velocity) {
    if (this.songActive) throw new Error('Stop song playback before recording notes.');
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
    let stopError;
    try {
      await this.command(
        'if(~routine.notNil, { ~routine.stop; }); if(~captureActive, { ~finishCapture.(); }); ~clock.clear; ~live.clear; 0.12.wait; ~voices.freeAll; ~clearSong.();',
      );
    } catch (error) {
      stopError = error;
    }
    // A cleanup failure must not leave an apparently running song, repeatedly
    // enqueue Stop, or prevent its recording from being finalized.
    this.playing = false;
    this.step = -1;
    if (this.noteCapture) this.noteCapture.phase = 'finished';
    if (this.songActive) {
      if (stopError) this.song.error ||= stopError.message;
      await this.finishSong(this.song.id);
    }
    if (stopError) throw stopError;
  }
  async audition(recipe, midi = 48, reverb = 0.05) {
    if (this.songActive) throw new Error('Stop song playback before auditioning sounds.');
    const code = synthDef('t_preview', recipe);
    await this.compile({ id: 't_preview', code });
    await this.command(auditionCode(midi, reverb));
  }
  async note(track, midi, voiceId, on) {
    if (!on) {
      await this.command(noteOffCode(voiceId), false);
      return;
    }
    if (this.songActive) throw new Error('Stop song playback before playing live notes.');
    await this.compile(track);
    // Keep note-on and its disconnect safeguard in one command to avoid an extra
    // round trip on the keyboard input path.
    await this.command(noteOnCode(track, midi, voiceId) + safetyReleaseCode(voiceId), false);
  }
  async startRecording(format = 'mp3') {
    if (this.songActive) throw new Error('Stop song playback before starting a manual recording.');
    if (!RECORDING_FORMATS.includes(format)) throw new Error('Unknown recording format.');
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
  /** @returns {import('../shared/playback.js').EngineStatus} */
  status() {
    return {
      state: this.state,
      error: this.error,
      audioError: this.audioError,
      playing: this.playing,
      recording: this.recording,
      noteCapture: this.noteCapture,
      song: this.song,
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
