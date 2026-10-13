import { $ } from '../ui/dom.js';
import { KEY_MAP } from './keyboard.js';
import { currentProject } from '../state.js';

// Editable values and native selects own their keys, except workstation Space
// on selects. Sliders and buttons do not disable shortcuts just by having focus.
function ownsKeyboardInput(target) {
  if (target.isContentEditable || target.closest('textarea,select')) return true;
  const input = target.closest('input');
  return input && !['range', 'button', 'submit', 'reset', 'checkbox', 'radio'].includes(input.type);
}

export function bindShortcuts({ state, action, projectFiles, transport, keyboard, selectTrack }) {
  function claim(event) {
    event.preventDefault();
    event.stopPropagation();
    // Held shortcuts must not repeat actions or fall through to native controls.
    return !event.repeat;
  }

  window.addEventListener(
    'keydown',
    action(async (event) => {
      if (!state.project || event.isComposing || event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 's') {
        if (claim(event)) await projectFiles.save();
        return;
      }
      // Modal dialogs own all music commands. Native Escape dismisses the top
      // popover first, even if its current control is an editable field.
      if (document.querySelector('dialog[open]')) return;
      if (key === 'escape' && document.querySelector(':popover-open')) return;
      const selectSpace = key === ' ' && event.target.closest('select');
      if (ownsKeyboardInput(event.target) && !selectSpace) return;

      if (key === 'r' && !event.altKey && !event.metaKey) {
        if (claim(event) && state.engine.state === 'ready')
          await transport.toggleNoteRecording(event.ctrlKey);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (key === 'escape') {
        if (!claim(event)) return;
        keyboard.releaseAllKeys();
        if (state.engine.state === 'ready') await transport.stop();
        return;
      }
      if (key === ' ') {
        if (claim(event) && state.engine.state === 'ready') await transport.togglePlay();
        return;
      }
      if (/^[1-9]$/.test(key)) {
        if (!claim(event)) return;
        const track = currentProject(state).tracks[Number(key) - 1];
        if (track) selectTrack(track.id);
        return;
      }
      const offset = KEY_MAP.indexOf(key);
      if (offset >= 0 && claim(event)) {
        keyboard.startKey(`key_${key}`, Number($('keyboard-octave').value) + offset);
      }
    }),
    { capture: true },
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
