// Airport lookup, great-circle routes and LiveATC links.
//
// Airport coordinates come from a bundled, trimmed copy of OurAirports (public domain;
// data/airports.json, built by scripts/build_airports.py), so routes cost no API credits.
// The FR24 /static/airports/{code}/full endpoint is only a fallback for codes not bundled.
//
// ATC audio: LiveATC.net's terms forbid third-party use of its streams, so this app never
// embeds or proxies audio. It only links to LiveATC's own pages, which open in their player.

const DEG = Math.PI / 180;
const EARTH_R = 6371008.8;

let index = null;
let loading = null;

function buildIndex(json) {
  const byCode = new Map();
  const list = [];
  for (const [icao, iata, name, lat, lon, elevFt, city, country, size] of json.rows) {
    const a = { icao: icao || null, iata: iata || null, name, lat: lat * DEG, lon: lon * DEG, elevFt, city, country, size };
    list.push(a);
    // Prefer the bigger airport when two share a code.
    for (const c of [icao, iata]) {
      if (!c) continue;
      const prev = byCode.get(c);
      if (!prev || prev.size < size) byCode.set(c, a);
    }
  }
  return { byCode, list };
}

/** Load (once) and index the bundled airport table. Accepts parsed JSON for tests. */
export async function loadAirports(source = './data/airports.json') {
  if (index) return index;
  if (typeof source === 'object') { index = buildIndex(source); return index; }
  loading ??= fetch(source).then((r) => {
    if (!r.ok) throw new Error(`airports.json ${r.status}`);
    return r.json();
  }).then((j) => (index = buildIndex(j))).catch((e) => { loading = null; throw e; });
  return loading;
}

/** Find an airport by ICAO or IATA code in the bundled table (call loadAirports first). */
export function lookupAirport(code) {
  if (!index || !code) return null;
  return index.byCode.get(String(code).trim().toUpperCase()) || null;
}

/** Nearest bundled airport with an ICAO code (radians in). minSize: 1 small, 2 medium, 3 large. */
export function nearestAirport(lat, lon, minSize = 2) {
  if (!index) return null;
  let best = null, bestD = Infinity;
  const cosLat = Math.cos(lat);
  for (const a of index.list) {
    if (a.size < minSize || !a.icao) continue;
    const dLat = a.lat - lat;
    if (Math.abs(dLat) > 0.2) continue; // ~1,270 km pre-filter
    const dLon = Math.abs(((a.lon - lon + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * cosLat;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

/** Great-circle (central-angle) distance in metres. */
export function gcDistance(lat1, lon1, lat2, lon2, R = EARTH_R) {
  const s = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Points along the great circle from A to B (radians), by spherical linear interpolation.
 * t0 ∈ [0,1) starts the polyline part-way along (used to keep it clear of the cockpit camera).
 */
export function greatCirclePoints(lat1, lon1, lat2, lon2, n = 64, t0 = 0) {
  const toV = (la, lo) => [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const a = toV(lat1, lon1), b = toV(lat2, lon2);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const om = Math.acos(dot);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (1 - t0) * (i / n);
    let v;
    if (om < 1e-9) v = a;
    else {
      const k1 = Math.sin((1 - t) * om) / Math.sin(om), k2 = Math.sin(t * om) / Math.sin(om);
      v = [k1 * a[0] + k2 * b[0], k1 * a[1] + k2 * b[1], k1 * a[2] + k2 * b[2]];
    }
    pts.push({ lat: Math.atan2(v[2], Math.hypot(v[0], v[1])), lon: Math.atan2(v[1], v[0]) });
  }
  return pts;
}

/** LiveATC.net search page for an airport or ARTCC code (their page, their player). */
export function liveatcUrl(code) {
  return `https://www.liveatc.net/search/?icao=${encodeURIComponent(String(code).trim().toUpperCase())}`;
}

/** Short label like "LHR · London Heathrow Airport". */
export function airportLabel(a, fallbackCode) {
  if (!a) return fallbackCode || '?';
  return `${a.iata || a.icao} · ${a.name}`;
}
