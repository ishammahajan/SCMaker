import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createLlmInstruments, LLM_MODEL } from '../server/llm-instruments.js';
import { validateGraph, GRAPH_OPS } from '../shared/synthesis-graph.js';
import { defaultProject, validateProject, synthDef, preset } from '../shared/music.js';
import { createApp } from '../server/app.js';

const whistle = JSON.parse(await readFile(new URL('./fixtures/ai-whistle.json', import.meta.url)));
const yodel = JSON.parse(await readFile(new URL('./fixtures/ai-yodel.json', import.meta.url)));
const providerResponse = (value) =>
  Response.json({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  });

test('AI graphs round-trip through projects and sound history without executable text', () => {
  for (const sound of [whistle, yodel]) {
    const project = defaultProject();
    const track = project.tracks[0];
    const notes = structuredClone(track.notes);
    track.recipe = sound.recipe;
    track.code = synthDef(track.id, track.recipe);
    track.history.push({ prompt: 'AI sound', recipe: track.recipe, code: track.code });
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
    assert.deepEqual(track.notes, notes);
    track.code += '0.exit;';
    assert.throws(() => validateProject(project), /does not match/);
  }
});

test('graph validation rejects code, forward references, excess DSP and invalid numbers', () => {
  for (const graph of [
    { nodes: [{ op: 'execute', args: [] }] },
    { nodes: [{ op: 'sine', args: ['freq; 0.exit'] }] },
    { nodes: [{ op: 'sine', args: ['n0'] }] },
    { nodes: [{ op: 'sine', args: ['n1'] }] },
    { nodes: [{ op: 'sine', args: [NaN] }] },
    { nodes: [{ op: 'sine', args: [Infinity] }] },
    { nodes: [{ op: 'sine', args: [20001] }] },
    { nodes: [{ op: '__proto__', args: [] }] },
    { nodes: [{ op: 'sine', args: [] }] },
    { nodes: Array.from({ length: 33 }, () => ({ op: 'noise', args: [] })) },
  ])
    assert.throws(() => validateGraph(graph));
  assert.equal(Object.keys(GRAPH_OPS).length, 12);
});

test('provider uses Go Responses, requested model, stable session, and preserves omitted controls', async () => {
  const requests = [];
  const generate = createLlmInstruments({
    apiKey: 'test-only',
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return providerResponse({ explanation: 'Shorter release.', recipe: { release: 0.1 } });
    },
  });
  const result = await generate('Shorten release', whistle.recipe, 'refine');
  assert.deepEqual(result.recipe, { ...whistle.recipe, release: 0.1 });
  await generate('Shorten release again', result.recipe, 'refine');
  assert.equal(requests[0].url, 'https://opencode.ai/zen/go/v1/responses');
  assert.equal(requests[0].body.model, LLM_MODEL);
  assert.equal(requests[0].body.store, false);
  assert.equal(
    requests[0].options.headers['x-opencode-session'],
    requests[1].options.headers['x-opencode-session'],
  );
  assert.match(requests[0].options.headers['User-Agent'], /SCMaker/);
});

test('provider failures, malformed output and concurrency are handled without leaking secrets', async () => {
  await assert.rejects(
    createLlmInstruments({ apiKey: '' })('whistle', undefined, 'create'),
    /OPENCODE_API_KEY/,
  );
  for (const response of [
    new Response('secret provider body', { status: 401 }),
    Response.json({ status: 'incomplete' }),
    providerResponse({
      explanation: 'Unsafe',
      recipe: { kind: 'custom', graph: { nodes: [{ op: 'execute', args: [] }] } },
    }),
    new Response('not JSON'),
  ]) {
    const generate = createLlmInstruments({ apiKey: 'secret', fetchImpl: async () => response });
    await assert.rejects(
      generate('whistle', undefined, 'create'),
      (error) => !error.message.includes('secret'),
    );
  }
  let release;
  const generate = createLlmInstruments({
    apiKey: 'test',
    fetchImpl: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = generate('whistle', undefined, 'create');
  await assert.rejects(generate('whistle', undefined, 'create'), /already running/);
  release(providerResponse(whistle));
  assert.deepEqual((await pending).recipe, whistle.recipe);
});

test('authenticated AI prompt route does not execute or mutate a project', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scmaker-ai-test-'));
  let calls = 0;
  const { server } = await createApp({
    dataDir: directory,
    startEngine: false,
    engine: { status: () => ({ state: 'ready' }) },
    generateInstrument: async (...args) => {
      calls++;
      assert.deepEqual(args, ['whisling', preset('bass'), 'create']);
      return whistle;
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { token } = await (await fetch(`${base}/api/session`)).json();
    const post = (authenticated) =>
      fetch(`${base}/api/prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SCMaker-Token': authenticated ? token : '',
        },
        body: JSON.stringify({
          prompt: 'whisling',
          provider: 'llm',
          mode: 'create',
          current: preset('bass'),
        }),
      });
    assert.equal((await post(false)).status, 403);
    assert.equal(calls, 0);
    assert.deepEqual(await (await post(true)).json(), whistle);
    assert.equal(calls, 1);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
    assert.equal((await fetch(`${base}/server/llm-instruments.js`)).status, 404);
    assert.equal((await (await fetch(`${base}/api/project`)).json()).restored, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
