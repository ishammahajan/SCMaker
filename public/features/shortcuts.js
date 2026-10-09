import { $ } from '../ui/dom.js';
import { KEY_MAP } from './keyboard.js';

export function bindShortcuts({ state, action, projectFiles, transport, keyboard, selectTrack }) {
  window.addEventListener(
    'keydown',
    action(async (event) => {
      if (!state.project || event.repeat) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        await projectFiles.save();
        return;
      }
      if (
        $('sound-dialog').open ||
        $('add-dialog').open ||
        event.target.closest('input,textarea,select,[contenteditable]')
      )
        return;
      if (event.key.toLowerCase() === 'r' && !event.altKey && !event.metaKey) {
        event.preventDefault();
        if (state.engine.state === 'ready') await transport.toggleNoteRecording(event.ctrlKey);
        return;
      }
      if (event.key === 'Escape') {
        keyboard.releaseAllKeys();
        if (state.engine.state === 'ready') {
          await transport.stop();
        }
        return;
      }
      if (event.key === ' ' && !event.target.closest('.piano-key')) {
        event.preventDefault();
        if (state.engine.state === 'ready') await transport.togglePlay();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && state.project.tracks[index]) {
        selectTrack(state.project.tracks[index].id);
        return;
      }
      const offset = KEY_MAP.indexOf(event.key.toLowerCase());
      if (offset >= 0) {
        event.preventDefault();
        keyboard.startKey(
          `key_${event.key.toLowerCase()}`,
          Number($('keyboard-octave').value) + offset,
        );
      }
    }),
  );
  window.addEventListener('keyup', (event) => keyboard.endKey(`key_${event.key.toLowerCase()}`));
  window.addEventListener('blur', keyboard.releaseAllKeys);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) keyboard.releaseAllKeys();
  });
  window.addEventListener('beforeunload', (event) => {
    keyboard.releaseAllKeys();
    if (projectFiles.isDirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}
