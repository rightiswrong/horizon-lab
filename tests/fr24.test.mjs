// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../js/fr24.js';
import { wgs84LocalRadius } from '../js/horizon.js';

const DEG = Math.PI / 180;
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b} (±${tol})`);

const sample = {
  fr24_id: '321a0cc3', hex: '4CA2BF', callsign: 'RYR8CU', lat: 53.4, lon: -6.2, track: 270,
  alt: 35000, gspeed: 450, vspeed: -1200, squawk: '7172', timestamp: '2026-11-08T12:00:00Z', source: 'ADSB',
  flight: 'FR123', type: 'B38M', reg: 'EI-HEA', painted_as: 'RYR', orig_iata: 'DUB', dest_iata: 'BOS',
};

test('parseRecord converts feet/knots/fpm/degrees to SI + radians', () => {
  const now = Date.parse('2026-11-08T12:00:10Z');
  const f = F.parseRecord(sample, now);
  near(f.altM, 10668, 0.5);
  near(f.gs, 231.5, 0.1);
  near(f.vs, -6.096, 0.001);
  near(f.track, 270 * DEG, 1e-9);
  assert.equal(f.t, Date.parse('2026-11-08T12:00:00Z'));
  assert.equal(f.callsign, 'RYR8CU');
});

test('parseRecord treats zone-less timestamps as UTC and rejects stale/future ones', () => {
  const now = Date.parse('2026-11-08T12:00:10Z');
  assert.equal(F.parseRecord({ ...sample, timestamp: '2026-11-08T12:00:00' }, now).t, Date.parse('2026-11-08T12:00:00Z'));
  assert.equal(F.parseRecord({ ...sample, timestamp: '2026-11-08T13:00:00Z' }, now).t, now);
  assert.equal(F.parseRecord({ ...sample, timestamp: '2026-11-08T10:00:00Z' }, now).t, now);
});

test('parseRecord rejects records without coordinates', () => {
  assert.equal(F.parseRecord({ callsign: 'X' }), null);
});

test('boundsAround is north,south,west,east with west < east (clipped, never wrapped)', () => {
  assert.equal(F.boundsAround(0, 0, 111.32), '1.000,-1.000,-1.000,1.000');
  const [n, s, w, e] = F.boundsAround(0, 179.5 * DEG, 111.32).split(',').map(Number);
  assert.ok(n > s && w < e);
  near(w, 178.5, 1e-3); near(e, 180, 1e-3);
  const polar = F.boundsAround(89.5 * DEG, 10 * DEG, 300).split(',').map(Number);
  assert.ok(polar[0] <= 89.9 && polar[2] === -180 && polar[3] === 180);
});

test('extrapolate: 450 kt for 60 s due east covers ~13.9 km', () => {
  const fix = { lat: 0, lon: 0, altM: 0, gs: 450 * F.KT, vs: 0, track: 90 * DEG, t: 0 };
  const p = F.extrapolate(fix, 60000);
  near(p.lat, 0, 1e-9);
  near(p.lon * wgs84LocalRadius(0), 450 * F.KT * 60, 1);
});

test('extrapolate caps time and never goes below sea level', () => {
  const fix = { lat: 0, lon: 0, altM: 100, gs: 100, vs: -50, track: 0, t: 0 };
  const p = F.extrapolate(fix, 1e9, 0, 120);
  assert.equal(p.dt, 120);
  assert.equal(p.altM, 0);
});

test('turnRateBetween wraps across north and clamps', () => {
  const a = { track: 359 * DEG, t: 0 }, b = { track: 1 * DEG, t: 2000 };
  near(F.turnRateBetween(a, b), 1 * DEG, 1e-9);
  near(F.turnRateBetween({ track: 0, t: 0 }, { track: 90 * DEG, t: 2000 }), 3 * DEG, 1e-9);
});

test('bankFor: standard-rate turn at 250 kt ≈ 34°, clamped to 35°', () => {
  near(F.bankFor(250 * F.KT, 3 * DEG) / DEG, 34.5, 1);
  near(F.bankFor(500 * F.KT, 3 * DEG) / DEG, 35, 1e-9);
});

test('client builds production and sandbox URLs, direct and via proxy', () => {
  const c = new F.FR24Client({ token: 'k' });
  assert.equal(c.url('/live/flight-positions/light', { callsigns: 'BAW1', limit: 5 }),
    'https://fr24api.flightradar24.com/api/live/flight-positions/light?callsigns=BAW1&limit=5');
  const s = new F.FR24Client({ token: 'k', sandbox: true, proxyUrl: 'https://p.example.workers.dev/' });
  assert.equal(s.url('/live/flight-positions/full', {}), 'https://p.example.workers.dev/api/sandbox/live/flight-positions/full');
});

test('client sends v1 + bearer headers and unwraps data[]', async () => {
  const seen = {};
  globalThis.fetch = async (url, opts) => {
    seen.url = url; seen.h = opts.headers;
    return new Response(JSON.stringify({ data: [sample] }), { status: 200 });
  };
  const rows = await new F.FR24Client({ token: 'secret' }).live({ callsigns: 'RYR8CU' }, 'light');
  assert.equal(seen.h['Accept-Version'], 'v1');
  assert.equal(seen.h.Authorization, 'Bearer secret');
  assert.equal(rows.length, 1);
});

test('client maps HTTP and network errors to friendly kinds', async () => {
  const c = new F.FR24Client({ token: 'x' });
  for (const [status, kind] of [[401, 'auth'], [402, 'credits'], [429, 'rate'], [500, 'http']]) {
    globalThis.fetch = async () => new Response('{}', { status });
    await assert.rejects(c.live({ callsigns: 'A' }), (e) => e.kind === kind);
  }
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(c.live({ callsigns: 'A' }), (e) => e.kind === 'network');
  await assert.rejects(new F.FR24Client({}).live({ callsigns: 'A' }), (e) => e.kind === 'auth');
});

test('mock client returns API-shaped records that move over time', async () => {
  const m = new F.MockFR24Client(21 * DEG, -157 * DEG);
  const [a] = await m.live({ callsigns: 'DEMO123' });
  assert.equal(a.callsign, 'DEMO123');
  m.t0 -= 60000;
  const [b] = await m.live({ callsigns: 'DEMO123' });
  assert.ok(Math.abs(b.lon - a.lon) > 1e-3);
});

// Regression: following an aircraft with no callsign/registration/flight number sent only
// `limit=10`, which the API rejects with 400 "Validation failed".
test('followQuery never produces a limit-only query', () => {
  const anon = { id: 'abc', callsign: null, reg: null, flight: null, lat: 0.5, lon: 0.5, gs: 200 };
  const q = F.followQuery(anon);
  assert.ok(q.bounds && F.hasFilter(q));
  assert.deepEqual(F.followQuery({ ...anon, callsign: 'baw117 ' }), { callsigns: 'BAW117' });
  assert.deepEqual(F.followQuery({ ...anon, reg: 'g-xwba' }), { registrations: 'G-XWBA' });
  assert.deepEqual(F.followQuery({ ...anon, flight: 'BA117' }), { flights: 'BA117' });
  assert.deepEqual(F.followQuery({ ...anon, callsign: '***' }), { bounds: q.bounds }); // junk callsign → area
});

test('cleanIds strips invalid characters and caps at 15', () => {
  assert.equal(F.cleanIds(' ba 117, g-xwba;'), 'BA117,G-XWBA');
  assert.equal(F.cleanIds(Array.from({ length: 20 }, (_, i) => `A${i}`).join(',')).split(',').length, 15);
  assert.equal(F.cleanIds(null), '');
});

test('client refuses to send a live request without a filter', async () => {
  globalThis.fetch = async () => { throw new Error('must not be called'); };
  await assert.rejects(new F.FR24Client({ token: 'k' }).live({ limit: 10 }, 'light'), (e) => e.kind === 'validation');
});

test('400 errors surface field details and the rejected query', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Validation failed', details: { bounds: ['The bounds field format is invalid.'] } }), { status: 400 });
  await assert.rejects(new F.FR24Client({ token: 'k' }).live({ bounds: '1,0,5,2', limit: 5 }, 'light'), (e) =>
    e.kind === 'validation' && /bounds: The bounds field format is invalid/.test(e.message) && /request: \/live\/flight-positions\/light\?bounds=/.test(e.message));
});
