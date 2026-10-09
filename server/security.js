import { timingSafeEqual } from 'node:crypto';
import { sendJson } from './http.js';

export function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
}

export function localOrigin(request, response, port) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(request.headers.host)) {
    sendJson(response, 403, { error: 'Only local access is allowed.' });
    return null;
  }
  const origin = `http://${request.headers.host}`;
  if (
    (request.headers.origin && request.headers.origin !== origin) ||
    request.headers['sec-fetch-site'] === 'cross-site'
  ) {
    sendJson(response, 403, { error: 'Cross-origin requests are not allowed.' });
    return null;
  }
  return origin;
}

export function authorizeMutation(request, response, token) {
  const supplied = Buffer.from(request.headers['x-scmaker-token'] || '');
  const expected = Buffer.from(token);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    sendJson(response, 403, { error: 'Invalid session token. Reload the app.' });
    return false;
  }
  if (!request.headers['content-type']?.startsWith('application/json')) {
    sendJson(response, 415, { error: 'Send application/json.' });
    return false;
  }
  return true;
}
