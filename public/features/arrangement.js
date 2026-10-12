import { $, element } from '../ui/dom.js';
import { MAX_SECTIONS, MAX_ARRANGEMENT } from '/shared/music.js';

export function createArrangement({ state, action, markDirty, selectSection, stopPlayback }) {
  let busy = false;
  let songDisabled = false;
  function setDisabled(disabled) {
    songDisabled = disabled;
    $('arrangement-editor').disabled = busy || songDisabled;
  }
  async function changeSection(change) {
    if (busy) return;
    busy = true;
    setDisabled(songDisabled);
    try {
      await change();
    } finally {
      busy = false;
      setDisabled(songDisabled);
    }
  }
  function updateSummary() {
    const bars = state.project.arrangement.reduce((sum, entry) => sum + entry.repeats * 2, 0);
    const seconds = Math.round((bars * 4 * 60) / state.project.tempo);
    $('song-summary').textContent =
      `${bars} bars · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function render() {
    const project = state.project;
    $('section-select').replaceChildren();
    for (const section of project.sections) {
      const option = element('option', '', section.name);
      option.value = section.id;
      $('section-select').append(option);
    }
    $('section-select').value = state.selectedSectionId;
    $('section-name').value = project.sections.find(
      (section) => section.id === state.selectedSectionId,
    ).name;
    $('new-section').disabled = $('duplicate-section').disabled =
      project.sections.length >= MAX_SECTIONS;
    $('delete-section').disabled = project.sections.length === 1;
    $('append-section').disabled = project.arrangement.length >= MAX_ARRANGEMENT;
    $('arrangement-list').replaceChildren();
    project.arrangement.forEach((entry, index) => {
      const row = element('div', 'arrangement-row');
      const select = element('select');
      select.setAttribute('aria-label', `Section at position ${index + 1}`);
      for (const section of project.sections) {
        const option = element('option', '', section.name);
        option.value = section.id;
        select.append(option);
      }
      select.value = entry.sectionId;
      select.onchange = () => {
        entry.sectionId = select.value;
        markDirty();
      };
      const repeats = element('input');
      repeats.type = 'number';
      repeats.min = 1;
      repeats.max = 16;
      repeats.value = entry.repeats;
      repeats.setAttribute('aria-label', `Repeats at position ${index + 1}`);
      repeats.onchange = () => {
        entry.repeats = Math.max(1, Math.min(16, Math.floor(Number(repeats.value) || 1)));
        repeats.value = entry.repeats;
        markDirty();
      };
      row.append(
        element('span', 'muted', `${index + 1}.`),
        select,
        element('span', '', '×'),
        repeats,
      );
      for (const [label, text, delta] of [
        ['Move up', '↑', -1],
        ['Move down', '↓', 1],
      ]) {
        const button = element('button', 'subtle', text);
        button.setAttribute('aria-label', `${label} position ${index + 1}`);
        button.disabled = index + delta < 0 || index + delta >= project.arrangement.length;
        button.onclick = () => {
          [project.arrangement[index], project.arrangement[index + delta]] = [
            project.arrangement[index + delta],
            entry,
          ];
          markDirty();
          render();
        };
        row.append(button);
      }
      const remove = element('button', 'subtle', '×');
      remove.setAttribute('aria-label', `Remove position ${index + 1}`);
      remove.disabled = project.arrangement.length === 1;
      remove.onclick = () => {
        project.arrangement.splice(index, 1);
        markDirty();
        render();
      };
      row.append(remove);
      $('arrangement-list').append(row);
    });
    updateSummary();
  }

  async function addSection(duplicate) {
    if (state.project.sections.length >= MAX_SECTIONS) return;
    if (state.engine.playing) await stopPlayback();
    const source = state.project.sections.find((section) => section.id === state.selectedSectionId);
    const section = structuredClone(source);
    section.id = `s_${crypto.randomUUID().replaceAll('-', '')}`;
    section.name = duplicate
      ? `${source.name.slice(0, 55)} copy`
      : `Section ${state.project.sections.length + 1}`;
    if (!duplicate)
      section.tracks.forEach((track) => {
        track.notes = [];
      });
    state.project.sections.push(section);
    await selectSection(section.id);
    markDirty();
  }

  $('section-select').onchange = action(() =>
    changeSection(() => selectSection($('section-select').value)),
  );
  $('section-name').onchange = () => {
    const section = state.project.sections.find(
      (section) => section.id === state.selectedSectionId,
    );
    section.name = $('section-name').value.trim().slice(0, 60) || 'Untitled section';
    markDirty();
    render();
  };
  $('new-section').onclick = action(() => changeSection(() => addSection(false)));
  $('duplicate-section').onclick = action(() => changeSection(() => addSection(true)));
  $('delete-section').onclick = action(() =>
    changeSection(async () => {
      const project = state.project;
      if (
        project.sections.length === 1 ||
        !confirm('Delete this section and its arrangement entries?')
      )
        return;
      if (state.engine.playing) await stopPlayback();
      project.sections = project.sections.filter(
        (section) => section.id !== state.selectedSectionId,
      );
      project.arrangement = project.arrangement.filter(
        (entry) => entry.sectionId !== state.selectedSectionId,
      );
      if (!project.arrangement.length)
        project.arrangement.push({ sectionId: project.sections[0].id, repeats: 1 });
      await selectSection(project.sections[0].id);
      markDirty();
    }),
  );
  $('append-section').onclick = () => {
    if (state.project.arrangement.length >= MAX_ARRANGEMENT) return;
    state.project.arrangement.push({ sectionId: state.selectedSectionId, repeats: 1 });
    markDirty();
    render();
  };

  return { render, updateSummary, setDisabled };
}
