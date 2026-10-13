import { $, element } from '../ui/dom.js';
import { MAX_SECTIONS, MAX_ARRANGEMENT } from '/shared/music.js';

export function createArrangement({ state, action, markDirty, selectSection, stopPlayback }) {
  let busy = false;
  let songDisabled = false;
  let entryIndex = 0;
  function setDisabled(disabled) {
    songDisabled = disabled;
    $('arrangement-editor').disabled = busy || songDisabled;
    if (busy || songDisabled) {
      $('section-menu').hidePopover();
      $('entry-menu').hidePopover();
    }
  }
  async function changeSection(change) {
    if (busy || songDisabled) return;
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
    $('menu-summary').textContent = `Song: ${$('song-summary').textContent}`;
  }
  function sectionOptions(select) {
    select.replaceChildren();
    for (const section of state.project.sections) {
      const option = element('option', '', section.name);
      option.value = section.id;
      select.append(option);
    }
  }
  function paintPosition() {
    const song = state.engine.song;
    const active = song?.phase === 'playing';
    $('arrangement-list')
      .querySelectorAll('.arrangement-entry')
      .forEach((node, index) => {
        const playing = active && index === song.position;
        node.classList.toggle('playing', playing);
        if (playing) node.setAttribute('aria-current', 'step');
        else node.removeAttribute('aria-current');
      });
  }
  function renderEntryOptions() {
    const entry = state.project.arrangement[entryIndex];
    if (!entry) return;
    $('entry-heading').textContent = `Arrangement position ${entryIndex + 1}`;
    sectionOptions($('entry-section'));
    $('entry-section').value = entry.sectionId;
    $('entry-section').setAttribute('aria-label', `Section at position ${entryIndex + 1}`);
    $('entry-repeats').value = entry.repeats;
    $('entry-repeats').setAttribute('aria-label', `Repeats at position ${entryIndex + 1}`);
    $('entry-up').disabled = entryIndex === 0;
    $('entry-down').disabled = entryIndex === state.project.arrangement.length - 1;
    $('entry-remove').disabled = state.project.arrangement.length === 1;
  }
  function render() {
    const project = state.project;
    const selected = project.sections.find((section) => section.id === state.selectedSectionId);
    sectionOptions($('section-select'));
    $('section-select').value = selected.id;
    $('section-name').value = selected.name;
    $('editing-section').textContent = `Editing: ${selected.name}`;
    $('new-section').disabled = $('duplicate-section').disabled =
      project.sections.length >= MAX_SECTIONS;
    $('delete-section').disabled = project.sections.length === 1;
    $('append-section').disabled = project.arrangement.length >= MAX_ARRANGEMENT;
    const scrollLeft = $('arrangement-list').scrollLeft;
    $('arrangement-list').replaceChildren();
    project.arrangement.forEach((entry, index) => {
      const section = project.sections.find((section) => section.id === entry.sectionId);
      const row = element('div', 'arrangement-entry');
      const chip = element('button', 'arrangement-chip');
      chip.append(element('span', '', section.name), element('small', '', `×${entry.repeats}`));
      chip.setAttribute(
        'aria-label',
        `Edit ${section.name}, position ${index + 1}, ${entry.repeats} repeats`,
      );
      chip.setAttribute('aria-pressed', String(entry.sectionId === selected.id));
      chip.title = `${section.name} · ${entry.repeats * 2} bars`;
      chip.onclick = action(() => changeSection(() => selectSection(entry.sectionId)));
      const options = element('button', 'entry-options', '⋯');
      options.setAttribute('aria-label', `Options for position ${index + 1}`);
      options.setAttribute('aria-haspopup', 'dialog');
      options.onclick = () => {
        entryIndex = index;
        renderEntryOptions();
        $('entry-menu').showPopover({ source: options });
      };
      row.append(chip, options);
      $('arrangement-list').append(row);
    });
    $('arrangement-list').scrollLeft = scrollLeft;
    renderEntryOptions();
    paintPosition();
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
    $('arrangement-list').scrollLeft = $('arrangement-list').scrollWidth;
  };
  $('entry-section').onchange = () => {
    state.project.arrangement[entryIndex].sectionId = $('entry-section').value;
    markDirty();
    render();
  };
  $('entry-repeats').onchange = () => {
    state.project.arrangement[entryIndex].repeats = Math.max(
      1,
      Math.min(16, Math.floor(Number($('entry-repeats').value) || 1)),
    );
    markDirty();
    render();
  };
  for (const [id, delta] of /** @type {const} */ ([
    ['entry-up', -1],
    ['entry-down', 1],
  ])) {
    $(id).onclick = () => {
      const order = state.project.arrangement;
      const target = entryIndex + delta;
      if (target < 0 || target >= order.length) return;
      [order[entryIndex], order[target]] = [order[target], order[entryIndex]];
      entryIndex = target;
      markDirty();
      render();
    };
  }
  $('entry-remove').onclick = () => {
    if (state.project.arrangement.length === 1) return;
    state.project.arrangement.splice(entryIndex, 1);
    $('entry-menu').hidePopover();
    entryIndex = Math.min(entryIndex, state.project.arrangement.length - 1);
    markDirty();
    render();
  };

  return { render, updateSummary, setDisabled, paintPosition };
}
