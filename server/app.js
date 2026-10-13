import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Engine } from './engine.js';
import { MAX_PROJECT_BYTES } from '../shared/music.js';
import { readJson, sendJson, sendError } from './http.js';
import { setSecurityHeaders, localOrigin, authorizeMutation } from './security.js';
import { serveStatic } from './static-assets.js';
import { createProjectStore } from './project-store.js';
import { createApiRoutes } from './routes.js';
import { createLlmInstruments } from './llm-instruments.js';

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * @param {object} [options]
 * @param {string} [options.dataDir]
 * @param {Engine} [options.engine] Replaces the SuperCollider engine in tests.
 * @param {boolean} [options.startEngine]
 * @param {ReturnType<typeof createLlmInstruments>} [options.generateInstrument]
 */
export async function createApp({
  dataDir = process.env.SCMAKER_DATA_DIR || path.join(root, 'data'),
  engine: providedEngine,
  startEngine = true,
  generateInstrument = createLlmInstruments(),
} = {}) {
  dataDir = path.resolve(dataDir);
  await mkdir(dataDir, { recursive: true });
  const engine = providedEngine || new Engine(dataDir);
  const token = randomBytes(32).toString('hex');
  const projects = createProjectStore(dataDir);
  const routes = createApiRoutes({ engine, projects, token, dataDir, generateInstrument });

  const server = http.createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      const origin = localOrigin(
        request,
        response,
        /** @type {import('node:net').AddressInfo} */ (server.address())?.port,
      );
      if (!origin) return;
      const { pathname } = new URL(request.url, origin);
      if (request.method === 'POST') {
        if (!authorizeMutation(request, response, token)) return;
        const projectRoutes = [
          '/api/project',
          '/api/sync',
          '/api/play',
          '/api/song/play',
          '/api/song/record',
          '/api/notes/start',
          '/api/note',
        ];
        await routes.post(
          pathname,
          await readJson(request, projectRoutes.includes(pathname) ? MAX_PROJECT_BYTES : undefined),
          response,
        );
        return;
      }
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      if (pathname.startsWith('/api/')) {
        await routes.get(pathname, response);
        return;
      }
      if (!(await serveStatic(pathname, response))) {
        sendJson(response, 404, { error: 'Not found.' });
      }
    } catch (error) {
      sendError(response, error);
    }
  });

  if (startEngine) engine.start();
  return { server, engine, dataDir };
}
