import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaultProject } from '../../shared/music.js';

// Keep this arranged song out of the other tests' saved starter.
test.afterEach(async ({ request }) => {
  const { token } = await (await request.get('/api/session')).json();
  const headers = { 'X-SCMaker-Token': token };
  await request.post('/api/stop', { headers, data: {} });
  await request.post('/api/project', { headers, data: { project: defaultProject() } });
});

test('sections remain editable and saveable while audio is unavailable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/status', (route) =>
    route.fulfill({
      json: { state: 'error', error: 'Audio unavailable', playing: false, step: -1 },
    }),
  );
  await page.route('**/api/stop', () => {
    throw new Error('Offline section editing must not call the engine.');
  });
  await page.goto('/');
  await expect(page.locator('#engine-status')).toHaveText('Audio unavailable');
  await page.locator('#new-project').click();
  await page.locator('#new-section').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#section-select option')).toHaveCount(2);
  await page.locator('#duplicate-section').click();
  await expect(page.locator('#section-select option')).toHaveCount(3);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#delete-section').click();
  await expect(page.locator('#section-select option')).toHaveCount(2);
  await page.locator('#save').click();
  await expect(page.locator('#saved-state')).toHaveText('Saved on this computer');
  await expect(page.locator('#record-song')).toBeDisabled();
  expect(errors).toEqual([]);
});

async function exportedProject(page) {
  const pending = page.waitForEvent('download');
  await page.locator('#export-project').click();
  return JSON.parse(await readFile(await (await pending).path(), 'utf8'));
}

async function nameSection(page, name) {
  await page.locator('#section-name').fill(name);
  await page.locator('#section-name').press('Tab');
}

test('make sections, arrange repeats, reopen, and record a complete song without intervention', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#engine-status')).toContainText('SuperCollider connected', {
    timeout: 35000,
  });
  await page.locator('#new-project').click();
  await page.locator('#tempo').fill('240');
  await page.locator('#tempo').press('Tab');
  await nameSection(page, 'Intro');
  await page.locator('.cell[data-start="0"][data-midi="48"]').click();
  await page.locator('#duplicate-section').click();
  await nameSection(page, 'Chorus');
  await expect(page.locator('.roll-note')).toHaveCount(1);
  await page.locator('.roll-note').press('ArrowUp');
  await page.locator('#edit-sound').click();
  await page.locator('#wave').selectOption('sine');
  await page.locator('#close-workshop').click();
  await page.locator('#append-section').click();
  await page.getByLabel('Repeats at position 2', { exact: true }).fill('2');
  await page.getByLabel('Repeats at position 2', { exact: true }).press('Tab');
  await page.locator('#new-section').click();
  await nameSection(page, 'Outro');
  await expect(page.locator('.roll-note')).toHaveCount(0);
  await page.locator('#edit-sound').click();
  await page.locator('#prompt-provider').selectOption('local');
  await page.locator('#prompt').fill('A lush pad');
  await page.locator('#build').click();
  await page.locator('#apply-draft').click();
  await page.locator('#close-workshop').click();
  await page.locator('.cell[data-start="28"][data-midi="55"]').click();
  await page.locator('#note-length').fill('4');
  await page.locator('#note-length').press('Tab');
  await page.locator('#append-section').click();
  await page.getByLabel('Move up position 3', { exact: true }).click();
  await page.getByLabel('Move down position 2', { exact: true }).click();
  await expect(page.locator('#song-summary')).toHaveText('8 bars · 0:08');
  const project = await exportedProject(page);
  expect(project.version).toBe(2);
  expect(project.sections.map((section) => section.name)).toEqual(['Intro', 'Chorus', 'Outro']);
  expect(project.sections[0].tracks[0].notes[0].midi).toBe(48);
  expect(project.sections[1].tracks[0].notes[0].midi).toBe(49);
  expect(project.sections[0].tracks[0].recipe.wave).toBe('saw');
  expect(project.sections[1].tracks[0].recipe.wave).toBe('sine');
  expect(project.arrangement.map((entry) => entry.repeats)).toEqual([1, 2, 1]);
  await page.locator('#save').click();
  await expect(page.locator('#saved-state')).toHaveText('Saved on this computer');
  await page.reload();
  await expect(page.locator('#section-select option')).toHaveCount(3);
  expect(await exportedProject(page)).toEqual(project);
  await page.locator('#play-song').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#song-position')).toContainText('Intro');
  await expect(page.locator('#section-select')).toBeDisabled();
  await expect(page.locator('#song-position')).toContainText('Chorus', { timeout: 6000 });
  await expect(page.locator('#playhead')).toBeHidden();
  await expect(page.locator('#song-position')).toContainText('Outro', { timeout: 6000 });
  await expect(page.locator('#song-position')).toHaveText('Song stopped', { timeout: 10000 });
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play loop');
  await page.locator('#recording-format').selectOption('wav');
  await page.locator('#record-song').click();
  await expect(page.locator('#recording-result')).toHaveText('Recording arranged song…');
  await expect(page.locator('#recording-result a')).toContainText('WAV', { timeout: 20000 });
  await expect(page.locator('#record-song')).toBeEnabled();
  const downloadPending = page.waitForEvent('download');
  await page.locator('#recording-result a').click();
  const download = await downloadPending;
  const wav = await readFile(await download.path());
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.length).toBeGreaterThan(44100 * 4 * 12);
  await page.screenshot({ path: 'test-results/song-arrangement.png', fullPage: true });
  // Deletion removes dangling arrangement references, and cannot delete the last section.
  await page.locator('#section-select').selectOption(project.sections[1].id);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#delete-section').click();
  await expect(page.locator('#section-select option')).toHaveCount(2);
  const deleted = await exportedProject(page);
  expect(deleted.arrangement.map((entry) => entry.sectionId)).toEqual([
    project.sections[0].id,
    project.sections[2].id,
  ]);
  await page.locator('#record-song').click();
  await expect(page.locator('#recording-result')).toHaveText('Recording arranged song…');
  await page.locator('#stop').click();
  await expect(page.locator('#recording-result a')).toContainText('WAV');
  await expect(page.locator('#record-song')).toBeEnabled();
  expect(errors).toEqual([]);
  const status = await (await page.request.get('/api/status')).json();
  expect(status.recording).toBeNull();
  expect(status.log).not.toMatch(/ERROR:|FAILURE IN SERVER/);
});
