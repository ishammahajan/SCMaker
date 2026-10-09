import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { PUBLIC_ASSETS } from '../server/static-assets.js';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

test('all browser module and stylesheet dependencies are explicitly served', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scmaker-assets-test-'));
  const { server } = await createApp({
    dataDir: directory,
    engine: { status: () => ({ state: 'ready' }) },
    startEngine: false,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const allowed = new Set(PUBLIC_ASSETS);
  try {
    for (const asset of PUBLIC_ASSETS) {
      const response = await fetch(`${base}${asset}`);
      assert.equal(response.status, 200, asset);
      assert.ok(response.headers.get('content-type').startsWith(types[path.extname(asset)]));
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      const content = await response.text();
      const dependencies = asset.endsWith('.js')
        ? [...content.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)].map((match) => match[1])
        : asset.endsWith('.css')
          ? [...content.matchAll(/@import url\(['"]([^'"]+)['"]\)/g)].map((match) => match[1])
          : [];
      for (const dependency of dependencies) {
        const resolved = new URL(dependency, `${base}${asset}`);
        assert.ok(allowed.has(resolved.pathname), `${asset} imports unlisted ${dependency}`);
      }
    }
    for (const privatePath of [
      '/server/app.js',
      '/package.json',
      '/data/engine.scd',
      '/AGENTS.md',
    ]) {
      assert.equal((await fetch(`${base}${privatePath}`)).status, 404, privatePath);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
