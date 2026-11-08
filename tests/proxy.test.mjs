// Run with: npm test  — exercises the Worker with mocked upstream fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/fr24-proxy.js';

const env = { ALLOWED_ORIGINS: 'https://me.github.io', FR24_API_KEY: 'server-secret' };
const req = (path, init = {}) => new Request(`https://proxy.example${path}`, {
  ...init, headers: { Origin: 'https://me.github.io', ...(init.headers || {}) },
});

test('forwards allowed live endpoint with server secret and v1 header', async () => {
  let seen;
  globalThis.fetch = async (url, opts) => { seen = { url, opts }; return new Response('{"data":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const res = await worker.fetch(req('/api/live/flight-positions/light?callsigns=BAW1', { headers: { Authorization: 'Bearer user-key' } }), env);
  assert.equal(res.status, 200);
  assert.equal(seen.url, 'https://fr24api.flightradar24.com/api/live/flight-positions/light?callsigns=BAW1');
  assert.equal(seen.opts.headers.Authorization, 'Bearer server-secret');
  assert.equal(seen.opts.headers['Accept-Version'], 'v1');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://me.github.io');
});

test('allows sandbox path and passes through the user key when no secret is set', async () => {
  let seen;
  globalThis.fetch = async (url, opts) => { seen = { url, opts }; return new Response('{}', { status: 200 }); };
  await worker.fetch(req('/api/sandbox/live/flight-positions/full', { headers: { Authorization: 'Bearer user-key' } }), { ALLOWED_ORIGINS: 'https://me.github.io' });
  assert.equal(seen.opts.headers.Authorization, 'Bearer user-key');
});

test('rejects other endpoints, other origins, non-GET, and missing keys', async () => {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  assert.equal((await worker.fetch(req('/api/historic/flight-positions/full'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://proxy.example/api/live/flight-positions/light', { headers: { Origin: 'https://evil.example' } }), env)).status, 403);
  assert.equal((await worker.fetch(req('/api/live/flight-positions/light', { method: 'POST' }), env)).status, 405);
  assert.equal((await worker.fetch(req('/api/live/flight-positions/light'), { ALLOWED_ORIGINS: 'https://me.github.io' })).status, 401);
});

test('answers CORS preflight', async () => {
  const res = await worker.fetch(req('/api/live/flight-positions/light', { method: 'OPTIONS' }), env);
  assert.equal(res.status, 204);
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /Accept-Version/);
});
