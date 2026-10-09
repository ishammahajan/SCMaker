import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { defaultProject } from '../shared/music.js';

test('local API persists projects and enforces its trust boundary', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scmaker-server-test-'));
  const engine = {
    state: 'ready',
    status: () => ({ state: 'ready' }),
    run: (fn) => fn(),
    sync: async () => {},
    play: async () => {},
    startNoteCapture: async (project, trackId, velocity) => {
      engine.lastCapture = { project, trackId, velocity };
    },
  };
  const { server } = await createApp({ dataDir: directory, engine, startEngine: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await (await fetch(`${base}/api/session`)).json();
    const headers = { 'Content-Type': 'application/json', 'X-SCMaker-Token': session.token };
    const post = (route, input, extra = {}) =>
      fetch(`${base}/api/${route}`, {
        method: 'POST',
        headers: { ...headers, ...extra },
        body: JSON.stringify(input),
      });
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await (await fetch(`${base}/api/project`)).json()).restored, false);
    const project = defaultProject();
    project.name = '<script>alert(1)</script>';
    assert.equal((await post('project', { project })).status, 200);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(directory, 'project.json'), 'utf8')),
      project,
    );
    assert.deepEqual((await (await fetch(`${base}/api/project`)).json()).project, project);
    assert.equal((await post('project', { project }, { 'X-SCMaker-Token': '' })).status, 403);
    assert.equal(
      (await post('project', { project }, { Origin: 'https://evil.example' })).status,
      403,
    );
    const badHostStatus = await new Promise((resolve, reject) => {
      http
        .get(`${base}/api/session`, { headers: { Host: 'evil.example' } }, (response) => {
          response.resume();
          resolve(response.statusCode);
        })
        .on('error', reject);
    });
    assert.equal(badHostStatus, 403);
    assert.equal(
      (await fetch(`${base}/api/session`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status,
      403,
    );
    assert.equal((await fetch(`${base}/data/project.json`)).status, 404);
    assert.equal((await post('eval', { code: '0.exit;' })).status, 404);
    const captureInput = { project, trackId: project.tracks[0].id, velocity: 0.75 };
    assert.equal((await post('notes/start', captureInput)).status, 200);
    assert.deepEqual(engine.lastCapture, captureInput);
    assert.equal((await post('notes/start', captureInput, { 'X-SCMaker-Token': '' })).status, 403);
    assert.equal(
      (await post('notes/start', captureInput, { Origin: 'https://evil.example' })).status,
      403,
    );
    for (const velocity of [null, '0.75', 0, 1.1]) {
      assert.equal((await post('notes/start', { ...captureInput, velocity })).status, 400);
    }
    assert.equal(
      (await post('notes/start', { ...captureInput, trackId: 't_missing' })).status,
      400,
    );
    project.tracks[0].code += '0.exit;';
    assert.equal((await post('notes/start', captureInput)).status, 400);
    assert.equal((await post('play', { project })).status, 400);
    const prompt = await (
      await post('prompt', {
        prompt: 'rounder and shorter release',
        current: defaultProject().tracks[0].recipe,
      })
    ).json();
    assert.ok(prompt.recipe.brightness < 1800);
    assert.equal((await post('prompt', { prompt: 'unrecognisable' })).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
