import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaultProject } from '../../shared/music.js';

const movingNote = (page) => page.locator('.roll-note[data-note-id="n_move"]');

async function openFixture(page, blockingPitch = 45) {
  await page.goto('/');
  await expect(page.locator('#engine-status')).toContainText('SuperCollider connected', {
    timeout: 35000,
  });
  const project = defaultProject();
  project.tracks = [project.tracks[0]];
  project.tracks[0].notes = [
    { id: 'n_move', start: 2, midi: 48, length: 4, velocity: 0.75 },
    { id: 'n_block', start: 12, midi: blockingPitch, length: 4, velocity: 0.75 },
  ];
  await page.locator('#project-file').setInputFiles({
    name: 'drag-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(movingNote(page)).toBeVisible();
}

async function cellPoint(page, start, midi, fraction = 0.5) {
  const cell = page.locator(`.cell[data-start="${start}"][data-midi="${midi}"]`);
  const box = await cell.boundingBox();
  return { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
}

async function beginDrag(page, start = 2) {
  const point = await cellPoint(page, start, 48);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
}

async function moveTo(page, start, midi, fraction) {
  const point = await cellPoint(page, start, midi, fraction);
  await page.mouse.move(point.x, point.y);
}

async function expectPosition(page, start, midi, length = 4) {
  await expect(movingNote(page)).toHaveAttribute(
    'aria-label',
    new RegExp(`^.*step ${start + 1}, ${length} steps`),
  );
  await expect(movingNote(page)).toHaveCSS('grid-column-start', String(start + 2));
  await expect(movingNote(page)).toHaveCSS('grid-row-start', String(60 - midi + 2));
}

async function exportedNote(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-project').click();
  const download = await downloadPromise;
  const project = JSON.parse(await readFile(await download.path(), 'utf8'));
  return project.tracks[0].notes.find((note) => note.id === 'n_move');
}

async function beginResize(page) {
  const handle = movingNote(page).locator('.note-resize');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

test('right-edge resizing previews duration and saves both longer and shorter notes', async ({
  page,
}) => {
  await openFixture(page);
  await beginResize(page);
  await moveTo(page, 9, 50);
  await expect(movingNote(page)).toHaveCSS('grid-column-end', 'span 8');
  await expectPosition(page, 2, 48, 4);
  await page.mouse.up();
  await expectPosition(page, 2, 48, 8);
  await expect(page.locator('#note-length')).toHaveValue('8');
  expect(await exportedNote(page)).toMatchObject({ start: 2, midi: 48, length: 8, velocity: 0.75 });

  await beginResize(page);
  await moveTo(page, 3, 48);
  await page.mouse.up();
  await expectPosition(page, 2, 48, 2);
  expect(await exportedNote(page)).toMatchObject({ start: 2, midi: 48, length: 2 });
});

test('resizing reaches one step and the loop end, with a separate delete cross', async ({
  page,
}) => {
  await openFixture(page);
  await beginResize(page);
  await moveTo(page, 0, 48);
  await page.mouse.up();
  await expectPosition(page, 2, 48, 1);
  await beginResize(page);
  await moveTo(page, 31, 48);
  await page.mouse.up();
  await expectPosition(page, 2, 48, 30);
  await movingNote(page).press('Shift+ArrowRight');
  await expectPosition(page, 2, 48, 30);
  await movingNote(page).press('Shift+ArrowLeft');
  await expectPosition(page, 2, 48, 29);
  await movingNote(page).hover();
  await movingNote(page).locator('.note-remove').click();
  await expect(movingNote(page)).toHaveCount(0);
  await expect(page.locator('.roll-note')).toHaveCount(1);
});

test('overlapping resize is rejected and cancelled resize leaves the saved note unchanged', async ({
  page,
}) => {
  await openFixture(page, 48);
  await beginResize(page);
  await moveTo(page, 12, 48);
  await expect(movingNote(page)).toHaveClass(/drag-blocked/);
  await page.mouse.up();
  await expect(page.locator('#notice')).toContainText('already has a note');
  await expectPosition(page, 2, 48, 4);
  for (const kind of ['pointercancel', 'lostpointercapture']) {
    await beginResize(page);
    await moveTo(page, 9, 48);
    await expect(movingNote(page)).toHaveCSS('grid-column-end', 'span 8');
    await movingNote(page).evaluate((note, kind) => {
      if (kind === 'pointercancel') {
        note.dispatchEvent(new PointerEvent(kind, { pointerId: 1 }));
      } else {
        note.releasePointerCapture(1);
      }
    }, kind);
    await expect(movingNote(page)).not.toHaveClass(/dragging|resizing|drag-blocked/);
    await expect(movingNote(page)).toHaveCSS('grid-column-end', 'span 4');
    await page.mouse.up();
  }
  expect(await exportedNote(page)).toMatchObject({ start: 2, midi: 48, length: 4 });
});

test('drag preview snaps to cells, preserves grab offset, and commits only on release', async ({
  page,
}) => {
  await openFixture(page);
  // Grab the second step of the note, not its leading edge.
  await beginDrag(page, 3);
  await moveTo(page, 17, 42, 0.2);
  await expect(movingNote(page)).toHaveCSS('grid-column-start', '18');
  await expect(movingNote(page)).toHaveCSS('grid-row-start', '20');
  await expect(movingNote(page)).toHaveCSS('transform', 'none');
  // The model and accessible description still describe the original note.
  await expect(movingNote(page)).toHaveAttribute('aria-label', /C3, step 3, 4 steps/);
  const preview = await movingNote(page).boundingBox();
  await moveTo(page, 17, 42, 0.8);
  expect(await movingNote(page).boundingBox()).toEqual(preview);
  await page.mouse.up();
  await expectPosition(page, 16, 42);
  expect(await exportedNote(page)).toMatchObject({ start: 16, midi: 42, length: 4 });
});

test('snapping remains accurate after horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1100 });
  await openFixture(page);
  await beginDrag(page);
  await page.locator('.roll-scroll').evaluate((scroll) => {
    scroll.scrollLeft = 120;
  });
  expect(
    await page.locator('.roll-scroll').evaluate((scroll) => scroll.scrollLeft),
  ).toBeGreaterThan(0);
  await moveTo(page, 20, 48);
  await expect(movingNote(page)).toHaveCSS('grid-column-start', '22');
  await expect(movingNote(page)).toHaveCSS('grid-row-start', '14');
  await page.mouse.up();
  await expectPosition(page, 20, 48);
});

test('last step and bottom pitch are reachable without shortening the note', async ({ page }) => {
  await openFixture(page);
  await beginDrag(page);
  await moveTo(page, 31, 36);
  await expect(movingNote(page)).toHaveCSS('grid-column-start', '30');
  await expect(movingNote(page)).toHaveCSS('grid-row-start', '26');
  await page.mouse.up();
  await expectPosition(page, 28, 36);
  // Keyboard moves share the same boundary rule and preserve duration too.
  await movingNote(page).press('ArrowRight');
  await expectPosition(page, 28, 36);
  await movingNote(page).press('ArrowLeft');
  await expectPosition(page, 27, 36);
  expect(await exportedNote(page)).toMatchObject({ start: 27, midi: 36, length: 4 });
});

test('overlapping and out-of-grid drops show blocked feedback and do not move the note', async ({
  page,
}) => {
  await openFixture(page);
  await beginDrag(page);
  await moveTo(page, 12, 45);
  await expect(movingNote(page)).toHaveClass(/drag-blocked/);
  await expectPosition(page, 2, 48);
  await page.mouse.up();
  await expect(page.locator('#notice')).toContainText('already has a note');
  await expect(movingNote(page)).not.toHaveClass(/dragging|drag-blocked/);
  await beginDrag(page);
  const roll = await page.locator('#piano-roll').boundingBox();
  await page.mouse.move(roll.x + 10, roll.y + 10);
  await expect(movingNote(page)).toHaveClass(/drag-blocked/);
  await page.mouse.up();
  await expectPosition(page, 2, 48);
  expect(await exportedNote(page)).toMatchObject({ start: 2, midi: 48, length: 4 });
});

test('pointer cancellation and capture loss clear the preview without committing', async ({
  page,
}) => {
  await openFixture(page);
  for (const kind of ['pointercancel', 'lostpointercapture']) {
    await beginDrag(page);
    await moveTo(page, 18, 40);
    await expect(movingNote(page)).toHaveClass(/dragging/);
    await movingNote(page).evaluate((note, kind) => {
      if (kind === 'pointercancel') {
        note.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
      } else {
        note.releasePointerCapture(1);
      }
    }, kind);
    await expect(movingNote(page)).not.toHaveClass(/dragging|drag-blocked/);
    await expectPosition(page, 2, 48);
    await page.mouse.up();
  }
  expect(await exportedNote(page)).toMatchObject({ start: 2, midi: 48, length: 4 });
  // A fresh gesture works after cancellation.
  await beginDrag(page);
  await moveTo(page, 10, 50);
  await page.mouse.up();
  await expectPosition(page, 10, 50);
});
