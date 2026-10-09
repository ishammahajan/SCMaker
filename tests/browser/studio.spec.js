import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('create, compare, keep, sequence, save, reopen, and record with real SuperCollider', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#engine-status')).toContainText('SuperCollider connected', {
    timeout: 35000,
  });
  await expect(page.locator('.track-card')).toHaveCount(3);
  await expect(page.locator('#sound-dialog')).toBeHidden();
  await expect(page.locator('#prompt')).toBeHidden();
  await expect(page.locator('#controls')).toBeHidden();
  await expect(page.locator('#piano-roll')).toBeVisible();
  expect((await page.locator('.sequencer').boundingBox()).y).toBeLessThan(300);
  const oldNotes = await page.locator('.roll-note').count();
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Stop loop');
  await page.locator('#edit-sound').click();
  await expect(page.locator('#sound-dialog')).toBeVisible();
  await expect(page.locator('#prompt')).toBeFocused();
  await page.locator('#code-toggle').click();
  const originalCode = await page.locator('#synth-code').textContent();
  await page.locator('#prompt-provider').selectOption('local');
  await page.locator('#prompt').fill('Make it rounder and shorten the release');
  await page.locator('#build').click();
  await expect(page.locator('#draft-panel')).toBeVisible();
  await expect(page.locator('#draft-explanation')).toContainText(
    'lower filter cutoff, shorter release',
  );
  await expect(page.locator('#synth-code')).toHaveText(originalCode);
  await page.keyboard.press('Escape');
  await expect(page.locator('#sound-dialog')).toBeHidden();
  await expect(page.locator('#edit-sound')).toBeFocused();
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Stop loop');
  await expect(page.locator('#control-brightness')).toHaveValue('1800');
  await expect(page.locator('.roll-note')).toHaveCount(oldNotes);
  await page.locator('#edit-sound').click();
  await expect(page.locator('#draft-panel')).toBeVisible();
  await expect(page.locator('#synth-code')).toHaveText(originalCode);
  await page.screenshot({ path: 'test-results/sound-workshop-desktop.png' });
  await page.locator('#audition-original').click();
  await page.locator('#audition-draft').click();
  await page.locator('#apply-draft').click();
  await expect(page.locator('#control-brightness')).toHaveValue('1170');
  await expect(page.locator('#control-release')).toHaveValue('0.12');
  await expect(page.locator('#history option')).toHaveCount(2);
  await expect(page.locator('#draft-panel')).toBeHidden();
  await page.locator('#code-toggle').click();
  await page.locator('#close-workshop').click();
  await expect(page.locator('#sound-dialog')).toBeHidden();
  await expect(page.locator('.roll-note')).toHaveCount(oldNotes);
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Stop loop');
  await page.locator('#stop').click();
  await page.locator('.cell[data-start="3"][data-midi="48"]').click();
  await expect(page.locator('.roll-note')).toHaveCount(oldNotes + 1);
  await page.locator('#note-length').fill('4');
  await page.locator('#note-length').press('Tab');
  await expect(page.locator('.roll-note.selected')).toHaveAttribute('aria-label', /4 steps/);
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Stop loop');
  await expect(page.locator('#playhead')).toBeVisible();
  await page.locator('#record').click();
  await expect(page.locator('#record')).toContainText('Finish take');
  await page.waitForTimeout(1500);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#record').click();
  await page.locator('#recording-result a').click();
  const download = await downloadPromise;
  const wav = await readFile(await download.path());
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.length).toBeGreaterThan(44100);
  await page.locator('#stop').click();
  await expect(page.locator('#playhead')).toBeHidden();
  await page.locator('#project-name').fill('Browser verification');
  await page.locator('#project-name').press('Control+s');
  await expect(page.locator('#saved-state')).toHaveText('Saved on this computer');
  await page.reload();
  await expect(page.locator('#project-name')).toHaveValue('Browser verification');
  await expect(page.locator('#sound-dialog')).toBeHidden();
  await page.locator('#edit-sound').click();
  await expect(page.locator('#control-brightness')).toHaveValue('1170');
  await expect(page.locator('.roll-note')).toHaveCount(oldNotes + 1);
  await expect(page.locator('#history option')).toHaveCount(2);
  await page.locator('#history').selectOption('0');
  await page.locator('#restore-version').click();
  await expect(page.locator('#control-brightness')).toHaveValue('1800');
  await expect(page.locator('.roll-note')).toHaveCount(oldNotes + 1);
  await page.locator('#prompt-provider').selectOption('local');
  await page.locator('#prompt').fill('A celestial watermelon');
  await page.locator('#build').click();
  await expect(page.locator('#notice')).toContainText('No supported sound words');
  await expect(page.locator('#notice')).toBeVisible();
  await expect(page.locator('#draft-panel')).toBeHidden();
  await page.locator('#close-workshop').click();
  await page.locator('#add-track').click();
  await page.locator('#new-kind').selectOption('snare');
  await page.locator('#new-name').fill('Snare 01');
  await page.locator('#add-form button[type="submit"]').click();
  await expect(page.locator('.track-card')).toHaveCount(4);
  await expect(page.locator('#add-track')).toBeDisabled();
  await expect(page.locator('#sound-dialog')).toBeVisible();
  await expect(page.locator('#instrument-heading')).toHaveText('Snare 01');
  await expect(page.locator('#wave')).toBeDisabled();
  await page.locator('#close-workshop').click();
  await page.locator('#save').click();
  await page.screenshot({ path: 'test-results/studio-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
  const status = await (await page.request.get('/api/status')).json();
  expect(status.log).not.toMatch(/ERROR:|FAILURE IN SERVER/);
});

test('small screens and keyboard navigation remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#sequencer-heading')).toBeVisible();
  await expect(page.locator('#sound-dialog')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#edit-sound').click();
  await expect(page.locator('#prompt')).toBeFocused();
  expect(
    await page
      .locator('#sound-dialog')
      .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
  ).toBe(true);
  await page.locator('#prompt').fill('warm bass');
  await page.locator('#prompt').press('a');
  await expect(page.locator('#prompt')).toHaveValue('warm bassa');
  // Digits inside the prompt must not switch instruments.
  await page.locator('#prompt').press('2');
  await expect(page.locator('#instrument-heading')).toHaveText('Bass 01');
  await page.locator('#close-workshop').focus();
  await page.keyboard.press('2');
  await expect(page.locator('#instrument-heading')).toHaveText('Bass 01');
  await page.keyboard.press('Tab');
  expect(
    await page
      .locator('#sound-dialog')
      .evaluate((dialog) => dialog.contains(document.activeElement)),
  ).toBe(true);
  await page.locator('#prompt').focus();
  await page.screenshot({ path: 'test-results/sound-workshop-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('#sound-dialog')).toBeHidden();
  await expect(page.locator('#edit-sound')).toBeFocused();
  await page.keyboard.press('2');
  await expect(page.locator('#sequencer-heading')).toContainText('Kick 01');
  await page.locator('#piano-roll .cell[data-start="1"][data-midi="48"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#piano-roll .cell[data-start="2"][data-midi="48"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.roll-note.selected')).toHaveAttribute('aria-label', /step 3/);
  await page.locator('#save').click();
  await page.screenshot({ path: 'test-results/studio-mobile.png', fullPage: true });
});
