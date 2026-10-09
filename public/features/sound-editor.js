import { $, element, download, filename, togglePanel } from '../ui/dom.js';
import { currentTrack } from '../state.js';
import { CONTROLS, synthDef } from '/shared/music.js';

export function createSoundEditor({
  state,
  api,
  notify,
  action,
  markDirty,
  releaseAllKeys,
  audition,
  renderTracks,
  renderRoll,
}) {
  const getCurrentTrack = () => currentTrack(state);
  let draft = null;
  let promptGeneration = 0;
  function addVersion(description) {
    const track = getCurrentTrack();
    if (track.history.at(-1).code === track.code) return;
    track.history.push({
      prompt: description,
      recipe: structuredClone(track.recipe),
      code: track.code,
    });
    track.history = track.history.slice(-40);
    renderHistory();
  }
  function updateCode() {
    getCurrentTrack().code = synthDef(getCurrentTrack().id, getCurrentTrack().recipe);
    $('synth-code').textContent = getCurrentTrack().code;
  }
  function discardDraft() {
    draft = null;
    promptGeneration++;
    $('draft-panel').hidden = true;
  }
  function openWorkshop() {
    releaseAllKeys();
    $('sound-dialog').append($('notice'));
    $('sound-dialog').showModal();
  }
  function renderHistory() {
    $('history').replaceChildren();
    getCurrentTrack().history.forEach((version, i) => {
      const option = element('option', '', `${i + 1}. ${version.prompt}`);
      option.value = i;
      $('history').append(option);
    });
    $('history').value = getCurrentTrack().history.length - 1;
  }
  function formatControl(key, value) {
    if (key === 'brightness') return `${Math.round(value)} Hz`;
    if (key === 'attack' || key === 'release')
      return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
    return `${Math.round(value * 100)}%`;
  }
  function renderInstrument() {
    const track = getCurrentTrack();
    $('instrument-heading').textContent = track.name;
    $('sound-kind').textContent = track.recipe.kind.toUpperCase();
    $('wave').value = track.recipe.wave;
    const drum = ['kick', 'snare', 'hat'].includes(track.recipe.kind);
    $('wave').disabled = drum || track.recipe.kind === 'custom';
    $('percussion-note').hidden = !drum;
    $('controls').replaceChildren();
    Object.entries(CONTROLS).forEach(([key, spec]) => {
      const row = element('div', 'control-row');
      const label = element('label', '', spec.label);
      label.htmlFor = `control-${key}`;
      const slider = element('input');
      slider.id = `control-${key}`;
      slider.type = 'range';
      slider.min = spec.min;
      slider.max = spec.max;
      slider.step = spec.step;
      slider.value = track.recipe[key];
      const output = element('output', '', formatControl(key, track.recipe[key]));
      output.htmlFor = slider.id;
      slider.oninput = () => {
        discardDraft();
        track.recipe[key] = Number(slider.value);
        output.value = formatControl(key, track.recipe[key]);
        updateCode();
        markDirty();
      };
      slider.onchange = () => addVersion(`Manual ${spec.label.toLowerCase()} adjustment`);
      row.append(label, slider, output);
      $('controls').append(row);
    });
    $('synth-code').textContent = track.code;
    renderHistory();
  }

  $('edit-sound').onclick = openWorkshop;
  $('close-workshop').onclick = () => $('sound-dialog').close();
  $('sound-dialog').addEventListener('close', () => {
    releaseAllKeys();
    document.body.append($('notice'));
    $('edit-sound').focus({ preventScroll: true });
  });

  $('prompt-form').onsubmit = action(async (event) => {
    event.preventDefault();
    discardDraft();
    const generation = promptGeneration;
    const trackId = state.selectedTrackId;
    const prompt = $('prompt').value.trim();
    $('build').disabled = true;
    $('build').textContent = 'Building…';
    try {
      const result = await api('prompt', {
        prompt,
        current: getCurrentTrack().recipe,
        provider: $('prompt-provider').value,
        mode: $('prompt-mode').value,
      });
      if (generation !== promptGeneration || state.selectedTrackId !== trackId) return;
      draft = { ...result, prompt };
      $('draft-explanation').textContent = result.explanation;
      $('draft-panel').hidden = false;
    } finally {
      $('build').disabled = false;
      $('build').textContent = 'Build preview ↗';
    }
  });
  for (const id of ['prompt-provider', 'prompt-mode', 'prompt']) {
    $(id).addEventListener('input', discardDraft);
  }
  document.querySelectorAll('[data-prompt]').forEach((button) => {
    button.onclick = () => {
      discardDraft();
      $('prompt').value = button.dataset.prompt;
      $('prompt').focus();
    };
  });
  $('apply-draft').onclick = () => {
    if (!draft) return;
    getCurrentTrack().recipe = structuredClone(draft.recipe);
    updateCode();
    addVersion(draft.prompt);
    $('prompt-mode').value = 'refine';
    discardDraft();
    markDirty();
    renderInstrument();
    renderTracks();
    notify('Sound applied. Your sequence is unchanged.');
  };
  $('discard-draft').onclick = discardDraft;
  $('audition-original').onclick = action(() => audition());
  $('audition-draft').onclick = action(async () => {
    if (draft)
      await api('audition', {
        recipe: draft.recipe,
        midi: Number($('keyboard-octave').value),
        reverb: getCurrentTrack().reverb,
      });
  });
  $('audition').onclick = action(() => audition());
  $('wave').onchange = () => {
    discardDraft();
    getCurrentTrack().recipe.wave = $('wave').value;
    updateCode();
    addVersion('Manual oscillator change');
    markDirty();
  };
  $('restore-version').onclick = () => {
    const version = getCurrentTrack().history[Number($('history').value)];
    getCurrentTrack().recipe = structuredClone(version.recipe);
    updateCode();
    addVersion(`Restored: ${version.prompt}`.slice(0, 1000));
    discardDraft();
    markDirty();
    renderInstrument();
    renderTracks();
    notify('Earlier sound restored. Notes are unchanged.');
  };
  $('rename-track').onclick = () => {
    const name = window.prompt('Instrument name', getCurrentTrack().name)?.trim();
    if (!name) return;
    getCurrentTrack().name = name.slice(0, 60);
    markDirty();
    renderTracks();
    renderInstrument();
    renderRoll();
  };
  $('vocabulary-toggle').onclick = () => togglePanel('vocabulary-toggle', 'vocabulary');
  $('code-toggle').onclick = () => togglePanel('code-toggle', 'code-panel');
  $('export-code').onclick = () =>
    download(getCurrentTrack().code, `${filename(getCurrentTrack().name)}.scd`, 'text/plain');

  return { render: renderInstrument, discardDraft, open: openWorkshop };
}
