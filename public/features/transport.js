import { $, element, togglePanel } from '../ui/dom.js';

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
}) {
  let syncTimer;
  let syncInFlight = false;
  let syncWanted = false;
  let syncedEngine = false;
  let captureBusy = false;
  let recordingBusy = false;
  function scheduleSync() {
    if (state.engine.state !== 'ready') return;
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
      await api('sync', { project: state.project });
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
    if (state.engine.playing) {
      releaseAllKeys();
      state.engine = await api('stop', {});
    } else {
      clearTimeout(syncTimer);
      state.engine = await api('play', { project: state.project });
    }
    paintEngine();
  }
  function paintEngine() {
    const ready = state.engine.state === 'ready';
    $('engine-status').textContent = ready
      ? 'SuperCollider connected · audio plays on this computer'
      : state.engine.error || 'Starting SuperCollider…';
    $('engine-light').className =
      `status-light${ready ? '' : state.engine.state === 'error' ? ' error' : ' waiting'}`;
    for (const id of ['play', 'stop', 'record', 'audition', 'audition-original', 'audition-draft'])
      $(id).disabled = !ready;
    $('record').disabled = !ready || recordingBusy;
    $('recording-format').disabled = !ready || recordingBusy || Boolean(state.engine.recording);
    captureNotes(state.engine.noteCapture);
    if (syncWanted && !syncInFlight && state.engine.noteCapture?.phase === 'finished') {
      syncWanted = false;
      scheduleSync();
    }
    const capture = state.engine.noteCapture;
    const capturing = capture && capture.phase !== 'finished';
    $('record-notes').disabled = !ready || captureBusy;
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
    $('play').setAttribute('aria-label', state.engine.playing ? 'Stop loop' : 'Play loop');
    $('record').classList.toggle('active', Boolean(state.engine.recording));
    $('record').replaceChildren(
      element('span', 'record-dot'),
      document.createTextNode(state.engine.recording ? 'Finish take' : 'Record'),
    );
    if (!$('engine-log').hidden) $('engine-log').textContent = state.engine.log;
    paintStep();
  }
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
    if (captureBusy) return;
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
    if (recordingBusy) return;
    recordingBusy = true;
    paintEngine();
    try {
      if (state.engine.recording) {
        $('recording-result').textContent = 'Finishing and preparing download…';
        const result = await api('record/stop', {});
        state.engine.recording = null;
        const format = result.name.split('.').at(-1).toUpperCase();
        const link = element('a', '', `↓ Download stereo take (${format})`);
        link.href = result.url;
        link.download = result.name;
        $('recording-result').replaceChildren(link);
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
