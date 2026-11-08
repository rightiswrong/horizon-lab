// Flightradar24 API integration (official API, https://fr24api.flightradar24.com).
//
//   GET /api/live/flight-positions/light|full      (prefix /api/sandbox/... for the free sandbox key)
//   Headers: Accept: application/json, Accept-Version: v1, Authorization: Bearer <token>
//   Response: { data: [ { fr24_id, hex, callsign, lat, lon, track, alt, gspeed, vspeed,
//                         squawk, timestamp, source, [full:] flight, type, reg, painted_as,
//                         operating_as, orig_iata, orig_icao, dest_iata, dest_icao, eta } ] }
//   Units: alt = barometric pressure altitude AMSL in feet (1013.25 hPa), gspeed = knots,
//          vspeed = feet per minute, track = true track over ground, integer degrees.
//
// Pure helpers are engine-free so they can be unit-tested in Node.

import { destination, wgs84LocalRadius } from './horizon.js';

export const FT = 0.3048;
export const KT = 0.514444;
export const FPM = 0.00508;
const DEG = Math.PI / 180;
const DEFAULT_ORIGIN = 'https://fr24api.flightradar24.com';

/** Normalise one FR24 position record into SI units + radians. */
export function parseRecord(r, nowMs = Date.now()) {
  if (!r || !Number.isFinite(+r.lat) || !Number.isFinite(+r.lon)) return null;
  let t = nowMs;
  if (r.timestamp) {
    const s = String(r.timestamp);
    const parsed = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
    // Ignore clearly bogus timestamps (future, or older than 10 min).
    if (Number.isFinite(parsed) && parsed <= nowMs + 5000 && nowMs - parsed < 600000) t = parsed;
  }
  return {
    id: r.fr24_id ?? null,
    hex: r.hex ?? null,
    callsign: (r.callsign || '').trim() || null,
    flight: (r.flight || '').trim() || null,
    reg: r.reg ?? null,
    type: r.type ?? null,
    airline: r.painted_as || r.operating_as || null,
    orig: r.orig_iata || r.orig_icao || null,
    dest: r.dest_iata || r.dest_icao || null,
    lat: +r.lat * DEG,
    lon: +r.lon * DEG,
    altFt: Number.isFinite(+r.alt) ? +r.alt : 0,
    altM: Math.max(0, (Number.isFinite(+r.alt) ? +r.alt : 0) * FT),
    gs: Math.max(0, (+r.gspeed || 0) * KT),
    track: ((+r.track || 0) % 360) * DEG,
    vs: (+r.vspeed || 0) * FPM,
    source: r.source ?? null,
    t,
  };
}

/** Short human label for a result list. */
export function describe(f) {
  const name = f.callsign || f.flight || f.reg || f.id || 'Unknown';
  const parts = [name];
  if (f.type) parts.push(f.type);
  if (f.orig || f.dest) parts.push(`${f.orig || '?'}→${f.dest || '?'}`);
  parts.push(f.altFt > 0 ? `${Math.round(f.altFt).toLocaleString()} ft` : 'ground');
  return parts.join(' · ');
}

/** FR24 bounds string "north,south,west,east" for a box of ±radiusKm around a point (radians in). */
export function boundsAround(lat, lon, radiusKm) {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.max(0.05, Math.cos(lat)));
  const la = lat / DEG, lo = lon / DEG;
  const n = Math.min(90, la + dLat), s = Math.max(-90, la - dLat);
  let w = lo - dLon, e = lo + dLon;
  if (w < -180) w += 360;
  if (e > 180) e -= 360;
  return [n, s, w, e].map((v) => v.toFixed(3)).join(',');
}

/** Signed smallest difference a − b between two angles (radians), in (−π, π]. */
export function angleDiff(a, b) {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Dead-reckon a fix forward to time nowMs, assuming constant ground speed,
 * vertical speed and turn rate. Extrapolation is capped so a lost aircraft
 * doesn't fly off forever.
 */
export function extrapolate(fix, nowMs, turnRate = 0, maxSeconds = 120) {
  const dt = Math.max(0, Math.min(maxSeconds, (nowMs - fix.t) / 1000));
  const meanTrack = fix.track + turnRate * dt / 2;
  const R = wgs84LocalRadius(fix.lat) + fix.altM;
  const p = destination(fix.lat, fix.lon, meanTrack, (fix.gs * dt) / R);
  return {
    lat: p.lat, lon: p.lon,
    altM: Math.max(0, fix.altM + fix.vs * dt),
    track: (fix.track + turnRate * dt + 4 * Math.PI) % (2 * Math.PI),
    gs: fix.gs, vs: fix.vs, dt,
  };
}

/** Turn rate (rad/s) between two consecutive fixes, clamped to ±3°/s. */
export function turnRateBetween(prev, next) {
  if (!prev || !next) return 0;
  const dt = (next.t - prev.t) / 1000;
  if (!(dt > 1)) return 0;
  const r = angleDiff(next.track, prev.track) / dt;
  return Math.max(-3 * DEG, Math.min(3 * DEG, r));
}

/** Bank angle for a coordinated turn: tan φ = v·ω / g. */
export function bankFor(gs, turnRate) {
  return Math.max(-35 * DEG, Math.min(35 * DEG, Math.atan((gs * turnRate) / 9.81)));
}

export class FR24Error extends Error {
  constructor(message, kind, status) { super(message); this.kind = kind; this.status = status; }
}

/** Thin client for the official FR24 REST API. Works direct or through a CORS proxy. */
export class FR24Client {
  constructor({ token = '', sandbox = false, proxyUrl = '' } = {}) {
    this.token = token.trim();
    this.sandbox = sandbox;
    this.origin = (proxyUrl.trim() || DEFAULT_ORIGIN).replace(/\/+$/, '');
    this.viaProxy = !!proxyUrl.trim();
  }

  url(path, params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    return `${this.origin}/api${this.sandbox ? '/sandbox' : ''}${path}${qs.toString() ? `?${qs}` : ''}`;
  }

  async get(path, params) {
    if (!this.token && !this.viaProxy) throw new FR24Error('Enter a Flightradar24 API key first.', 'auth');
    const headers = { Accept: 'application/json', 'Accept-Version': 'v1' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let res;
    try {
      res = await fetch(this.url(path, params), { headers, mode: 'cors', credentials: 'omit' });
    } catch (e) {
      throw new FR24Error(
        this.viaProxy
          ? 'Could not reach your proxy. Check the URL and that it is deployed.'
          : 'The browser blocked the request. Flightradar24 may not allow direct calls from web pages. Deploy the included proxy (worker/) and paste its URL under Advanced.',
        'network');
    }
    if (res.status === 401 || res.status === 403) throw new FR24Error('API key rejected (401/403). Check the key, and tick "Sandbox key" if you are using the sandbox token.', 'auth', res.status);
    if (res.status === 402) throw new FR24Error('No API credits left on this account (402).', 'credits', res.status);
    if (res.status === 429) {
      const ra = res.headers.get('Retry-After');
      throw new FR24Error(`Rate limited (429).${ra ? ` Retry in ${ra}s.` : ''}`, 'rate', res.status);
    }
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j.message || j.details || j.error || ''; } catch { /* ignore */ }
      throw new FR24Error(`Flightradar24 error ${res.status}${detail ? `: ${detail}` : ''}`, 'http', res.status);
    }
    const body = await res.json();
    return Array.isArray(body?.data) ? body.data : [];
  }

  /** Live positions. variant 'light' (cheaper, used for polling) or 'full' (route/type, used for search). */
  async live(params, variant = 'full') {
    const now = Date.now();
    const rows = await this.get(`/live/flight-positions/${variant}`, params);
    return rows.map((r) => parseRecord(r, now)).filter(Boolean);
  }
}

/**
 * Offline stand-in with the same interface and record shape, so the feature can be
 * tried (and tested) without a key. Aircraft fly deterministic paths from a start time.
 */
export class MockFR24Client {
  constructor(centerLat, centerLon) {
    this.t0 = Date.now();
    this.sandbox = false; this.viaProxy = false; this.mock = true;
    const specs = [
      ['DEMO123', 'B789', 'LHR', 'SIN', 37000, 488, 255, 0, 0.0],
      ['DEMO77', 'A21N', 'JFK', 'LAX', 34000, 452, 120, -800, 0.15],
      ['DEMO9', 'C172', 'HNL', 'OGG', 4500, 105, 40, 0, -0.9],
      ['DEMO400', 'B77W', 'DXB', 'SYD', 41000, 510, 300, 0, 0.4],
      ['DEMOGA', 'PC12', 'SFO', 'RNO', 18000, 260, 65, 1200, -0.3],
    ];
    this.ac = specs.map(([cs, type, o, d, alt, gs, trk, vs, turn], i) => ({
      fr24_id: `de${(0x1000 + i).toString(16)}`, hex: `ABC${i}`, callsign: cs, flight: cs.replace('DEMO', 'DM'),
      type, reg: `N${100 + i}DM`, painted_as: 'DMO', operating_as: 'DMO', orig_iata: o, dest_iata: d,
      lat0: centerLat / DEG + (i - 2) * 0.35, lon0: centerLon / DEG + ((i * 7) % 5 - 2) * 0.4,
      alt0: alt, gspeed: gs, track0: trk, vspeed: vs, turnDegS: turn,
    }));
  }

  record(a, nowMs) {
    const dt = (nowMs - this.t0) / 1000;
    const trackRad0 = a.track0 * DEG;
    const turn = a.turnDegS * DEG;
    const track = trackRad0 + turn * dt;
    const alt = Math.max(0, a.alt0 + (a.vspeed / 60) * Math.min(dt, 600));
    const vs = dt < 600 ? a.vspeed : 0;
    const R = wgs84LocalRadius(a.lat0 * DEG) + alt * FT;
    // Integrate the arc numerically (coarse steps are fine for a demo).
    let lat = a.lat0 * DEG, lon = a.lon0 * DEG;
    const steps = Math.max(1, Math.ceil(dt / 10));
    for (let i = 0; i < steps; i++) {
      const h = dt / steps;
      const p = destination(lat, lon, trackRad0 + turn * (i + 0.5) * h, (a.gspeed * KT * h) / R);
      lat = p.lat; lon = p.lon;
    }
    return {
      fr24_id: a.fr24_id, hex: a.hex, callsign: a.callsign, flight: a.flight, type: a.type, reg: a.reg,
      painted_as: a.painted_as, operating_as: a.operating_as, orig_iata: a.orig_iata, dest_iata: a.dest_iata,
      lat: lat / DEG, lon: lon / DEG, alt: Math.round(alt), gspeed: a.gspeed, vspeed: vs,
      track: Math.round((((track / DEG) % 360) + 360) % 360), squawk: '1200', source: 'MOCK',
      timestamp: new Date(nowMs - 2000).toISOString(),
    };
  }

  async live(params) {
    const now = Date.now();
    await new Promise((r) => setTimeout(r, 250));
    const want = (params.callsigns || params.flights || params.registrations || '').toUpperCase().split(',').filter(Boolean);
    return this.ac
      .filter((a) => !want.length || want.includes(a.callsign) || want.includes(a.flight) || want.includes(a.reg))
      .map((a) => parseRecord(this.record(a, now), now));
  }
}
