import { test, expect } from '@playwright/test';
import { defaultProject } from '../../shared/music.js';

// Browser tests share an isolated server. Do not leave our saved one-track take
// in place for the existing studio workflow, which starts from the starter sketch.
test.afterEach(async ({ request }) => {
  const { token } = await (await request.get('/api/session')).json();
  const headers = { 'X-SCMaker-Token': token };
  await request.post('/api/stop', { headers, data: {} });
  await request.post('/api/project', { headers, data: { project: defaultProject() } });
});

async function status(page) {
  return page.evaluate(async () => (await fetch('/api/status')).json());
}

async function project(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-project').click();
  const download = await downloadPromise;
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

test('computer keyboard records a chord, saves editable notes, and stops after one loop', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#engine-status')).toContainText('SuperCollider connected', {
    timeout: 35000,
  });
  await page.locator('#new-project').click();
  await page.locator('#tempo').fill('120');
  await page.locator('#tempo').press('Tab');
  await page.locator('#note-velocity').fill('60');
  await page.locator('#note-velocity').press('Tab');
  await page.locator('#record-notes').click();
  await expect(page.locator('#record-notes')).toContainText('Count-in');
  await expect(page.locator('#record-notes')).toHaveAttribute('aria-pressed', 'true');
  // Playing in the count-in is audition only.
  await page.keyboard.press('a');
  await expect.poll(async () => (await status(page)).noteCapture.phase).toBe('recording');
  await page.keyboard.down('a');
  await page.keyboard.down('d');
  await page.waitForTimeout(300);
  await page.keyboard.up('a');
  await page.keyboard.up('d');
  await expect(page.locator('.roll-note')).toHaveCount(2);
  await expect(page.locator('#saved-state')).toHaveText('Unsaved changes');
  await expect(page.locator('#record-notes')).toHaveText('Record notes', { timeout: 10000 });
  await expect(page.locator('#record-notes')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play loop');
  await expect(page.locator('#playhead')).toBeHidden();
  const result = await project(page);
  expect(result.tracks[0].notes.map((note) => note.midi).sort()).toEqual([36, 40]);
  for (const note of result.tracks[0].notes) {
    expect(Number.isInteger(note.start)).toBe(true);
    expect(note.length).toBeGreaterThanOrEqual(2);
    expect(note.length).toBeLessThanOrEqual(4);
    expect(note.start + note.length).toBeLessThanOrEqual(32);
    expect(note.velocity).toBe(0.6);
  }
  const originalNotes = structuredClone(result.tracks[0].notes);
  await page.locator('#save').click();
  await expect(page.locator('#saved-state')).toHaveText('Saved on this computer');
  await page.reload();
  await expect(page.locator('.roll-note')).toHaveCount(2);
  await expect(page.locator('#record-notes')).toHaveText('Record notes');
  expect((await project(page)).tracks[0].notes).toEqual(originalNotes);
  // An early stop finalizes a held note, without destroying the previous take.
  await page.locator('#record-notes').click();
  await expect.poll(async () => (await status(page)).noteCapture.phase).toBe('recording');
  await page.keyboard.down('g');
  await page.waitForTimeout(250);
  await page.locator('#stop').click();
  await page.keyboard.up('g');
  await expect(page.locator('.roll-note')).toHaveCount(3);
  expect((await project(page)).tracks[0].notes.slice(0, 2)).toEqual(originalNotes);
  await expect(page.locator('.piano-key.held')).toHaveCount(0);
  await expect(page.locator('#record-notes')).toHaveText('Record notes');
  // Cancelling count-in creates no notes.
  await page.locator('#record-notes').click();
  await page.locator('#record-notes').click();
  await expect(page.locator('#record-notes')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.roll-note')).toHaveCount(3);
  expect(errors).toEqual([]);
  expect((await status(page)).log).not.toMatch(/ERROR:|FAILURE IN SERVER/);
});

test('R records and Ctrl+R replaces only the previous pass without reloading', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#engine-status')).toContainText('SuperCollider connected', {
    timeout: 35000,
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('#new-project').click();
  await page.locator('.cell[data-start="16"][data-midi="48"]').click();
  const manual = (await project(page)).tracks[0].notes[0];
  await page.keyboard.press('r');
  await expect(page.locator('#record-notes')).toContainText('Count-in');
  await expect.poll(async () => (await status(page)).noteCapture.phase).toBe('recording');
  await page.keyboard.down('a');
  await page.waitForTimeout(250);
  await page.keyboard.up('a');
  await page.keyboard.press('r');
  await expect(page.locator('#record-notes')).toHaveText('Record notes');
  await expect(page.locator('.roll-note')).toHaveCount(2);
  const firstPass = (await project(page)).tracks[0].notes.find((note) => note.id !== manual.id);
  let navigations = 0;
  page.on('framenavigated', () => navigations++);
  await page.keyboard.press('Control+r');
  await expect(page.locator('#record-notes')).toContainText('Count-in');
  await expect(page.locator('.roll-note')).toHaveCount(1);
  expect((await project(page)).tracks[0].notes).toEqual([manual]);
  await expect.poll(async () => (await status(page)).noteCapture.phase).toBe('recording');
  await page.keyboard.down('d');
  await page.waitForTimeout(250);
  // Ctrl+R during an active pass finishes it, deletes that pass, and restarts.
  await page.keyboard.press('Control+r');
  await page.keyboard.up('d');
  await expect(page.locator('#record-notes')).toContainText('Count-in');
  await expect(page.locator('.roll-note')).toHaveCount(1);
  await expect.poll(async () => (await status(page)).noteCapture.phase).toBe('recording');
  await page.keyboard.down('g');
  await page.waitForTimeout(250);
  await page.keyboard.up('g');
  await page.keyboard.press('r');
  await expect(page.locator('#record-notes')).toHaveText('Record notes');
  await expect(page.locator('.roll-note')).toHaveCount(2);
  const finalNotes = (await project(page)).tracks[0].notes;
  expect(finalNotes[0]).toEqual(manual);
  expect(finalNotes[1].midi).toBe(43);
  expect(finalNotes.some((note) => note.id === firstPass.id)).toBe(false);
  expect(navigations).toBe(0);

  // A failed restart must not remove the previous pass.
  await page.route('**/api/notes/start', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Test restart failure' }),
    }),
  );
  await page.keyboard.press('Control+r');
  await expect(page.locator('#notice')).toHaveText('Test restart failure');
  expect((await project(page)).tracks[0].notes).toEqual(finalNotes);
  await page.unroute('**/api/notes/start');

  await page.locator('#project-name').focus();
  await page.keyboard.press('r');
  await expect(page.locator('#project-name')).toHaveValue(/r$/);
  await expect(page.locator('#record-notes')).toHaveText('Record notes');
  await page.locator('#edit-sound').click();
  await page.keyboard.press('r');
  await expect(page.locator('#prompt')).toHaveValue('r');
  await page.keyboard.press('Escape');
  await expect(page.locator('#record-notes')).toHaveText('Record notes');
  expect((await status(page)).log).not.toMatch(/ERROR:|FAILURE IN SERVER/);
});

test('losing focus releases and records held keys without leaving a stuck voice', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#engine-status')).toContainText('SuperCollider connected', {
    timeout: 35000,
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('#new-project').click();
  await page.locator('#record-notes').click();
  await expect.poll(async () => (await status(page)).noteCapture.phase).toBe('recording');
  await page.keyboard.down('a');
  await page.waitForTimeout(250);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('.piano-key.held')).toHaveCount(0);
  await expect(page.locator('.roll-note')).toHaveCount(1);
  await page.keyboard.up('a');
  await page.keyboard.press('Escape');
  await expect(page.locator('#record-notes')).toHaveText('Record notes');
  expect((await status(page)).log).not.toMatch(/ERROR:|FAILURE IN SERVER/);
});
