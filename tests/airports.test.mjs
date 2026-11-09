// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as AP from '../js/airports.js';
import * as F from '../js/fr24.js';

const DEG = Math.PI / 180;
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b} (±${tol})`);
await AP.loadAirports(JSON.parse(readFileSync(new URL('../data/airports.json', import.meta.url))));

test('bundled table resolves ICAO and IATA codes', () => {
  assert.equal(AP.lookupAirport('KJFK').iata, 'JFK');
  assert.equal(AP.lookupAirport('lhr').icao, 'EGLL');
  assert.equal(AP.lookupAirport('HNL').icao, 'PHNL');
  assert.equal(AP.lookupAirport('ZZZZ'), null);
});

test('nearest airport from Waikiki is Honolulu', () => {
  assert.equal(AP.nearestAirport(21.27 * DEG, -157.82 * DEG, 2).icao, 'PHNL');
});

test('great-circle distance LHR→JFK ≈ 5,540 km', () => {
  const a = AP.lookupAirport('LHR'), b = AP.lookupAirport('JFK');
  near(AP.gcDistance(a.lat, a.lon, b.lat, b.lon) / 1000, 5540, 15);
});

test('great-circle points start/end at the airports and bulge poleward', () => {
  const a = AP.lookupAirport('LHR'), b = AP.lookupAirport('JFK');
  const pts = AP.greatCirclePoints(a.lat, a.lon, b.lat, b.lon, 50);
  near(pts[0].lat, a.lat, 1e-9); near(pts[50].lon, b.lon, 1e-9);
  assert.ok(Math.max(...pts.map((p) => p.lat)) > a.lat); // route arcs north of both ends
});

test('LiveATC links go to their own search page', () => {
  assert.equal(AP.liveatcUrl('kjfk'), 'https://www.liveatc.net/search/?icao=KJFK');
});

test('parseTrack accepts array, {data}, sorts by time and converts feet', () => {
  const tracks = [{ timestamp: '2026-11-08T12:01:00Z', lat: 1, lon: 2, alt: 1000 }, { timestamp: '2026-11-08T12:00:00Z', lat: 0, lon: 0, alt: 0 }];
  for (const body of [[{ fr24_id: 'ab', tracks }], { data: [{ fr24_id: 'ab', tracks }] }, { fr24_id: 'ab', tracks }]) {
    const pts = F.parseTrack(body, 'ab');
    assert.equal(pts.length, 2);
    assert.ok(pts[0].t < pts[1].t);
    near(pts[1].altM, 304.8, 1e-6);
  }
  assert.deepEqual(F.parseTrack(null, 'ab'), []);
});

test('client flightTrack/airport use the right paths', async () => {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(url);
    if (url.includes('flight-tracks')) return new Response(JSON.stringify([{ fr24_id: '3a1b', tracks: [{ timestamp: '2026-11-08T12:00:00Z', lat: 1, lon: 1, alt: 0 }] }]), { status: 200 });
    return new Response(JSON.stringify({ name: 'Test', iata: 'TST', icao: 'XTST', lat: 10, lon: 20, elevation: 100, country: { code: 'XX' } }), { status: 200 });
  };
  const c = new F.FR24Client({ token: 'k', sandbox: true });
  assert.equal((await c.flightTrack('3a1b')).length, 1);
  const a = await c.airport('xtst');
  near(a.lat, 10 * DEG, 1e-12);
  assert.match(seen[0], /\/api\/sandbox\/flight-tracks\?flight_id=3a1b$/);
  assert.match(seen[1], /\/api\/sandbox\/static\/airports\/XTST\/full$/);
  await assert.rejects(c.flightTrack(''), (e) => e.kind === 'validation');
});

test('parseRecord reads ETA', () => {
  const f = F.parseRecord({ lat: 1, lon: 1, eta: '2026-11-08T15:00:00Z' });
  assert.equal(f.eta, Date.parse('2026-11-08T15:00:00Z'));
});
