import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

// Explicit allowlist. Never serve arbitrary paths from the repository or data directory.
export const PUBLIC_ASSETS = [
  '/index.html',
  '/app.js',
  '/api.js',
  '/state.js',
  '/features/tracks.js',
  '/features/keyboard.js',
  '/features/transport.js',
  '/features/note-recording.js',
  '/features/sound-editor.js',
  '/features/project-files.js',
  '/features/shortcuts.js',
  '/features/sequencer/index.js',
  '/features/sequencer/note-drag.js',
  '/ui/dom.js',
  '/ui/feedback.js',
  '/style.css',
  '/styles/base.css',
  '/styles/workspace.css',
  '/styles/sound-editor.css',
  '/styles/keyboard.css',
  '/styles/sequencer.css',
  '/styles/feedback.css',
  '/styles/responsive.css',
  '/shared/music.js',
  '/shared/instruments.js',
  '/shared/prompts.js',
  '/shared/project.js',
  '/shared/synthdef.js',
  '/shared/synthesis-graph.js',
  '/shared/validation.js',
];
const allowedPaths = new Set(PUBLIC_ASSETS);

export async function serveStatic(pathname, response) {
  if (pathname === '/') pathname = '/index.html';
  if (!allowedPaths.has(pathname)) return false;
  const file = pathname.startsWith('/shared/')
    ? path.join(root, pathname)
    : path.join(root, 'public', pathname);
  const content = await readFile(file);
  response.writeHead(200, {
    'Content-Type': contentTypes[path.extname(file)],
    'Cache-Control': 'no-cache',
  });
  response.end(content);
  return true;
}
