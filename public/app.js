import { $ } from './ui/dom.js';
import { createFeedback } from './ui/feedback.js';
import { createApiClient } from './api.js';
import { createStudioState } from './state.js';
import { createKeyboard } from './features/keyboard.js';
import { createTransport } from './features/transport.js';
import { createNoteRecording } from './features/note-recording.js';
import { createTracks } from './features/tracks.js';
import { createSequencer } from './features/sequencer/index.js';
import { createSoundEditor } from './features/sound-editor.js';
import { createProjectFiles } from './features/project-files.js';
import { bindShortcuts } from './features/shortcuts.js';

// Compose feature controllers here. Features do not import one another's controllers.
const state = createStudioState();
const { notify, action } = createFeedback();
const client = createApiClient();
const api = client.request;
const keyboard = createKeyboard({ state, api, notify, action });

// These callbacks are invoked only after all controllers have been constructed.
const markDirty = () => projectFiles.markDirty();
const renderTracks = () => tracks.render();
const transport = createTransport({
  state,
  api,
  notify,
  action,
  releaseAllKeys: keyboard.releaseAllKeys,
  paintStep: () => sequencer.paintStep(),
  captureNotes: (capture) => noteRecording.update(capture),
  beginCapture: (capture, prepared) => noteRecording.begin(capture, prepared),
  prepareCapture: (rerecord) => noteRecording.prepare(rerecord),
});
const tracks = createTracks({
  state,
  markDirty,
  selectTrack,
  openWorkshop: () => soundEditor.open(),
});
const sequencer = createSequencer({ state, notify, markDirty, renderTracks });
const noteRecording = createNoteRecording({
  state,
  markDirty,
  renderTracks,
  notify,
  renderRoll: sequencer.render,
  releaseAllKeys: keyboard.releaseAllKeys,
});
const soundEditor = createSoundEditor({
  state,
  api,
  notify,
  action,
  markDirty,
  renderTracks,
  releaseAllKeys: keyboard.releaseAllKeys,
  audition: keyboard.audition,
  renderRoll: sequencer.render,
});
const projectFiles = createProjectFiles({
  state,
  api,
  notify,
  action,
  selectTrack,
  releaseAllKeys: keyboard.releaseAllKeys,
  stopPlayback: transport.stop,
  onChange: transport.scheduleSync,
});

function selectTrack(id) {
  keyboard.releaseAllKeys();
  state.selectedTrackId = id;
  soundEditor.discardDraft();
  const rollBase = sequencer.selectTrack();
  $('keyboard-octave').value = String(Math.min(72, rollBase));
  $('prompt').value = '';
  $('edit-sound').disabled = false;
  tracks.render();
  soundEditor.render();
  keyboard.render();
  sequencer.render();
}

bindShortcuts({ state, action, projectFiles, transport, keyboard, selectTrack });

try {
  const { token } = await api('session');
  client.setToken(token);
  await projectFiles.openSavedProject();
  transport.poll();
} catch (error) {
  notify(`Could not open the studio: ${error.message}`, true);
}
