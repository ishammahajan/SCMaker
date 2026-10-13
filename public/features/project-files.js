import { $, download, filename } from '../ui/dom.js';
import { defaultProject, makeSong, makeTrack, MAX_PROJECT_BYTES } from '/shared/music.js';

export function createProjectFiles({
  state,
  api,
  notify,
  action,
  selectSection,
  releaseAllKeys,
  stopPlayback,
  onChange,
}) {
  let dirty = false;
  let changeVersion = 0;
  function markDirty() {
    dirty = true;
    changeVersion++;
    $('saved-state').textContent = 'Unsaved changes';
    onChange();
  }
  async function saveProject() {
    // Ctrl+S can happen before a focused field emits its change event.
    const name = $('project-name').value.trim().slice(0, 100) || 'Untitled';
    const tempo = Math.max(40, Math.min(240, Number($('tempo').value) || 108));
    if (state.project.name !== name || state.project.tempo !== tempo) {
      state.project.name = name;
      state.project.tempo = tempo;
      markDirty();
    }
    $('project-name').value = name;
    $('tempo').value = tempo;
    const revision = changeVersion;
    await api('project', { project: state.project });
    if (revision === changeVersion) {
      dirty = false;
      $('saved-state').textContent = 'Saved on this computer';
    }
    notify('Project saved. Sections, arrangement, exact sounds, and notes included.');
  }
  async function loadProject(value) {
    const validated = makeSong(value);
    releaseAllKeys();
    if (state.engine.playing) {
      await stopPlayback();
    }
    state.project = validated;
    $('project-name').value = state.project.name;
    $('tempo').value = state.project.tempo;
    await selectSection(state.project.sections[0].id);
    markDirty();
  }

  async function openSavedProject() {
    let restored = false;
    try {
      const result = await api('project');
      state.project = makeSong(result.project);
      restored = result.restored;
    } catch (error) {
      state.project = makeSong(defaultProject());
      notify(`${error.message} Showing an unsaved starter instead.`, true);
    }
    $('project-name').value = state.project.name;
    $('tempo').value = state.project.tempo;
    $('saved-state').textContent = restored
      ? 'Saved on this computer'
      : 'Starter sketch · not yet saved';
    await selectSection(state.project.sections[0].id);
  }

  $('save').onclick = action(saveProject);
  $('project-name').onchange = () => {
    const name = $('project-name').value.trim().slice(0, 100) || 'Untitled';
    state.project.name = name;
    $('project-name').value = name;
    markDirty();
  };
  $('tempo').onchange = () => {
    state.project.tempo = Math.max(40, Math.min(240, Number($('tempo').value) || 108));
    $('tempo').value = state.project.tempo;
    markDirty();
  };
  $('export-project').onclick = () =>
    download(
      JSON.stringify(state.project, null, 2),
      `${filename(state.project.name)}.json`,
      'application/json',
    );
  $('import-project').onclick = () => {
    if (
      !dirty ||
      confirm('Open a project file? Unsaved changes in the current project will be replaced.')
    )
      $('project-file').click();
  };
  $('project-file').onchange = action(async () => {
    const file = $('project-file').files[0];
    try {
      if (!file) return;
      if (file.size > MAX_PROJECT_BYTES) throw new Error('Project exceeds the 16 MiB data limit.');
      await loadProject(JSON.parse(await file.text()));
      notify('Project opened. Save to keep it on this computer.');
    } finally {
      $('project-file').value = '';
    }
  });
  $('new-project').onclick = action(async () => {
    if (dirty && !confirm('Start an empty project? Unsaved changes will be replaced.')) return;
    await loadProject({
      version: 1,
      name: 'Untitled sketch',
      tempo: 108,
      tracks: [makeTrack('bass', 't_bass', 'Bass 01')],
    });
  });

  return { markDirty, save: saveProject, openSavedProject, isDirty: () => dirty };
}
