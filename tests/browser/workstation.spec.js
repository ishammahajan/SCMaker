import { test, expect } from '@playwright/test';
import { defaultProject, makeTrack, makeSong } from '../../shared/music.js';

function workstationProject() {
  const loop = defaultProject();
  loop.tempo = 240;
  loop.tracks = Array.from({ length: 36 }, (_, index) =>
    makeTrack('bass', `t_voice_${index}`, `Voice ${String(index + 1).padStart(2, '0')}`),
  );
  loop.tracks[35].notes = [{ id: 'last_voice', start: 0, midi: 48, length: 4, velocity: 0.4 }];
  const song = makeSong(loop);
  song.sections[0].name = 'Intro';
  for (const name of ['Chorus', 'Unused variation']) {
    const section = structuredClone(song.sections[0]);
    section.id = `s_${name.split(' ')[0].toLowerCase()}`;
    section.name = name;
    song.sections.push(section);
  }
  song.arrangement = Array.from({ length: 32 }, (_, index) => ({
    sectionId: song.sections[index % 2].id,
    repeats: 1,
  }));
  return song;
}

test.afterEach(async ({ request }) => {
  const { token } = await (await request.get('/api/session')).json();
  const headers = { 'X-SCMaker-Token': token };
  await request.post('/api/stop', { headers, data: {} });
  await request.post('/api/project', { headers, data: { project: defaultProject() } });
});

async function expectSingleScreen(page) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.height);
  for (const selector of [
    '.topbar',
    '.song-strip',
    '.sequencer',
    '.roll-scroll',
    '.keyboard-panel',
    '.statusbar',
    '#play',
    '#record',
    '#save',
    '#section-select',
  ]) {
    const box = await page.locator(selector).boundingBox();
    expect(box, selector).not.toBeNull();
    expect(box.y, selector).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, selector).toBeLessThanOrEqual(dimensions.height + 1);
    expect(box.x, selector).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, selector).toBeLessThanOrEqual(dimensions.width + 1);
  }
  expect((await page.locator('.roll-scroll').boundingBox()).height).toBeGreaterThan(80);
}

test('many instruments and a long arrangement fit one screen, save, reopen, and remain editable', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('#engine-status')).toContainText('SuperCollider connected', {
    timeout: 35000,
  });
  await page.locator('#project-file').setInputFiles({
    name: 'many-voices.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(workstationProject())),
  });
  await expect(page.locator('.track-card')).toHaveCount(36);
  await expect(page.locator('.arrangement-entry')).toHaveCount(32);
  await expectSingleScreen(page);
  expect(await page.locator('#tracks').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  expect(
    await page.locator('#arrangement-list').evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true);
  // Adding beyond four is a normal action, not an import-only escape hatch.
  await page.locator('#add-track').click();
  await page.locator('#new-kind').selectOption('bass');
  await page.locator('#add-form button[type="submit"]').click();
  await expect(page.locator('.track-card')).toHaveCount(37);
  await expect(page.locator('#add-track')).toBeEnabled();
  await page.locator('#close-workshop').click();
  await expect(page.locator('.track-card.selected')).toHaveCSS(
    'border-top-color',
    'rgb(203, 239, 135)',
  );
  const mute = page.getByRole('button', { name: 'Mute Voice 01', exact: true });
  await mute.scrollIntoViewIfNeeded();
  await mute.focus();
  const scrollTop = await page.locator('#tracks').evaluate((el) => el.scrollTop);
  await page.keyboard.press('Space');
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Stop loop');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await expect(mute).toBeFocused();
  expect(await page.locator('#tracks').evaluate((el) => el.scrollTop)).toBe(scrollTop);
  await page.keyboard.press('Space');
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play loop');
  await page.keyboard.press('Enter');
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.cell[data-start="0"][data-midi="48"]').click();
  await page.getByLabel('Level for Voice 37', { exact: true }).focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.locator('#save').click();
  await expect(page.locator('#saved-state')).toHaveText('Saved on this computer');
  await page.reload();
  await expect(page.locator('.track-card')).toHaveCount(37);
  await expect(page.locator('.arrangement-entry')).toHaveCount(32);
  const saved = (await (await page.request.get('/api/project')).json()).project;
  expect(saved.sections[0].tracks[36].notes).toHaveLength(1);
  expect(saved.sections[0].tracks[36].volume).toBe(0.01);
  await page.locator('#section-select').selectOption('s_unused');
  await expect(page.locator('#editing-section')).toHaveText('Editing: Unused variation');
  await expect(page.locator('.arrangement-chip[aria-pressed="true"]')).toHaveCount(0);
  await page.locator('.arrangement-chip').last().click();
  await expect(page.locator('#editing-section')).toHaveText('Editing: Chorus');
  await page.locator('#playback-scope').selectOption('song');
  await page.locator('#play').click();
  await expect(page.locator('.arrangement-entry.playing')).toHaveCount(1);
  await expect(page.locator('.arrangement-entry').first()).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#editing-section')).toHaveText('Editing: Chorus');
  await expect(page.locator('#playhead')).toBeHidden();
  await page.locator('#stop').click();
  await expect(page.locator('.arrangement-entry.playing')).toHaveCount(0);
  await page.locator('#keyboard-toggle').click();
  await expect(page.locator('#keyboard')).toBeHidden();
  await expect(page.locator('#keyboard-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#keyboard-toggle').click();
  await expect(page.locator('#keyboard')).toBeVisible();
  await page.screenshot({ path: 'test-results/workstation-laptop.png' });

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expectSingleScreen(page);
    if (viewport.width <= 640) {
      await expect(page.locator('#instrument-drawer')).toBeHidden();
      await page.locator('#instruments-toggle').click();
      await expect(page.locator('#instrument-drawer')).toBeVisible();
      await page.locator('.track-select').last().click();
      await expect(page.locator('#instrument-drawer')).toBeHidden();
      await expect(page.locator('#sequencer-heading')).toContainText('Voice 36');
      await page.locator('#section-options').click();
      await expect(page.locator('#section-name')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#section-name')).toBeHidden();
      if (viewport.width === 320) {
        await page.locator('#playback-scope').selectOption('section');
        await page.locator('#recording-format').selectOption('wav');
        await page.locator('#record').click();
        await expect(page.locator('#record')).toContainText('Finish take');
        await expectSingleScreen(page);
        await page.locator('#record').click();
        await expect(page.locator('#recording-result a')).toContainText('WAV');
        await expectSingleScreen(page);
      }
      await page.screenshot({ path: `test-results/workstation-${viewport.width}.png` });
    }
  }
  expect(errors).toEqual([]);
  const status = await (await page.request.get('/api/status')).json();
  expect(status.log).not.toMatch(/ERROR:|FAILURE IN SERVER/);
});
