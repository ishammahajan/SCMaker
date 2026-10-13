import { test, expect } from '@playwright/test';
import { defaultProject } from '../../shared/music.js';

// Use the browser suite's isolated server, and leave its starter project intact.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#engine-status')).toContainText('SuperCollider connected', {
    timeout: 35000,
  });
});

test.afterEach(async ({ request }) => {
  const { token } = await (await request.get('/api/session')).json();
  const headers = { 'X-SCMaker-Token': token };
  await request.post('/api/stop', { headers, data: {} });
  await request.post('/api/project', { headers, data: { project: defaultProject() } });
  const status = await (await request.get('/api/status')).json();
  expect(status.log).not.toMatch(/ERROR:|FAILURE IN SERVER/);
});

function watchCommands(page) {
  const commands = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') commands.push(new URL(request.url()).pathname);
  });
  return commands;
}

test('Space controls transport, not the last focused button or slider, including held repeats', async ({
  page,
}) => {
  const commands = watchCommands(page);
  const notes = await page.locator('.roll-note').count();
  const mute = page.locator('.mute').first();
  for (const selector of [
    '.track-select',
    '.mute',
    '#save',
    '.cell[data-start="0"][data-midi="48"]',
    '.roll-note',
    '#track-mix input',
    '#note-velocity',
    '.piano-key',
    '#keyboard-toggle',
    '#stop',
    '#play',
  ]) {
    const control = page.locator(selector).first();
    await control.focus();
    await page.keyboard.down('Space');
    await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Stop loop');
    // A second down without an up is a repeat. It must neither toggle again nor
    // fall through to a button's native Space activation when the key is released.
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Stop loop');
    await expect(control).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play loop');
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.roll-note')).toHaveCount(notes);
    await expect(page.locator('#keyboard')).toBeVisible();
  }
  expect(commands.filter((command) => command === '/api/play')).toHaveLength(11);
  expect(commands.filter((command) => command === '/api/stop')).toHaveLength(11);
  expect(commands).not.toContain('/api/project');
  expect(commands).not.toContain('/api/audition');
  await mute.focus();
  await page.keyboard.press('Enter');
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
});

test('Space controls playback immediately after choosing a workstation dropdown option', async ({
  page,
}) => {
  const commands = watchCommands(page);
  for (const selector of [
    '#playback-scope',
    '#recording-format',
    '#section-select',
    '#keyboard-octave',
    '#entry-section',
  ]) {
    if (selector === '#entry-section')
      await page.getByLabel('Options for position 1', { exact: true }).click();
    const select = page.locator(selector);
    // Open the native dropdown and commit an option, leaving it focused.
    // Keep Section scope so each iteration exercises the same loop transport.
    await select.click();
    await page.keyboard.press('Home');
    if (['#recording-format', '#keyboard-octave'].includes(selector))
      await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(select).toBeFocused();
    const value = await select.inputValue();
    await page.keyboard.down('Space');
    await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Stop loop');
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Stop loop');
    await expect(select).toHaveValue(value);
    await page.keyboard.press('Space');
    await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play loop');
    await expect(select).toHaveValue(value);
    // Space must not open a native dropdown and swallow the next arrow key.
    await select.focus();
    await page.keyboard.press('Home');
    if (selector === '#entry-section') await page.keyboard.press('Escape');
  }
  expect(commands.filter((command) => command === '/api/play')).toHaveLength(5);
  expect(commands.filter((command) => command === '/api/stop')).toHaveLength(5);
});

test('track selection, piano keys, recording, and Escape work after focusing workspace controls', async ({
  page,
}) => {
  const commands = watchCommands(page);
  for (const selector of [
    '.track-select',
    '.mute',
    '#save',
    '.cell',
    '#track-mix input',
    '#play',
  ]) {
    await page.locator(selector).first().focus();
    await page.keyboard.press('2');
    await expect(page.locator('#sequencer-heading')).toContainText('Kick 01');
    await page.keyboard.press('1');
    await expect(page.locator('#sequencer-heading')).toContainText('Bass 01');
    await page.locator(selector).first().focus();
    await page.keyboard.down('a');
    await expect(page.locator('.piano-key.held')).toHaveCount(1);
    // Releasing still reaches the original voice after focus moves into a field.
    await page.locator('#project-name').focus();
    await page.keyboard.up('a');
    await expect(page.locator('.piano-key.held')).toHaveCount(0);
    await page.locator(selector).first().focus();
    await page.keyboard.press('r');
    await expect(page.locator('#record-notes')).toContainText('Count-in');
    await page.keyboard.press('Escape');
    await expect(page.locator('#record-notes')).toHaveText('Record notes');
  }
  await expect.poll(() => commands.filter((command) => command === '/api/note').length).toBe(12);
  expect(commands.filter((command) => command === '/api/notes/start')).toHaveLength(6);
  await page.locator('#note-velocity').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#note-velocity')).toHaveValue('6');
});

test('typing, select navigation, and modal dialog keys remain native; save remains global', async ({
  page,
}) => {
  const commands = watchCommands(page);
  await page.locator('#project-name').fill('Focus check');
  await page.keyboard.type(' a2r ');
  await expect(page.locator('#project-name')).toHaveValue('Focus check a2r ');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#saved-state')).toHaveText('Saved on this computer');
  await page.locator('#tempo').fill('12');
  await page.keyboard.press('2');
  await expect(page.locator('#tempo')).toHaveValue('122');
  await page.locator('#keyboard-octave').focus();
  await page.keyboard.press('a');
  await page.keyboard.press('r');
  await page.keyboard.press('2');
  await expect(page.locator('#sequencer-heading')).toContainText('Bass 01');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#keyboard-octave')).toHaveValue('48');
  await page.locator('#edit-sound').click();
  await page.locator('#prompt').fill('warm');
  await page.keyboard.type(' a2r ');
  await expect(page.locator('#prompt')).toHaveValue('warm a2r ');
  await page.locator('#prompt-mode').focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sound-dialog')).toBeVisible();
  await page.locator('#code-toggle').focus();
  await page.keyboard.press('2');
  await page.keyboard.press('r');
  await page.keyboard.press('Space');
  await expect(page.locator('#sound-dialog')).toBeVisible();
  await expect(page.locator('#code-panel')).toBeVisible();
  await page.keyboard.press('Tab');
  expect(
    await page
      .locator('#sound-dialog')
      .evaluate((dialog) => dialog.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press('Control+s');
  await expect(page.locator('#saved-state')).toHaveText('Saved on this computer');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sound-dialog')).toBeHidden();
  await page.locator('#add-track').click();
  await page.locator('#cancel-add').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#add-dialog')).toBeHidden();
  expect(commands.filter((command) => command === '/api/project')).toHaveLength(2);
  expect(commands).not.toContain('/api/play');
  expect(commands).not.toContain('/api/notes/start');
  expect(commands).not.toContain('/api/note');
});

test('popovers do not disable workspace commands, and Escape dismisses them before stopping audio', async ({
  page,
}) => {
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Stop loop');
  await page.locator('#section-options').click();
  await page.locator('#section-name').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#section-menu')).toBeHidden();
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Stop loop');
  await page.locator('#section-options').click();
  await page.locator('#new-section').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play loop');
  await expect(page.locator('#section-select option')).toHaveCount(1);
  await page.keyboard.press('2');
  await expect(page.locator('#sequencer-heading')).toContainText('Kick 01');
  await page.locator('#new-section').focus();
  await page.keyboard.down('a');
  await expect(page.locator('.piano-key.held')).toHaveCount(1);
  await page.keyboard.up('a');
  await expect(page.locator('.piano-key.held')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#section-menu')).toBeHidden();
  await page.locator('#play').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Stop loop');
  await page.keyboard.press('Escape');
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play loop');
});
