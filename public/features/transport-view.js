import { isCapturing, isSongActive } from '../../shared/playback.js';

// Derive transport labels and control states from engine status without touching the DOM.
/**
 * @param {import('../../shared/playback.js').EngineStatus} engine
 * @param {{ songScope: boolean, songBusy: boolean, captureBusy: boolean, recordingBusy: boolean }} flags
 */
export function transportView(engine, { songScope, songBusy, captureBusy, recordingBusy }) {
  const ready = engine.state === 'ready';
  const activeSong = isSongActive(engine.song);
  const recording = Boolean(engine.recording);
  const capture = engine.noteCapture;
  const capturing = isCapturing(capture);
  return {
    status: statusText(engine),
    light: ready ? '' : engine.state === 'error' ? 'error' : 'waiting',
    disabled: {
      stop: !ready,
      play:
        !ready ||
        songBusy ||
        captureBusy ||
        (activeSong && !engine.playing) ||
        (songScope && !activeSong && recording),
      record: !ready || recordingBusy || songBusy || activeSong,
      recordingFormat: !ready || recordingBusy || songBusy || activeSong || recording,
      playbackScope: songBusy || captureBusy || activeSong || engine.playing || recording,
      arrangement: songBusy || activeSong,
      audition: !ready || activeSong,
      recordNotes: !ready || captureBusy || songBusy || activeSong,
    },
    capturing,
    recordNotesLabel: !capturing
      ? 'Record notes'
      : capture.phase === 'count-in'
        ? `Count-in: ${capture.countIn} · Stop`
        : 'Stop recording notes',
    playIcon: engine.playing ? '■' : '▶',
    playLabel: engine.playing ? ' Stop' : ' Play',
    playAria: playAria(engine.playing, activeSong, songScope),
    recording,
    recordLabel: recordLabel(recording, activeSong),
    recordAria: recordAria(recording, activeSong, songScope),
  };
}

/**
 * @param {import('../../shared/playback.js').Song | null} song
 * @param {number} step
 */
export function songPositionText(song, step) {
  if (!song) return '';
  if (song.phase === 'playing') {
    const entry = song.entries[song.position];
    const bar = Math.floor(Math.max(0, step) / 16) + 1;
    return `${song.position + 1}/${song.entries.length}: ${entry.name} · repeat ${song.repeat}/${entry.repeats} · bar ${bar}/2`;
  }
  if (song.phase === 'tail') return 'Ending tail…';
  if (song.phase === 'finishing') return 'Preparing recording…';
  return 'Song stopped';
}

function statusText(engine) {
  if (engine.state !== 'ready') return engine.error || 'Starting SuperCollider…';
  if (engine.audioError) return `Audio stopped: ${engine.audioError}`;
  return 'SuperCollider connected · audio plays on this computer';
}

function playAria(playing, activeSong, songScope) {
  if (playing) return activeSong ? 'Stop song' : 'Stop loop';
  return songScope ? 'Play song' : 'Play loop';
}

function recordLabel(recording, activeSong) {
  if (!recording) return 'Record';
  return activeSong ? 'Recording…' : 'Finish take';
}

function recordAria(recording, activeSong, songScope) {
  if (recording) return activeSong ? 'Recording song' : 'Finish take';
  return songScope ? 'Record song' : 'Record stereo audio';
}
