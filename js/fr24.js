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

/**
 * FR24 bounds string "north,south,west,east" for a box of ±radiusKm around a point (radians in).
 * The box is clipped (not wrapped) at the antimeridian and kept off the exact poles, so west < east
 * and north > south always hold; the API rejects anything else with "Validation failed".
 */
export function boundsAround(lat, lon, radiusKm) {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.max(0.05, Math.cos(lat)));
  const la = lat / DEG, lo = ((lon / DEG + 540) % 360) - 180;
  const n = Math.min(89.9, la + dLat), s = Math.max(-89.9, la - dLat);
  let w = lo - dLon, e = lo + dLon;
  // A box that reaches a pole, or spans the globe, covers every longitude.
  if (e - w >= 360 || la + dLat >= 89.9 || la - dLat <= -89.9) { w = -180; e = 180; }
  w = Math.max(-180, w); e = Math.min(180, e);
  return [n, s, w, e].map((v) => v.toFixed(3)).join(',');
}

/** Clean a user- or API-supplied identifier list: uppercase, A–Z/0–9/hyphen only, max 15 items. */
export function cleanIds(v) {
  return String(v ?? '')
    .toUpperCase()
    .split(',')
    .map((x) => x.replace(/[^A-Z0-9-]/g, ''))
    .filter(Boolean)
    .slice(0, 15)
    .join(',');
}

/**
 * Query used to re-poll a followed flight. The live endpoints can't filter by fr24_id, so use the
 * most specific identifier the flight has. Aircraft with none (common for private, military and
 * MLAT-only targets) fall back to a small box around where the aircraft should be now, and the
 * caller matches the result by fr24_id.
 */
export function followQuery(f, pred, intervalS = 20) {
  const cs = cleanIds(f.callsign);
  if (cs) return { callsigns: cs };
  const reg = cleanIds(f.reg);
  if (reg) return { registrations: reg };
  const fl = cleanIds(f.flight);
  if (fl) return { flights: fl };
  const p = pred || f;
  const radiusKm = Math.min(150, 25 + ((p.gs || 0) * intervalS * 2) / 1000);
  return { bounds: boundsAround(p.lat, p.lon, radiusKm) };
}

/** True when params contain at least one filter other than limit (the API requires one). */
export function hasFilter(params) {
  return Object.entries(params || {}).some(([k, v]) => k !== 'limit' && v !== undefined && v !== null && String(v) !== '');
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

/** Flatten FR24 error JSON ({message, details:{field:[msgs]}} or similar) into one line. */
export function describeErrorBody(j) {
  if (!j || typeof j !== 'object') return '';
  const parts = [];
  const head = j.message || j.error || j.title;
  if (head) parts.push(String(head));
  const d = j.details ?? j.errors;
  if (typeof d === 'string') parts.push(d);
  else if (Array.isArray(d)) parts.push(d.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('; '));
  else if (d && typeof d === 'object') {
    parts.push(Object.entries(d).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : JSON.stringify(v)}`).join('; '));
  }
  return parts.filter(Boolean).join(' — ').slice(0, 300);
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
    if (path.startsWith('/live/') && !hasFilter(params)) {
      throw new FR24Error('Nothing to search for: this request had no flight, callsign, registration or area filter.', 'validation');
    }
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
      try { detail = describeErrorBody(await res.json()); } catch { /* not JSON */ }
      const query = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
      const kind = res.status === 400 || res.status === 422 ? 'validation' : 'http';
      throw new FR24Error(`Flightradar24 error ${res.status}${detail ? `: ${detail}` : ''} (request: ${path}${query ? `?${query}` : ''})`, kind, res.status);
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
      ['', 'GLF5', null, null, 43000, 470, 200, 0, 0.1], // no callsign/reg/flight, like many MLAT targets
    ];
    this.ac = specs.map(([cs, type, o, d, alt, gs, trk, vs, turn], i) => ({
      fr24_id: `de${(0x1000 + i).toString(16)}`, hex: `ABC${i}`, callsign: cs, flight: cs ? cs.replace('DEMO', 'DM') : null,
      type, reg: cs ? `N${100 + i}DM` : null, painted_as: 'DMO', operating_as: 'DMO', orig_iata: o, dest_iata: d,
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
    if (!hasFilter(params) && Object.keys(params).some((k) => k !== 'limit')) throw new FR24Error('Validation failed (mock)', 'validation', 400);
    const want = (params.callsigns || params.flights || params.registrations || '').toUpperCase().split(',').filter(Boolean);
    const box = params.bounds ? params.bounds.split(',').map(Number) : null;
    return this.ac
      .map((a) => this.record(a, now))
      .filter((r) => !want.length || want.includes(r.callsign) || want.includes(r.flight) || want.includes(r.reg))
      .filter((r) => !box || (r.lat <= box[0] && r.lat >= box[1] && r.lon >= box[2] && r.lon <= box[3]))
      .map((r) => parseRecord(r, now));
  }
}
