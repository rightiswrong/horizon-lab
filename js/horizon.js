// Horizon geometry for an observer at height h above a sphere of radius R.
// Pure functions, no engine dependencies, so they can be unit-tested in Node.
//
//   O = centre of the body, P = observer (|OP| = R + h), H = horizon point.
//   The line of sight PH is tangent to the sphere, so OH ⟂ PH and OPH is a
//   right triangle with hypotenuse R + h:
//
//     d² + R² = (R + h)²          →  d = √(2Rh + h²)       (line of sight)
//     cos θ = R / (R + h)          →  s = R·θ               (distance along the ground)
//     dip   = θ                    (horizon angle below eye level; same angle by geometry)
//     visible cap fraction = (1 − cos θ)/2 = h / (2(R + h))

export const EARTH_MEAN_RADIUS = 6371008.8; // m (IUGG mean radius)

/** Straight-line (slant) distance from the eye to the geometric horizon, metres. */
export function lineOfSightDistance(h, R = EARTH_MEAN_RADIUS) {
  h = Math.max(0, h);
  return Math.sqrt(2 * R * h + h * h);
}

/** Small-height approximation d ≈ √(2Rh). Error is < 0.1 % below ~12 km. */
export function lineOfSightApprox(h, R = EARTH_MEAN_RADIUS) {
  return Math.sqrt(2 * R * Math.max(0, h));
}

/** Central angle θ between observer and horizon point, radians. */
export function horizonCentralAngle(h, R = EARTH_MEAN_RADIUS) {
  h = Math.max(0, h);
  // acos loses precision for tiny h; use the equivalent atan form: tan θ = d / R
  return Math.atan2(lineOfSightDistance(h, R), R);
}

/** Distance measured along the curved surface to the horizon, metres. */
export function surfaceDistance(h, R = EARTH_MEAN_RADIUS) {
  return R * horizonCentralAngle(h, R);
}

/** Angle of the geometric horizon below the local horizontal (eye level), radians. */
export function horizonDip(h, R = EARTH_MEAN_RADIUS) {
  return horizonCentralAngle(h, R);
}

/**
 * Apparent horizon with standard atmospheric refraction. Light bends downward,
 * which is modelled as a larger effective radius R' = R / (1 − k), k ≈ 0.13.
 * With k = 1/7, R' = 7/6 R and d ≈ 3.86 √h km (h in metres).
 */
export function refractedDistance(h, R = EARTH_MEAN_RADIUS, k = 0.13) {
  return lineOfSightDistance(h, R / (1 - k));
}

/** Fraction of the whole body's surface visible from height h. */
export function visibleFraction(h, R = EARTH_MEAN_RADIUS) {
  h = Math.max(0, h);
  return h / (2 * (R + h));
}

/** Visible surface area (spherical cap), m². */
export function visibleArea(h, R = EARTH_MEAN_RADIUS) {
  return 4 * Math.PI * R * R * visibleFraction(h, R);
}

/**
 * Maximum distance at which a target of height H (e.g. a mountain or a ship's
 * mast) can just be seen: the two tangent distances add.
 */
export function mutualVisibilityDistance(h, H, R = EARTH_MEAN_RADIUS) {
  return lineOfSightDistance(h, R) + lineOfSightDistance(H, R);
}

/** Height a distant object at range D (along the surface) is hidden by the bulge. */
export function hiddenHeight(h, D, R = EARTH_MEAN_RADIUS) {
  const s0 = surfaceDistance(h, R);
  if (D <= s0) return 0;
  const beyond = (D - s0) / R; // central angle past the horizon point
  return R / Math.cos(beyond) - R;
}

/**
 * Gaussian mean radius of curvature of the WGS84 ellipsoid at a geodetic
 * latitude. Using this instead of 6371 km makes the drawn horizon ring sit
 * exactly on the rendered horizon of the ellipsoidal globe.
 */
export function wgs84LocalRadius(latRad) {
  const a = 6378137.0;
  const e2 = 6.69437999014e-3;
  const s = Math.sin(latRad);
  const w = 1 - e2 * s * s;
  const N = a / Math.sqrt(w);             // prime vertical
  const M = (a * (1 - e2)) / (w * Math.sqrt(w)); // meridian
  return Math.sqrt(M * N);
}

/** Destination point on a sphere: start (lat, lon) radians, bearing radians, angular distance δ. */
export function destination(lat, lon, bearing, delta) {
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const sinD = Math.sin(delta), cosD = Math.cos(delta);
  const lat2 = Math.asin(sinLat * cosD + cosLat * sinD * Math.cos(bearing));
  const lon2 = lon + Math.atan2(Math.sin(bearing) * sinD * cosLat, cosD - sinLat * Math.sin(lat2));
  return { lat: lat2, lon: ((lon2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI };
}

export function formatDistance(m) {
  if (m < 1000) return `${m.toFixed(0)} m`;
  if (m < 10000) return `${(m / 1000).toFixed(2)} km`;
  if (m < 100000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000).toLocaleString()} km`;
}

export function formatAltitude(m) {
  if (Math.abs(m) < 10000) return `${Math.round(m).toLocaleString()} m`;
  return `${(m / 1000).toFixed(m < 100000 ? 1 : 0)} km`;
}
