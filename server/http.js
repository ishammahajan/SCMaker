export function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

export async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Request exceeds 1 MB.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new Error('Invalid JSON.');
  }
}

export function validNumber(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function sendError(response, error) {
  const status =
    error.code === 'ENOENT' ? 404 : /SuperCollider|audio engine/.test(error.message) ? 503 : 400;
  if (!response.headersSent) sendJson(response, status, { error: error.message });
  else response.destroy();
}
