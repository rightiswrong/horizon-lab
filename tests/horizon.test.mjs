// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../js/horizon.js';

const R = 6371000;
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b} (±${tol})`);

test('standing eye height 1.7 m → ~4.65 km', () => near(H.lineOfSightDistance(1.7, R), 4654, 2));
test('airliner 10 km → ~357 km', () => near(H.lineOfSightDistance(10000, R), 357100, 200));
test('ISS 400 km → ~2293 km', () => near(H.lineOfSightDistance(400000, R), 2292800, 500));
test('rule of thumb 3.57√h km', () => near(H.lineOfSightApprox(100, R) / 1000, 3.57 * 10, 0.05));
test('refraction rule of thumb 3.86√h km (k=1/7)', () =>
  near(H.refractedDistance(100, R, 1 / 7) / 1000, 38.6, 0.1));
test('surface distance < line of sight, both ≈ equal when low', () => {
  assert.ok(H.surfaceDistance(400000, R) < H.lineOfSightDistance(400000, R));
  near(H.surfaceDistance(2, R), H.lineOfSightDistance(2, R), 0.01);
});
test('dip equals acos(R/(R+h))', () => near(H.horizonDip(5000, R), Math.acos(R / (R + 5000)), 1e-9));
test('h = 0 → 0', () => assert.equal(H.lineOfSightDistance(0, R), 0));
test('visible fraction approaches 1/2 as h → ∞', () => near(H.visibleFraction(1e12, R), 0.5, 1e-5));
test('mutual visibility adds tangents', () =>
  near(H.mutualVisibilityDistance(2, 8848, R), H.lineOfSightDistance(2, R) + H.lineOfSightDistance(8848, R), 1e-6));
test('hidden height: 2 m eye, target 20 km away hides ~17.5 m', () => near(H.hiddenHeight(2, 20000, R), 17.5, 0.3));
test('WGS84 local radius between polar and equatorial extremes', () => {
  const r0 = H.wgs84LocalRadius(0), r90 = H.wgs84LocalRadius(Math.PI / 2);
  assert.ok(r0 > 6335000 && r0 < 6378200 && r90 > r0);
});
