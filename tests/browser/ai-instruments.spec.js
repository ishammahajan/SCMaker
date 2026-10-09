import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaultProject } from '../../shared/music.js';

test.beforeEach(async ({ request }) => {
  const { token } = await (await request.get('/api/session')).json();
  await request.post('/api/project', {
    headers: { 'X-SCMaker-Token': token },
    data: { project: defaultProject() },
  });
});
test.afterEach(async ({ request }) => {
  const { token } = await (await request.get('/api/session')).json();
  await request.post('/api/project', {
    headers: { 'X-SCMaker-Token': token },
    data: { project: defaultProject() },
  });
});

const whistle = JSON.parse(await readFile(new URL('../fixtures/ai-whistle.json', import.meta.url)));

test('AI preview, refinement, failure, history and save/reload use real SuperCollider', async ({
  page,
}) => {
  // Only the external provider response is mocked. Audition and live notes use real audio.
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#engine-status')).toContainText('SuperCollider connected', {
    timeout: 35000,
  });
  await page.locator('#add-track').click();
  await page.locator('#new-kind').selectOption('custom');
  await page.locator('#new-name').fill('AI whistle');
  await page.locator('#add-form button[type="submit"]').click();
  await expect(page.locator('#prompt-mode')).toHaveValue('create');
  await expect(page.locator('#prompt-provider')).toHaveValue('llm');
  await page.locator('#code-toggle').click();
  const original = await page.locator('#synth-code').textContent();
  await page.route('**/api/prompt', async (route) => {
    const request = route.request().postDataJSON();
    expect(request.provider).toBe('llm');
    if (request.prompt === 'fail')
      return route.fulfill({
        status: 400,
        json: { error: 'OpenCode Go request failed (HTTP 429).' },
      });
    const result = structuredClone(whistle);
    if (request.mode === 'refine') {
      expect(request.current.graph).toEqual(whistle.recipe.graph);
      result.recipe.release = 0.08;
      result.explanation = 'Shorter release, same whistle.';
    }
    await route.fulfill({ json: result });
  });
  await page.locator('#prompt').fill('whisling');
  await page.locator('#build').click();
  await expect(page.locator('#draft-panel')).toBeVisible();
  await expect(page.locator('#synth-code')).toHaveText(original);
  await page.locator('#audition-draft').click();
  await page.locator('#apply-draft').click();
  await expect(page.locator('#prompt-mode')).toHaveValue('refine');
  await expect(page.locator('#wave')).toBeDisabled();
  await expect(page.locator('#synth-code')).toContainText('BPF.ar');
  await page.locator('#close-workshop').click();
  await page.locator('.cell[data-start="0"][data-midi="60"]').click();
  const noteCount = await page.locator('.roll-note').count();
  await page.locator('#edit-sound').click();
  await page.locator('#prompt').fill('Shorten release');
  await page.locator('#build').click();
  await expect(page.locator('#draft-panel')).toBeVisible();
  await page.locator('#apply-draft').click();
  await expect(page.locator('#control-release')).toHaveValue('0.08');
  await expect(page.locator('.roll-note')).toHaveCount(noteCount);
  const refinedCode = await page.locator('#synth-code').textContent();
  await page.locator('#prompt').fill('fail');
  await page.locator('#build').click();
  await expect(page.locator('#notice')).toContainText('HTTP 429');
  await expect(page.locator('#synth-code')).toHaveText(refinedCode);
  await expect(page.locator('#draft-panel')).toBeHidden();
  await page.locator('#history').selectOption('1');
  await page.locator('#restore-version').click();
  await expect(page.locator('#control-release')).toHaveValue(String(whistle.recipe.release));
  await expect(page.locator('.roll-note')).toHaveCount(noteCount);
  await page.locator('#close-workshop').click();
  await page.locator('#save').click();
  await expect(page.locator('#saved-state')).toHaveText('Saved on this computer');
  await page.reload();
  await page.locator('.track-card').last().locator('.track-select').click();
  await page.locator('#edit-sound').click();
  await expect(page.locator('#sound-kind')).toHaveText('CUSTOM');
  await expect(page.locator('#control-release')).toHaveValue(String(whistle.recipe.release));
  await expect(page.locator('.roll-note')).toHaveCount(noteCount);
  await page.locator('#audition').click();
  expect(errors).toEqual([]);
  const status = await (await page.request.get('/api/status')).json();
  expect(status.log).not.toMatch(/ERROR:|FAILURE IN SERVER/);
});
