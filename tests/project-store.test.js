import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProjectStore } from '../server/project-store.js';
import { defaultProject, validateProject } from '../shared/music.js';

// Captured from the implementation before the structural refactor.
const legacyProject = JSON.parse(
  await readFile(new URL('./fixtures/project-v1.json', import.meta.url), 'utf8'),
);

test('version-one projects and canonical SynthDefs remain byte-compatible', () => {
  assert.deepEqual(validateProject(legacyProject), legacyProject);
  assert.deepEqual(defaultProject(), legacyProject);
});

test('project store serializes atomic saves and never repairs corrupt files implicitly', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scmaker-store-test-'));
  const store = createProjectStore(directory);
  try {
    assert.deepEqual(await store.load(), { project: defaultProject(), restored: false });
    const first = { ...defaultProject(), name: 'First save' };
    const second = { ...defaultProject(), name: 'Second save' };
    await Promise.all([store.save(first), store.save(second)]);
    assert.deepEqual(await store.load(), { project: second, restored: true });
    assert.deepEqual(await readdir(directory), ['project.json']);

    const file = path.join(directory, 'project.json');
    const corrupt = '{ not valid JSON';
    await writeFile(file, corrupt);
    await assert.rejects(store.load());
    assert.equal(await readFile(file, 'utf8'), corrupt);
    // A failed read must not poison the explicit save queue.
    await store.save(first);
    assert.deepEqual(await store.load(), { project: first, restored: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
