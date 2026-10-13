import { $, element, togglePanel } from '../ui/dom.js';
import { currentProject } from '../state.js';

export function createTransport({
  state,
  api,
  notify,
  action,
  releaseAllKeys,
  paintStep,
  captureNotes,
  beginCapture,
  prepareCapture,
  disableArrangement,
  paintArrangement,
}) {
  let syncTimer;
  let syncInFlight = false;
  let syncWanted = false;
  let syncedEngine = false;
  let captureBusy = false;
  let recordingBusy = false;
  let songBusy = false;
  let handledSongId = null;
  let lastAudioError = null;
  const songScope = () => $('playback-scope').value === 'song';
  const songActive = () => ['playing', 'tail', 'finishing'].includes(state.engine.song?.phase);
  function scheduleSync() {
    if (state.engine.state !== 'ready' || songActive()) return;
    // Keep the take's tempo and backing sequence fixed. Sync edits after it finishes.
    if (
      captureBusy ||
      (state.engine.noteCapture && state.engine.noteCapture.phase !== 'finished')
    ) {
      syncWanted = true;
      return;
    }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncAudio(), 180);
  }
  async function syncAudio() {
    if (songActive()) return;
    if (
      captureBusy ||
      (state.engine.noteCapture && state.engine.noteCapture.phase !== 'finished')
    ) {
      syncWanted = true;
      return;
    }
    if (syncInFlight) {
      syncWanted = true;
      return;
    }
    syncInFlight = true;
    try {
      await api('sync', { project: currentProject(state) });
    } catch (error) {
      notify(`Audio update failed: ${error.message}`, true);
    } finally {
      syncInFlight = false;
      if (syncWanted) {
        syncWanted = false;
        scheduleSync();
      }
    }
  }
  async function togglePlay() {
    if (songBusy || captureBusy) return;
    if (!state.engine.playing && songScope()) return startSong(false);
    if (state.engine.playing) {
      releaseAllKeys();
      state.engine = await api('stop', {});
    } else {
      clearTimeout(syncTimer);
      state.engine = await api('play', { project: currentProject(state) });
    }
    paintEngine();
  }
  function paintEngine() {
    const ready = state.engine.state === 'ready';
    $('engine-status').textContent = ready
      ? state.engine.audioError
        ? `Audio stopped: ${state.engine.audioError}`
        : 'SuperCollider connected · audio plays on this computer'
      : state.engine.error || 'Starting SuperCollider…';
    $('engine-status').title = $('engine-status').textContent;
    if (state.engine.audioError && state.engine.audioError !== lastAudioError)
      notify(state.engine.audioError, true);
    lastAudioError = state.engine.audioError;
    $('engine-light').className =
      `status-light${ready ? '' : state.engine.state === 'error' ? ' error' : ' waiting'}`;
    $('stop').disabled = !ready;
    const activeSong = songActive();
    $('play').disabled =
      !ready ||
      songBusy ||
      captureBusy ||
      (activeSong && !state.engine.playing) ||
      (songScope() && !activeSong && Boolean(state.engine.recording));
    $('record').disabled = !ready || recordingBusy || songBusy || activeSong;
    $('recording-format').disabled =
      !ready || recordingBusy || songBusy || activeSong || Boolean(state.engine.recording);
    $('playback-scope').disabled =
      songBusy ||
      captureBusy ||
      activeSong ||
      state.engine.playing ||
      Boolean(state.engine.recording);
    disableArrangement(songBusy || activeSong);
    for (const id of ['audition', 'audition-original', 'audition-draft'])
      $(id).disabled = !ready || activeSong;
    paintSong();
    captureNotes(state.engine.noteCapture);
    if (syncWanted && !syncInFlight && state.engine.noteCapture?.phase === 'finished') {
      syncWanted = false;
      scheduleSync();
    }
    const capture = state.engine.noteCapture;
    const capturing = capture && capture.phase !== 'finished';
    $('record-notes').disabled = !ready || captureBusy || songBusy || activeSong;
    $('record-notes').setAttribute('aria-pressed', String(Boolean(capturing)));
    $('record-notes').textContent = capturing
      ? capture.phase === 'count-in'
        ? `Count-in: ${capture.countIn} · Stop`
        : 'Stop recording notes'
      : 'Record notes';
    $('play').replaceChildren(
      element('span', '', state.engine.playing ? '■' : '▶'),
      document.createTextNode(state.engine.playing ? ' Stop' : ' Play'),
    );
    $('play').setAttribute(
      'aria-label',
      state.engine.playing
        ? activeSong
          ? 'Stop song'
          : 'Stop loop'
        : songScope()
          ? 'Play song'
          : 'Play loop',
    );
    $('record').classList.toggle('active', Boolean(state.engine.recording));
    $('record').replaceChildren(
      element('span', 'record-dot'),
      document.createTextNode(
        activeSong && state.engine.recording
          ? 'Recording…'
          : state.engine.recording
            ? 'Finish take'
            : 'Record',
      ),
    );
    $('record').setAttribute(
      'aria-label',
      activeSong && state.engine.recording
        ? 'Recording song'
        : state.engine.recording
          ? 'Finish take'
          : songScope()
            ? 'Record song'
            : 'Record stereo audio',
    );
    if (!$('engine-log').hidden) $('engine-log').textContent = state.engine.log;
    paintStep();
  }
  function showRecording(name, url) {
    const format = name.split('.').at(-1).toUpperCase();
    const link = element('a', '', `↓ Download stereo take (${format})`);
    link.href = url;
    link.download = name;
    $('recording-result').replaceChildren(link);
  }
  function paintSong() {
    paintArrangement();
    const song = state.engine.song;
    if (!song) {
      $('song-position').textContent = '';
      return;
    }
    if (song.phase === 'playing') {
      const entry = song.entries[song.position];
      $('song-position').textContent =
        `${song.position + 1}/${song.entries.length}: ${entry.name} · repeat ${song.repeat}/${entry.repeats} · bar ${Math.floor(Math.max(0, state.engine.step) / 16) + 1}/2`;
    } else {
      $('song-position').textContent =
        song.phase === 'tail'
          ? 'Ending tail…'
          : song.phase === 'finishing'
            ? 'Preparing recording…'
            : 'Song stopped';
    }
    $('song-position').title = $('song-position').textContent;
    if (song.phase === 'finished' && handledSongId !== song.id) {
      handledSongId = song.id;
      if (song.error) {
        $('recording-result').textContent = song.error;
        notify(song.error, true);
      } else if (song.name) {
        showRecording(song.name, song.url);
        notify('Song recording finished.');
      }
      scheduleSync();
    }
  }
  async function startSong(recorded) {
    if (songBusy || songActive()) return;
    songBusy = true;
    releaseAllKeys();
    clearTimeout(syncTimer);
    paintEngine();
    try {
      if (state.engine.noteCapture && state.engine.noteCapture.phase !== 'finished') await stop();
      state.engine = await api(recorded ? 'song/record' : 'song/play', {
        project: state.project,
        ...(recorded ? { format: $('recording-format').value } : {}),
      });
      if (recorded) $('recording-result').textContent = 'Recording arranged song…';
      notify(
        'Playing the arrangement. Workspace edits apply next time. Playback stops after the ending tail.',
      );
    } finally {
      songBusy = false;
      paintEngine();
      if (!songActive()) scheduleSync();
    }
  }
  $('playback-scope').onchange = paintEngine;

  async function pollEngine() {
    try {
      state.engine = await api('status');
      paintEngine();
      if (state.engine.state === 'ready' && !syncedEngine) {
        syncedEngine = true;
        scheduleSync();
      }
    } catch (error) {
      $('engine-status').textContent = `Connection lost: ${error.message}`;
    } finally {
      setTimeout(pollEngine, document.hidden ? 1500 : 120);
    }
  }

  async function stop() {
    releaseAllKeys();
    state.engine = await api('stop', {});
    paintEngine();
  }

  async function toggleNoteRecording(rerecord = false) {
    if (captureBusy || songBusy || songActive()) return;
    captureBusy = true;
    $('record-notes').disabled = true;
    try {
      const capture = state.engine.noteCapture;
      if (capture && capture.phase !== 'finished') {
        await stop();
        if (!rerecord) return;
      }
      const prepared = prepareCapture(rerecord);
      if (!prepared) return;
      releaseAllKeys();
      clearTimeout(syncTimer);
      state.engine = await api('notes/start', {
        project: prepared.project,
        trackId: prepared.trackId,
        velocity: Number($('note-velocity').value) / 100,
      });
      beginCapture(state.engine.noteCapture, prepared);
      notify('One-bar count-in, then record notes for two bars. Existing notes are kept.');
    } finally {
      captureBusy = false;
      paintEngine();
    }
  }
  $('record-notes').onclick = action(() => toggleNoteRecording());
  $('play').onclick = action(togglePlay);
  $('stop').onclick = action(stop);
  $('record').onclick = action(async () => {
    if (recordingBusy || songBusy || songActive()) return;
    if (songScope() && !state.engine.recording) return startSong(true);
    recordingBusy = true;
    paintEngine();
    try {
      if (state.engine.recording) {
        $('recording-result').textContent = 'Finishing and preparing download…';
        const result = await api('record/stop', {});
        state.engine.recording = null;
        showRecording(result.name, result.url);
        notify('Stereo recording finished.');
      } else {
        const { name } = await api('record/start', { format: $('recording-format').value });
        state.engine.recording = name;
        $('recording-result').textContent = 'Recording master output…';
        notify('Recording started. Press Play or audition a sound.');
      }
    } catch (error) {
      $('recording-result').textContent = error.message;
      throw error;
    } finally {
      recordingBusy = false;
      paintEngine();
    }
  });
  $('engine-log-toggle').onclick = () => {
    togglePanel('engine-log-toggle', 'engine-log');
    $('engine-log').textContent = state.engine.log;
  };

  return { scheduleSync, togglePlay, toggleNoteRecording, stop, poll: pollEngine };
}
