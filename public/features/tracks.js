import { $, element } from '../ui/dom.js';
import { makeTrack } from '/shared/music.js';
import { TRACK_COLORS, currentProject, currentTrack } from '../state.js';

export function createTracks({ state, markDirty, selectTrack, openWorkshop }) {
  const narrow = matchMedia('(max-width: 640px)');
  function configureDrawer() {
    const drawer = $('instrument-drawer');
    if (narrow.matches) drawer.setAttribute('popover', 'auto');
    else {
      if (drawer.hasAttribute('popover')) drawer.hidePopover();
      drawer.removeAttribute('popover');
    }
  }
  configureDrawer();
  narrow.addEventListener('change', configureDrawer);

  function renderTracks() {
    const project = currentProject(state);
    const scrollTop = $('tracks').scrollTop;
    $('track-count').textContent = project.tracks.length;
    $('tracks').replaceChildren();
    project.tracks.forEach((track, index) => {
      const card = element(
        'div',
        `track-card${track.id === state.selectedTrackId ? ' selected' : ''}`,
      );
      card.style.setProperty('--track-color', TRACK_COLORS[index % TRACK_COLORS.length]);
      const head = element('div', 'track-head');
      head.append(element('span', 'track-number', String(index + 1).padStart(2, '0')));
      const select = element('button', 'track-select');
      select.setAttribute('aria-pressed', String(track.id === state.selectedTrackId));
      select.title = track.name;
      select.append(
        element('strong', '', track.name),
        element('small', '', `${track.recipe.kind} · ${track.notes.length} notes`),
      );
      select.onclick = () => {
        selectTrack(track.id);
        if (narrow.matches) $('instrument-drawer').hidePopover();
      };
      const mute = element('button', 'mute', 'M');
      mute.setAttribute('aria-label', `Mute ${track.name}`);
      mute.setAttribute('aria-pressed', String(track.muted));
      mute.onclick = () => {
        track.muted = !track.muted;
        mute.setAttribute('aria-pressed', String(track.muted));
        markDirty();
      };
      head.append(select, mute);
      card.append(head);
      $('tracks').append(card);
    });
    $('tracks').scrollTop = scrollTop;
    if (!narrow.matches || $('instrument-drawer').matches(':popover-open'))
      $('tracks').querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
    renderMix();
  }
  function renderMix() {
    const track = currentTrack(state);
    $('track-mix').replaceChildren();
    const heading = element('div', 'mix-heading', track.name);
    heading.title = `Mix for ${track.name}`;
    $('track-mix').append(heading);
    for (const [key, label] of [
      ['volume', 'Level'],
      ['reverb', 'Verb'],
    ]) {
      const row = element('label', 'track-control');
      const slider = element('input');
      slider.type = 'range';
      slider.min = 0;
      slider.max = 100;
      slider.value = Math.round(track[key] * 100);
      slider.setAttribute('aria-label', `${label} for ${track.name}`);
      const output = element('output', '', slider.value);
      slider.oninput = () => {
        track[key] = Number(slider.value) / 100;
        output.value = slider.value;
        markDirty();
      };
      row.append(element('span', '', label), slider, output);
      $('track-mix').append(row);
    }
  }

  $('add-track').onclick = () => {
    $('new-name').value =
      `Voice ${String(currentProject(state).tracks.length + 1).padStart(2, '0')}`;
    $('add-dialog').showModal();
  };
  $('cancel-add').onclick = () => $('add-dialog').close();
  $('add-form').onsubmit = (event) => {
    event.preventDefault();
    const track = makeTrack(
      $('new-kind').value,
      `t_${crypto.randomUUID().replaceAll('-', '')}`,
      $('new-name').value.trim().slice(0, 60) || 'New voice',
    );
    currentProject(state).tracks.push(track);
    $('add-dialog').close();
    selectTrack(track.id);
    markDirty();
    if (track.recipe.kind === 'custom') {
      $('prompt-provider').value = 'llm';
      $('prompt-mode').value = 'create';
      $('prompt').value = '';
    } else {
      $('prompt-mode').value = 'refine';
    }
    openWorkshop();
  };

  return { render: renderTracks };
}
