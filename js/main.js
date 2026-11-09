/* global Cesium */
import * as HZ from './horizon.js';
import { createTerrariumTerrain } from './terrain.js';
import * as FR from './fr24.js';
import * as AP from './airports.js';

const DEG = Math.PI / 180;
const G = 9.81;

// ───────────────────────────── Engine setup ─────────────────────────────
Cesium.Ion.defaultAccessToken = ''; // fully open stack: no Ion assets used

const IMAGERY = {
  's2-2020': () => new Cesium.UrlTemplateImageryProvider({
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
    tilingScheme: new Cesium.WebMercatorTilingScheme(), maximumLevel: 14,
    credit: 'Sentinel-2 cloudless 2020 — s2maps.eu by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020), CC BY-NC-SA 4.0',
  }),
  's2-2016': () => new Cesium.UrlTemplateImageryProvider({
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
    tilingScheme: new Cesium.WebMercatorTilingScheme(), maximumLevel: 14,
    credit: 'Sentinel-2 cloudless 2016 — s2maps.eu by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0',
  }),
  'osm': () => new Cesium.UrlTemplateImageryProvider({
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maximumLevel: 19,
    credit: '© OpenStreetMap contributors (ODbL)',
  }),
};

const terrainProvider = createTerrariumTerrain();
const flatTerrain = new Cesium.EllipsoidTerrainProvider();

const viewer = new Cesium.Viewer('cesium', {
  baseLayer: false,
  terrainProvider,
  animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
  sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false,
  selectionIndicator: false, scene3DOnly: true, requestRenderMode: false,
  contextOptions: { webgl: { powerPreference: 'high-performance' } },
});
const scene = viewer.scene;
const globe = scene.globe;
const camera = scene.camera;
globe.enableLighting = false;
globe.depthTestAgainstTerrain = true;
globe.tileCacheSize = 400;
globe.maximumScreenSpaceError = 2;
globe.baseColor = Cesium.Color.fromCssColorString('#1d3b5a');
scene.fog.enabled = true;
scene.fog.density = 1.2e-4;
scene.skyAtmosphere.show = true;
scene.highDynamicRange = false;
camera.frustum.fov = 65 * DEG;
viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 1.5);

let imageryLayer = null;
let imageryKey = 's2-2020';
let imageryErrors = 0, imagerySetAt = 0;
function setImagery(key) {
  imageryKey = key;
  imageryErrors = 0; imagerySetAt = performance.now();
  if (imageryLayer) viewer.imageryLayers.remove(imageryLayer, true);
  const provider = IMAGERY[key]();
  provider.errorEvent.addEventListener((err) => {
    imageryErrors++;
    if (imageryErrors > 25 && performance.now() - imagerySetAt < 20000 && key !== 'osm' && imageryKey === key) {
      toast('Satellite tiles unreachable, switching to OpenStreetMap');
      document.getElementById('s-imagery').value = 'osm';
      setImagery('osm');
    }
    if (err) err.retry = false;
  });
  imageryLayer = viewer.imageryLayers.addImageryProvider(provider);
  document.getElementById('s-imagery').value = key;
}
setImagery('s2-2020');

// ───────────────────────────── Aircraft state ─────────────────────────────
const plane = {
  lat: 21.262 * DEG, lon: -157.81 * DEG, alt: 1200,   // Waikiki, heading out to sea
  heading: 215 * DEG, pitch: 0, roll: 0,
  speed: 120, throttle: 0.45, vs: 0,
  ground: 0, onGround: false,
};
const sim = { warp: 1, paused: true, view: 'cockpit', hold: false, invert: false, ring: true, hud: true, mode: 'free' };

const LOCATIONS = [
  { name: 'Oahu, Hawaii', lat: 21.262, lon: -157.81, alt: 1200, hdg: 215 },
  { name: 'Open Pacific', lat: 5.0, lon: -150.0, alt: 2, hdg: 90 },
  { name: 'Swiss Alps', lat: 46.62, lon: 7.90, alt: 4800, hdg: 165 },
  { name: 'Grand Canyon', lat: 36.07, lon: -112.20, alt: 2900, hdg: 80 },
  { name: 'Everest', lat: 27.80, lon: 86.80, alt: 9200, hdg: 35 },
  { name: 'Gibraltar', lat: 36.05, lon: -5.75, alt: 2500, hdg: 95 },
  { name: 'Sydney coast', lat: -33.86, lon: 151.30, alt: 1500, hdg: 20 },
  { name: 'Iceland', lat: 64.05, lon: -16.6, alt: 3500, hdg: 300 },
];
const ALTITUDES = [
  { key: '1', label: 'Eye 1.7 m', h: 1.7 },
  { key: '2', label: '100 m', h: 100 },
  { key: '3', label: '1 km', h: 1000 },
  { key: '4', label: 'Airliner 11 km', h: 11000 },
  { key: '5', label: 'U-2 21 km', h: 21000 },
  { key: '6', label: 'Balloon 39 km', h: 39000 },
  { key: '7', label: 'Kármán 100 km', h: 100000 },
  { key: '8', label: 'ISS 408 km', h: 408000 },
  { key: '9', label: '2,000 km', h: 2000000 },
];

// ───────────────────────────── Aircraft visual (chase/orbit views) ─────────────────────────────
const planeParts = [
  { dims: new Cesium.Cartesian3(26, 3.2, 3.2), off: new Cesium.Cartesian3(0, 0, 0), color: '#e9eef5' },
  { dims: new Cesium.Cartesian3(5, 30, 0.6), off: new Cesium.Cartesian3(1, 0, -0.4), color: '#cfd8e3' },
  { dims: new Cesium.Cartesian3(3.5, 10, 0.5), off: new Cesium.Cartesian3(-11.5, 0, 0.6), color: '#cfd8e3' },
  { dims: new Cesium.Cartesian3(3.5, 0.5, 5), off: new Cesium.Cartesian3(-11.5, 0, 3), color: '#ff7a45' },
];
const scratch = { m3: new Cesium.Matrix3(), v: new Cesium.Cartesian3(), q: new Cesium.Quaternion(), hpr: new Cesium.HeadingPitchRoll() };
let planePos = Cesium.Cartesian3.fromRadians(plane.lon, plane.lat, plane.alt);
let planeQuat = new Cesium.Quaternion();
const partEntities = planeParts.map((p) => viewer.entities.add({
  position: new Cesium.CallbackPositionProperty(() => {
    Cesium.Matrix3.fromQuaternion(planeQuat, scratch.m3);
    const o = Cesium.Matrix3.multiplyByVector(scratch.m3, p.off, new Cesium.Cartesian3());
    return Cesium.Cartesian3.add(planePos, o, new Cesium.Cartesian3());
  }, false),
  orientation: new Cesium.CallbackProperty(() => planeQuat, false),
  box: { dimensions: p.dims, material: Cesium.Color.fromCssColorString(p.color) },
  show: false,
}));

const planeMarker = viewer.entities.add({
  position: new Cesium.CallbackPositionProperty(() => planePos, false),
  point: { pixelSize: 9, color: Cesium.Color.WHITE, outlineColor: Cesium.Color.fromCssColorString('#ff7a45'), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
  show: false,
});

// ───────────────────────────── Horizon ring on the globe ─────────────────────────────
const RING_N = 256;
let ringPositions = [];
function updateRing() {
  const R = HZ.wgs84LocalRadius(plane.lat);
  const theta = HZ.horizonCentralAngle(Math.max(0, plane.alt), R);
  const pts = new Array(RING_N + 1);
  for (let i = 0; i <= RING_N; i++) {
    const b = (i / RING_N) * 2 * Math.PI;
    const p = HZ.destination(plane.lat, plane.lon, b, theta);
    pts[i] = Cesium.Cartesian3.fromRadians(p.lon, p.lat, 0);
  }
  ringPositions = pts;
}
const ringEntity = viewer.entities.add({
  polyline: {
    positions: new Cesium.CallbackProperty(() => ringPositions, false),
    width: 4,
    arcType: Cesium.ArcType.NONE,
    material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color: Cesium.Color.fromCssColorString('#4fd6ff') }),
    depthFailMaterial: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString('#4fd6ff').withAlpha(0.45) }),
  },
});

// ───────────────────────────── Input ─────────────────────────────
const keys = new Set();
const touchIn = { pitch: 0, roll: 0, active: false };
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  const a = ALTITUDES.find((x) => x.key === e.key);
  if (a) setAltitude(a.h);
  if (k === 'c') cycleView();
  if (k === 'h') setHold(!sim.hold);
  if (k === 't') cycleWarp();
  if (k === 'p') { sim.paused = !sim.paused; toast(sim.paused ? 'Paused' : 'Resumed'); }
  if (k === 'm') togglePanel();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

function axis(neg, pos) {
  let v = 0;
  for (const k of neg) if (keys.has(k)) v -= 1;
  for (const k of pos) if (keys.has(k)) v += 1;
  return Math.max(-1, Math.min(1, v));
}

// ───────────────────────────── Flight model (arcade, coordinated turns) ─────────────────────────────
function step(dt) {
  // Stick: S/↓ pulls the nose up (like pulling back on a yoke); invertible.
  let pitchIn = axis(['w', 'arrowup'], ['s', 'arrowdown']);
  if (sim.invert) pitchIn = -pitchIn;
  let rollIn = axis(['a', 'arrowleft'], ['d', 'arrowright']);
  const yawIn = axis(['q'], ['e']);
  if (touchIn.active) { pitchIn = touchIn.pitch * (sim.invert ? -1 : 1); rollIn = touchIn.roll; }
  const thrIn = axis(['control'], ['shift']) + axis(['f'], ['r']);
  plane.throttle = Math.min(1, Math.max(0, plane.throttle + thrIn * 0.5 * dt));

  // Roll: rate command, gentle self-levelling when centred.
  if (Math.abs(rollIn) > 0.05) plane.roll += rollIn * 1.6 * dt;
  else plane.roll -= plane.roll * Math.min(1, 1.2 * dt);
  plane.roll = Math.max(-80 * DEG, Math.min(80 * DEG, plane.roll));

  // Pitch: rate command, or altitude hold drives vertical speed to zero.
  if (Math.abs(pitchIn) > 0.05) plane.pitch += pitchIn * 0.7 * dt;
  else if (sim.hold) plane.pitch += (-plane.pitch * 1.5) * dt;
  plane.pitch = Math.max(-85 * DEG, Math.min(85 * DEG, plane.pitch));

  // Speed: thrust toward a throttle-dependent target, trade with climb/dive.
  const vTarget = 60 + 340 * plane.throttle;
  plane.speed += ((vTarget - plane.speed) / 5 - G * Math.sin(plane.pitch)) * dt;
  plane.speed = Math.max(25, Math.min(900, plane.speed));

  // Heading: coordinated turn rate g·tan(φ)/v, plus rudder.
  plane.heading += (G * Math.tan(plane.roll) / plane.speed + yawIn * 0.35) * dt;
  plane.heading = (plane.heading + 2 * Math.PI) % (2 * Math.PI);

  // Translate (time warp scales distance covered, not handling).
  const w = sim.warp;
  const horiz = plane.speed * Math.cos(plane.pitch) * dt * w;
  plane.vs = plane.speed * Math.sin(plane.pitch);
  plane.alt += plane.vs * dt * w;
  const R = HZ.wgs84LocalRadius(plane.lat) + plane.alt;
  const p = HZ.destination(plane.lat, plane.lon, plane.heading, horiz / R);
  plane.lat = p.lat; plane.lon = p.lon;

  // Terrain contact: keep 3 m above loaded surface (sea level when unknown).
  const h = globe.getHeight(new Cesium.Cartographic(plane.lon, plane.lat));
  plane.ground = Number.isFinite(h) ? Math.max(0, h) : 0;
  const minAlt = plane.ground + 1.7;
  plane.onGround = plane.alt <= minAlt + 0.01;
  if (plane.alt < minAlt) {
    plane.alt = minAlt;
    if (plane.pitch < 0) plane.pitch = 0;
  }
  plane.alt = Math.min(plane.alt, 5000000);
}

function setAltitude(h) {
  if (sim.mode === 'follow') takeControls(true);
  plane.alt = Math.max(h, plane.ground + 1.7);
  plane.pitch = 0;
  if (h <= 2) { plane.speed = 30; plane.throttle = 0; setHold(true); }
  if (h >= 100000 && sim.warp < 25) setWarp(25);
  toast(`Altitude ${HZ.formatAltitude(plane.alt)} → horizon ${HZ.formatDistance(HZ.lineOfSightDistance(plane.alt))}`);
  highlightPresets();
}
function goTo(loc) {
  if (sim.mode === 'follow') takeControls(true);
  plane.lat = loc.lat * DEG; plane.lon = loc.lon * DEG; plane.alt = loc.alt;
  plane.heading = loc.hdg * DEG; plane.pitch = 0; plane.roll = 0;
  if (loc.alt <= 2) { plane.speed = 30; plane.throttle = 0; setHold(true); }
  toast(loc.name);
  highlightPresets();
}

// ───────────────────────────── Cameras ─────────────────────────────
const VIEWS = ['cockpit', 'chase', 'orbit'];
function setView(v) {
  sim.view = v;
  document.getElementById('s-view').value = v;
  const isOrbit = v === 'orbit';
  scene.screenSpaceCameraController.enableInputs = isOrbit;
  partEntities.forEach((e) => { e.show = v === 'chase'; });
  planeMarker.show = isOrbit;
  updateTrafficVisibility();
  camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  if (isOrbit) {
    // Frame the whole horizon ring: back off to ~2.6× the ring radius, looking steeply down.
    const sR = HZ.surfaceDistance(Math.max(0, plane.alt), HZ.wgs84LocalRadius(plane.lat));
    camera.lookAt(planePos, new Cesium.HeadingPitchRange(plane.heading + 0.5, -1.05, Math.max(400, sR * 2.6)));
  }
}
function cycleView() { setView(VIEWS[(VIEWS.indexOf(sim.view) + 1) % VIEWS.length]); toast(`View: ${sim.view}`); }

function updateCamera() {
  planePos = Cesium.Cartesian3.fromRadians(plane.lon, plane.lat, plane.alt);
  scratch.hpr.heading = plane.heading - Math.PI / 2; // model +X is east at heading 0
  scratch.hpr.pitch = plane.pitch;
  scratch.hpr.roll = plane.roll;
  planeQuat = Cesium.Transforms.headingPitchRollQuaternion(planePos, scratch.hpr);

  if (sim.view === 'cockpit') {
    // Tilt the view down by ~60% of the horizon dip so the horizon stays on screen at high altitude.
    const look = 0.6 * HZ.horizonDip(Math.max(0, plane.alt), HZ.wgs84LocalRadius(plane.lat));
    camera.setView({ destination: planePos, orientation: { heading: plane.heading, pitch: plane.pitch - look, roll: plane.roll } });
  } else if (sim.view === 'chase') {
    const range = 75;
    camera.lookAt(planePos, new Cesium.HeadingPitchRange(plane.heading, -0.18 + plane.pitch * 0.3, range));
  } else {
    // Re-anchor the camera's current offset to the moving aircraft's local frame.
    camera.lookAtTransform(Cesium.Transforms.eastNorthUpToFixedFrame(planePos));
  }
}

// ───────────────────────────── HUD (eye level vs true horizon) ─────────────────────────────
const hud = document.getElementById('hud');
const hctx = hud.getContext('2d');
function resizeHud() {
  const dpr = window.devicePixelRatio || 1;
  hud.width = Math.round(innerWidth * dpr); hud.height = Math.round(innerHeight * dpr);
  hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resizeHud); resizeHud();

const enuM = new Cesium.Matrix4();
function projectDir(origin, az, el) {
  Cesium.Transforms.eastNorthUpToFixedFrame(origin, Cesium.Ellipsoid.WGS84, enuM);
  const local = new Cesium.Cartesian3(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el));
  const dir = Cesium.Matrix4.multiplyByPointAsVector(enuM, local, new Cesium.Cartesian3());
  const far = Cesium.Cartesian3.add(origin, Cesium.Cartesian3.multiplyByScalar(dir, 5e4, dir), new Cesium.Cartesian3());
  // Must be in front of the camera.
  const toPt = Cesium.Cartesian3.subtract(far, camera.positionWC, new Cesium.Cartesian3());
  if (Cesium.Cartesian3.dot(toPt, camera.directionWC) <= 0) return null;
  return Cesium.SceneTransforms.worldToWindowCoordinates(scene, far);
}
function drawLine(a, b, color, dash, label, labelSide) {
  const W = innerWidth, H = innerHeight;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, L = W + H;
  hctx.save();
  hctx.strokeStyle = color; hctx.lineWidth = 2; hctx.setLineDash(dash);
  hctx.shadowColor = 'rgba(0,0,0,0.6)'; hctx.shadowBlur = 3;
  hctx.beginPath();
  hctx.moveTo(a.x - ux * L, a.y - uy * L); hctx.lineTo(a.x + ux * L, a.y + uy * L);
  hctx.stroke();
  if (label) {
    // Place label where the line crosses the chosen side region.
    const pr = panel.classList.contains('closed') ? W : Math.min(W, panel.getBoundingClientRect().left);
    const tx = labelSide === 'left' ? (W < 700 ? 12 : Math.max(W * 0.18, 250)) : Math.max(20, pr - 230);
    const t = (tx - a.x) / (ux || 1e-6);
    const ty = a.y + uy * t;
    hctx.setLineDash([]);
    hctx.font = '600 12px ui-monospace, Menlo, monospace';
    hctx.fillStyle = color;
    hctx.translate(tx, ty); hctx.rotate(Math.atan2(uy, ux));
    hctx.fillText(label, 0, labelSide === 'left' ? -7 : 16);
  }
  hctx.restore();
}
function drawHud() {
  hctx.clearRect(0, 0, innerWidth, innerHeight);
  if (!sim.hud || sim.view === 'orbit') return;
  const camCarto = camera.positionCartographic;
  const eyeH = Math.max(0, camCarto.height);
  const R = HZ.wgs84LocalRadius(camCarto.latitude);
  const dip = HZ.horizonDip(eyeH, R);
  const origin = camera.positionWC;
  const az = camera.heading;
  const span = 6 * DEG;
  const e1 = projectDir(origin, az - span, 0), e2 = projectDir(origin, az + span, 0);
  const h1 = projectDir(origin, az - span, -dip), h2 = projectDir(origin, az + span, -dip);
  if (h1 && h2) drawLine(h1, h2, '#4fd6ff', [], `TRUE HORIZON  −${(dip / DEG).toFixed(dip < 0.1 * DEG ? 3 : 2)}°`, 'right');
  if (e1 && e2) drawLine(e1, e2, '#ffb347', [10, 7], 'EYE LEVEL 0°', 'left');

  const nose = sim.view === 'cockpit' ? projectDir(origin, plane.heading, plane.pitch) : null;
  if (nose) {
    const cx = nose.x, cy = nose.y;
    hctx.save();
    hctx.strokeStyle = '#7ee081'; hctx.lineWidth = 2;
    hctx.beginPath();
    hctx.moveTo(cx - 34, cy); hctx.lineTo(cx - 12, cy); hctx.lineTo(cx - 6, cy + 8); hctx.lineTo(cx, cy);
    hctx.lineTo(cx + 6, cy + 8); hctx.lineTo(cx + 12, cy); hctx.lineTo(cx + 34, cy);
    hctx.stroke();
    hctx.restore();
  }
}

// ───────────────────────────── Altitude tape (height indicator) ─────────────────────────────
const tape = document.getElementById('tape-canvas');
const tctx = tape.getContext('2d');
function drawTape() {
  const dpr = window.devicePixelRatio || 1;
  const W = tape.clientWidth, H = tape.clientHeight;
  if (tape.width !== W * dpr) { tape.width = W * dpr; tape.height = H * dpr; }
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tctx.clearRect(0, 0, W, H);
  tctx.fillStyle = 'rgba(10,16,28,0.72)';
  tctx.fillRect(0, 0, W, H);
  // Log-scale tape: 1 m … 2,000 km
  const lo = 0, hi = Math.log10(2e6);
  const y = (h) => H - 10 - ((Math.log10(Math.max(1, h)) - lo) / (hi - lo)) * (H - 20);
  tctx.font = '10px ui-monospace, Menlo, monospace';
  tctx.textAlign = 'right';
  for (const [h, t] of [[1, '1 m'], [10, '10 m'], [100, '100 m'], [1e3, '1 km'], [1e4, '10 km'], [1e5, '100 km'], [1e6, '1000 km']]) {
    tctx.fillStyle = '#94a3b8'; tctx.fillText(t, W - 18, y(h) + 3);
    tctx.fillRect(W - 14, y(h), 10, 1);
  }
  const yy = y(plane.alt);
  tctx.fillStyle = '#4fd6ff';
  tctx.beginPath(); tctx.moveTo(W - 2, yy); tctx.lineTo(W - 12, yy - 6); tctx.lineTo(W - 12, yy + 6); tctx.fill();
  const yg = y(plane.ground + 0.5);
  tctx.fillStyle = 'rgba(126,224,129,0.35)';
  tctx.fillRect(W - 6, yg, 4, H - yg);
}

// ───────────────────────────── Side-view cross-section ─────────────────────────────
const side = document.getElementById('side');
const sctx = side.getContext('2d');
const sideNote = document.getElementById('side-note');
function drawSide(h) {
  const W = side.width, H = side.height;
  sctx.clearRect(0, 0, W, H);
  const R = HZ.EARTH_MEAN_RADIUS;
  const qTrue = h / R;
  const qMin = 0.02 + 0.13 * Math.min(1, Math.max(0, Math.log10(Math.max(1, h)) / Math.log10(0.15 * R)));
  const exaggerated = qTrue < qMin;
  const q = Math.max(qTrue, qMin);
  const th = Math.acos(1 / (1 + q));
  const rv = Math.min((W * 0.42) / Math.sin(th), (H - 46) / (1 + q - Math.cos(th)));
  const ox = W / 2, oy = 26;
  const cx = ox, cy = oy + rv * (1 + q);
  const hx1 = cx - rv * Math.sin(th), hx2 = cx + rv * Math.sin(th), hy = cy - rv * Math.cos(th);

  // Earth
  sctx.fillStyle = '#16314d';
  sctx.beginPath(); sctx.arc(cx, cy, rv, 0, 2 * Math.PI); sctx.fill();
  sctx.strokeStyle = '#3f6f99'; sctx.lineWidth = 1.5; sctx.stroke();
  // Visible cap
  sctx.strokeStyle = '#7ee081'; sctx.lineWidth = 4;
  sctx.beginPath(); sctx.arc(cx, cy, rv, -Math.PI / 2 - th, -Math.PI / 2 + th); sctx.stroke();
  // Radii to horizon points (toward centre)
  sctx.setLineDash([3, 4]); sctx.strokeStyle = 'rgba(255,255,255,0.35)'; sctx.lineWidth = 1;
  sctx.beginPath(); sctx.moveTo(hx2, hy); sctx.lineTo(hx2 + (cx - hx2) * 0.35, hy + (cy - hy) * 0.35); sctx.stroke();
  sctx.beginPath(); sctx.moveTo(ox, oy); sctx.lineTo(ox, oy + rv * q + 30); sctx.stroke();
  // Eye level
  sctx.strokeStyle = '#ffb347'; sctx.setLineDash([6, 5]);
  sctx.beginPath(); sctx.moveTo(14, oy); sctx.lineTo(W - 14, oy); sctx.stroke();
  sctx.setLineDash([]);
  // Lines of sight (tangents)
  sctx.strokeStyle = '#4fd6ff'; sctx.lineWidth = 2;
  sctx.beginPath(); sctx.moveTo(hx1, hy); sctx.lineTo(ox, oy); sctx.lineTo(hx2, hy); sctx.stroke();
  // Right-angle marker at horizon point
  const tx = (ox - hx2), ty = (oy - hy); const tl = Math.hypot(tx, ty);
  const rx = (cx - hx2), ry = (cy - hy); const rl = Math.hypot(rx, ry);
  const s = 7;
  sctx.strokeStyle = 'rgba(255,255,255,0.7)'; sctx.lineWidth = 1;
  sctx.beginPath();
  sctx.moveTo(hx2 + tx / tl * s, hy + ty / tl * s);
  sctx.lineTo(hx2 + tx / tl * s + rx / rl * s, hy + ty / tl * s + ry / rl * s);
  sctx.lineTo(hx2 + rx / rl * s, hy + ry / rl * s);
  sctx.stroke();
  // Dip arc
  sctx.strokeStyle = '#ffffff'; sctx.beginPath();
  sctx.arc(ox, oy, 26, 0, Math.atan2(hy - oy, hx2 - ox)); sctx.stroke();
  // Observer
  sctx.fillStyle = '#ffffff'; sctx.beginPath(); sctx.arc(ox, oy, 4, 0, 2 * Math.PI); sctx.fill();
  // Labels
  sctx.font = '11px ui-monospace, Menlo, monospace';
  sctx.fillStyle = '#4fd6ff'; sctx.textAlign = 'left';
  sctx.fillText(`d = ${HZ.formatDistance(HZ.lineOfSightDistance(h))}`, (ox + hx2) / 2 + 6, (oy + hy) / 2 - 2);
  sctx.fillStyle = '#ffffff';
  sctx.fillText(`dip ${(HZ.horizonDip(h) / DEG).toFixed(2)}°`, ox + 30, oy + 14);
  sctx.fillText(`h = ${HZ.formatAltitude(h)}`, ox + 6, oy - 8);
  sctx.fillStyle = '#ffb347'; sctx.fillText('eye level', 16, oy - 6);
  sctx.fillStyle = '#7ee081'; sctx.textAlign = 'center';
  sctx.fillText(`s = ${HZ.formatDistance(HZ.surfaceDistance(h))}`, ox, Math.min(H - 6, oy + rv * q + 16));
  sideNote.textContent = exaggerated
    ? `Height exaggerated ×${(q / qTrue).toFixed(qTrue > 0 ? 0 : 0)} so the geometry is visible. To scale above ~${HZ.formatAltitude(0.15 * R)}.`
    : 'Drawn to scale.';
  if (!(qTrue > 0)) sideNote.textContent = 'Height exaggerated so the geometry is visible.';
}

// ───────────────────────────── Distance-vs-height chart ─────────────────────────────
const chart = document.getElementById('chart');
const cctx = chart.getContext('2d');
function drawChart(h) {
  const W = chart.width, H = chart.height;
  const L = 44, Rm = 10, T = 12, B = 30;
  cctx.clearRect(0, 0, W, H);
  const x0 = 0, x1 = Math.log10(2e6), y0 = 0, y1 = Math.log10(6e3); // m, km
  const X = (hm) => L + ((Math.log10(hm) - x0) / (x1 - x0)) * (W - L - Rm);
  const Y = (dkm) => H - B - ((Math.log10(dkm) - y0) / (y1 - y0)) * (H - T - B);
  cctx.font = '10px ui-monospace, Menlo, monospace';
  cctx.strokeStyle = 'rgba(255,255,255,0.08)'; cctx.fillStyle = '#94a3b8';
  cctx.textAlign = 'center';
  for (const [v, t] of [[1, '1m'], [100, '100m'], [1e4, '10km'], [1e6, '1000km']]) {
    cctx.beginPath(); cctx.moveTo(X(v), T); cctx.lineTo(X(v), H - B); cctx.stroke();
    cctx.fillText(t, X(v), H - B + 13);
  }
  cctx.textAlign = 'right';
  for (const [v, t] of [[1, '1'], [10, '10'], [100, '100'], [1000, '1000']]) {
    cctx.beginPath(); cctx.moveTo(L, Y(v)); cctx.lineTo(W - Rm, Y(v)); cctx.stroke();
    cctx.fillText(t, L - 5, Y(v) + 3);
  }
  cctx.textAlign = 'center';
  cctx.fillText('height', (L + W) / 2, H - 4);
  cctx.save(); cctx.translate(10, (T + H - B) / 2); cctx.rotate(-Math.PI / 2); cctx.fillText('horizon km', 0, 0); cctx.restore();

  const curve = (fn, color, dash) => {
    cctx.strokeStyle = color; cctx.lineWidth = 2; cctx.setLineDash(dash); cctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const hm = Math.pow(10, x0 + (i / 120) * (x1 - x0));
      const d = fn(hm) / 1000;
      if (i === 0) cctx.moveTo(X(hm), Y(d)); else cctx.lineTo(X(hm), Y(d));
    }
    cctx.stroke(); cctx.setLineDash([]);
  };
  curve((x) => HZ.refractedDistance(x), 'rgba(255,179,71,0.8)', [5, 4]);
  curve((x) => HZ.lineOfSightDistance(x), '#4fd6ff', []);
  const hh = Math.max(1, h);
  const dd = HZ.lineOfSightDistance(hh) / 1000;
  cctx.fillStyle = '#ffffff';
  cctx.beginPath(); cctx.arc(X(hh), Y(Math.max(1, dd)), 5, 0, 2 * Math.PI); cctx.fill();
  cctx.textAlign = 'left';
  cctx.fillStyle = '#4fd6ff'; cctx.fillText('geometric', L + 6, T + 10);
  cctx.fillStyle = '#ffb347'; cctx.fillText('with refraction', L + 6, T + 23);
}

// ───────────────────────────── Readouts ─────────────────────────────
const $ = (id) => document.getElementById(id);
const el = {
  horizon: $('r-horizon'), horizonSub: $('r-horizon-sub'), alt: $('r-alt'), agl: $('r-agl'), spd: $('r-spd'),
  hdg: $('r-hdg'), vs: $('r-vs'), thr: $('r-thr'), flags: $('r-flags'),
  d: $('p-d'), s: $('p-s'), dr: $('p-dr'), dip: $('p-dip'), frac: $('p-frac'), ev: $('p-ev'),
};
let lastPanel = 0;
function updateReadouts(now) {
  const h = Math.max(0, plane.alt);
  const R = HZ.wgs84LocalRadius(plane.lat);
  const d = HZ.lineOfSightDistance(h, R);
  el.horizon.textContent = HZ.formatDistance(d);
  el.horizonSub.textContent = sim.mode === 'follow' && live.flight
    ? `seen from ${live.flight.callsign || live.flight.flight || live.flight.reg} · ${HZ.formatDistance(HZ.surfaceDistance(h, R))} over the ground`
    : `line of sight · ${HZ.formatDistance(HZ.surfaceDistance(h, R))} over the ground`;
  el.alt.textContent = HZ.formatAltitude(plane.alt);
  el.agl.textContent = HZ.formatAltitude(plane.alt - plane.ground);
  el.spd.textContent = `${Math.round(plane.speed * 1.94384)} kt`;
  el.hdg.textContent = `${String(Math.round(plane.heading / DEG) % 360).padStart(3, '0')}°`;
  el.vs.textContent = `${plane.vs >= 0 ? '+' : ''}${Math.round(plane.vs * 196.85).toLocaleString()} fpm`;
  el.thr.textContent = `${Math.round(plane.throttle * 100)}%`;
  const flags = [];
  if (plane.onGround) flags.push('<span class="warn">SURFACE</span>');
  if (sim.hold) flags.push('<span class="on">ALT HOLD</span>');
  if (sim.mode === 'follow' && live.flight) flags.push(`<span class="live">LIVE FR24 · ${escapeHtml(live.flight.callsign || live.flight.flight || live.flight.reg || '')}</span>`);
  else if (sim.warp > 1) flags.push(`<span class="on">WARP ${sim.warp}×</span>`);
  if (sim.paused) flags.push('<span class="warn">PAUSED</span>');
  el.flags.innerHTML = flags.join(' · ');

  if (now - lastPanel > 120 && !panel.classList.contains('closed')) {
    lastPanel = now;
    el.d.textContent = HZ.formatDistance(d);
    el.s.textContent = HZ.formatDistance(HZ.surfaceDistance(h, R));
    el.dr.textContent = HZ.formatDistance(HZ.refractedDistance(h, R));
    const dip = HZ.horizonDip(h, R) / DEG;
    el.dip.textContent = `${dip.toFixed(dip < 1 ? 3 : 2)}°`;
    const f = HZ.visibleFraction(h, R) * 100;
    el.frac.textContent = `${f < 1 ? f.toPrecision(2) : f.toFixed(1)}%`;
    el.ev.textContent = HZ.formatDistance(HZ.mutualVisibilityDistance(h, 8849, R));
    drawSide(h);
    drawChart(h);
  }
}

// ───────────────────────────── UI wiring ─────────────────────────────
const panel = $('panel');
function togglePanel(force) {
  const open = force ?? panel.classList.contains('closed');
  panel.classList.toggle('closed', !open);
  $('panel-toggle').setAttribute('aria-expanded', String(open));
}
$('panel-toggle').addEventListener('click', () => togglePanel());
if (matchMedia('(max-width: 760px), (pointer: coarse)').matches) togglePanel(false);

const altBox = $('alt-presets');
ALTITUDES.forEach((a) => {
  const b = document.createElement('button');
  b.className = 'chip'; b.textContent = a.label; b.title = `Key ${a.key}`;
  b.dataset.h = a.h;
  b.addEventListener('click', () => setAltitude(a.h));
  altBox.appendChild(b);
});
const locBox = $('loc-presets');
LOCATIONS.forEach((l) => {
  const b = document.createElement('button');
  b.className = 'chip'; b.textContent = l.name;
  b.addEventListener('click', () => goTo(l));
  locBox.appendChild(b);
});
function highlightPresets() {
  altBox.querySelectorAll('.chip').forEach((b) => b.classList.toggle('active', Math.abs(+b.dataset.h - plane.alt) < 1));
}

$('s-imagery').addEventListener('change', (e) => setImagery(e.target.value));
$('s-view').addEventListener('change', (e) => setView(e.target.value));
$('s-warp').addEventListener('change', (e) => setWarp(+e.target.value));
$('s-terrain').addEventListener('change', (e) => { viewer.terrainProvider = e.target.checked ? terrainProvider : flatTerrain; });
$('s-ring').addEventListener('change', (e) => { sim.ring = e.target.checked; ringEntity.show = sim.ring; });
$('s-hud').addEventListener('change', (e) => { sim.hud = e.target.checked; });
$('s-hold').addEventListener('change', (e) => setHold(e.target.checked));
$('s-invert').addEventListener('change', (e) => { sim.invert = e.target.checked; });

function setHold(v) { sim.hold = v; $('s-hold').checked = v; }
const WARPS = [1, 5, 25, 100];
function setWarp(w) { sim.warp = w; $('s-warp').value = String(w); }
function cycleWarp() { setWarp(WARPS[(WARPS.indexOf(sim.warp) + 1) % WARPS.length]); toast(`Time warp ${sim.warp}×`); }

let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

$('start').addEventListener('click', () => {
  $('intro').classList.add('hidden');
  sim.paused = false;
});

// Touch: virtual stick + throttle
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) {
  $('touch').hidden = false;
  const stick = $('stick'), knob = $('stick-knob');
  let sid = null;
  const moveStick = (e) => {
    const r = stick.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    touchIn.roll = x; touchIn.pitch = y; // drag down = pull back = nose up
    knob.style.transform = `translate(${x * 38}px, ${y * 38}px)`;
  };
  stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; stick.setPointerCapture(sid); touchIn.active = true; moveStick(e); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) moveStick(e); });
  const endStick = () => { sid = null; touchIn.active = false; touchIn.roll = 0; touchIn.pitch = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);

  const thr = $('throttle'), fill = $('throttle-fill');
  const setThr = (e) => {
    const r = thr.getBoundingClientRect();
    plane.throttle = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
  };
  thr.addEventListener('pointerdown', (e) => { thr.setPointerCapture(e.pointerId); setThr(e); });
  thr.addEventListener('pointermove', (e) => { if (e.buttons || e.pressure) setThr(e); });
  setInterval(() => { fill.style.height = `${plane.throttle * 100}%`; }, 100);

  document.querySelectorAll('#touch-buttons .chip').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.act === 'view') cycleView();
    if (b.dataset.act === 'hold') { setHold(!sim.hold); toast(sim.hold ? 'Altitude hold on' : 'Altitude hold off'); }
  }));
}

document.addEventListener('visibilitychange', () => { if (document.hidden) sim.paused = true; });

// ───────────────────────────── Live flight (Flightradar24) ─────────────────────────────
// Ride along with a real aircraft: its reported position/track/altitude drive the camera,
// so the horizon ring, HUD lines and panel all show the horizon from that aircraft.
// Between API updates the state is dead-reckoned (constant GS, V/S and turn rate), and
// each new fix is blended in over ~1.5 s so the view never jumps.
const live = {
  client: null, demo: false, flight: null, fix: null, prevFix: null, turnRate: 0,
  query: null, timer: 0, polling: false, lastFixAt: 0, nextPollAt: 0, backoff: 1,
  off: { lat: 0, lon: 0, alt: 0, hdg: 0 }, results: [], pitchS: 0, rollS: 0,
};
const fr = {
  key: $('fr-key'), show: $('fr-key-show'), sandbox: $('fr-sandbox'), remember: $('fr-remember'), proxy: $('fr-proxy'),
  interval: $('fr-interval'), form: $('fr-search'), by: $('fr-by'), q: $('fr-q'), nearby: $('fr-nearby'), demo: $('fr-demo'),
  status: $('fr-status'), results: $('fr-results'), follow: $('fr-follow'), title: $('fr-follow-title'), meta: $('fr-follow-meta'),
  refresh: $('fr-refresh'), take: $('fr-take'), stop: $('fr-stop'),
  optRoute: $('fr-opt-route'), optTrack: $('fr-opt-track'), optAtc: $('fr-opt-atc'),
  route: $('fr-route'), from: $('fr-from'), to: $('fr-to'), destVis: $('fr-dest-vis'), trackNote: $('fr-track-note'),
  atc: $('fr-atc'), atcLinks: $('fr-atc-links'),
};

function escapeHtml(t) { return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage unavailable */ } }
function load(k) { try { return localStorage.getItem(k); } catch { return null; } }

// Restore settings. The key is only persisted when the user opts in.
(() => {
  const k = load('fr24.key');
  if (k) { fr.key.value = k; fr.remember.checked = true; }
  fr.sandbox.checked = load('fr24.sandbox') === '1';
  fr.proxy.value = load('fr24.proxy') || '';
  const iv = load('fr24.interval'); if (iv) fr.interval.value = iv;
  for (const [el, key] of [[fr.optRoute, 'fr24.optRoute'], [fr.optTrack, 'fr24.optTrack'], [fr.optAtc, 'fr24.optAtc']]) {
    const v = load(key); if (v !== null) el.checked = v === '1';
    el.addEventListener('change', () => {
      store(key, el.checked ? '1' : '0');
      if (sim.mode === 'follow' && live.flight) showRoute(live.flight, { refetchTrack: el === fr.optTrack });
    });
  }
})();
const saveKey = () => store('fr24.key', fr.remember.checked && fr.key.value.trim() ? fr.key.value.trim() : null);
fr.key.addEventListener('change', saveKey);
fr.remember.addEventListener('change', saveKey);
fr.sandbox.addEventListener('change', () => store('fr24.sandbox', fr.sandbox.checked ? '1' : '0'));
fr.proxy.addEventListener('change', () => store('fr24.proxy', fr.proxy.value.trim() || null));
fr.interval.addEventListener('change', () => { store('fr24.interval', fr.interval.value); if (sim.mode === 'follow') schedulePoll(); });
fr.show.addEventListener('click', () => {
  const hidden = fr.key.type === 'password';
  fr.key.type = hidden ? 'text' : 'password';
  fr.show.textContent = hidden ? 'Hide' : 'Show';
});
// Keep flight keys from steering the plane while typing.
[fr.key, fr.q, fr.proxy].forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));

function setStatus(msg, isErr = false) { fr.status.textContent = msg; fr.status.classList.toggle('err', isErr); }

function realClient() {
  return new FR.FR24Client({ token: fr.key.value, sandbox: fr.sandbox.checked, proxyUrl: fr.proxy.value });
}

// Traffic markers (snapshot of the last search, dead-reckoned so they keep moving).
const trafficEntities = [];
function clearTraffic() { trafficEntities.splice(0).forEach((e) => viewer.entities.remove(e)); }
function showTraffic(list) {
  clearTraffic();
  for (const f of list) {
    const e = viewer.entities.add({
      position: new Cesium.CallbackPositionProperty(() => {
        const p = FR.extrapolate(f, Date.now(), 0, 120);
        return Cesium.Cartesian3.fromRadians(p.lon, p.lat, p.altM);
      }, false),
      point: { pixelSize: 8, color: Cesium.Color.fromCssColorString('#ff8f8f'), outlineColor: Cesium.Color.BLACK, outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: f.callsign || f.flight || f.reg || '?', font: '12px ui-monospace, Menlo, monospace', fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(10, -10), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3.0e6), disableDepthTestDistance: Number.POSITIVE_INFINITY },
    });
    e.fr24 = f;
    trafficEntities.push(e);
  }
  updateTrafficVisibility();
}
function updateTrafficVisibility() {
  for (const e of trafficEntities) {
    // Hide the marker of the aircraft we're sitting in.
    e.show = !(sim.mode === 'follow' && live.flight && e.fr24.id === live.flight.id && sim.view === 'cockpit');
  }
}
new Cesium.ScreenSpaceEventHandler(scene.canvas).setInputAction((click) => {
  const picked = scene.pick(click.position);
  if (picked && picked.id && picked.id.fr24) follow(picked.id.fr24);
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

function renderResults(list) {
  fr.results.innerHTML = '';
  list.forEach((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = FR.describe(f);
    b.dataset.id = f.id || '';
    b.addEventListener('click', () => follow(f));
    fr.results.appendChild(b);
  });
  markActiveResult();
}
function markActiveResult() {
  fr.results.querySelectorAll('button').forEach((b) => b.classList.toggle('active', !!live.flight && b.dataset.id === (live.flight.id || '')));
}

async function runSearch(params, what) {
  const client = live.demo ? live.client : realClient();
  setStatus(`Searching ${what}…`);
  try {
    const list = await client.live({ ...params, limit: 40 }, 'full');
    const here = { lat: plane.lat, lon: plane.lon };
    const dist = (f) => Math.hypot(f.lat - here.lat, (f.lon - here.lon) * Math.cos(here.lat));
    list.sort((a, b) => dist(a) - dist(b));
    live.results = list;
    if (!live.demo) live.client = client;
    renderResults(list);
    showTraffic(list);
    if (!list.length) setStatus(`No live flights found ${what}. The aircraft may be on the ground, out of coverage, or the identifier may be different.`);
    else setStatus(`${list.length} live flight${list.length === 1 ? '' : 's'} ${what}. Tap one to ride along.${client.sandbox ? ' (sandbox: static sample data)' : ''}`);
    if (list.length === 1) follow(list[0]);
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
}

fr.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = FR.cleanIds(fr.q.value.replace(/\s+/g, ''));
  if (!q) { setStatus('Type a flight number, callsign or registration (letters, digits and hyphens).', true); return; }
  live.demo = false;
  runSearch({ [fr.by.value]: q }, `for ${q}`);
});
fr.nearby.addEventListener('click', () => {
  live.demo = false;
  runSearch({ bounds: FR.boundsAround(plane.lat, plane.lon, 300) }, 'within 300 km');
});
fr.demo.addEventListener('click', () => startDemo());
function startDemo() {
  live.demo = true;
  live.client = new FR.MockFR24Client(plane.lat, plane.lon);
  return runSearch({}, 'in demo traffic (simulated, not real)');
}

function follow(f) {
  const now = Date.now();
  // Ease in from wherever we are, unless it's far away (then cut straight to it).
  const p = FR.extrapolate(f, now);
  const far = Math.hypot(p.lat - plane.lat, (p.lon - plane.lon) * Math.cos(plane.lat)) * 6.371e6 > 30000;
  live.off = far
    ? { lat: 0, lon: 0, alt: 0, hdg: 0 }
    : { lat: plane.lat - p.lat, lon: plane.lon - p.lon, alt: plane.alt - p.altM, hdg: FR.angleDiff(plane.heading, p.track) };
  live.flight = { ...f };
  live.fix = f; live.prevFix = null; live.turnRate = 0; live.lastFixAt = now; live.backoff = 1;
  live.pitchS = plane.pitch; live.rollS = plane.roll;
  sim.mode = 'follow';
  if (sim.view === 'orbit') setView('cockpit');
  sim.paused = false;
  $('intro').classList.add('hidden');
  fr.follow.hidden = false;
  fr.title.textContent = FR.describe(f).split(' · ')[0];
  markActiveResult();
  updateTrafficVisibility();
  if (matchMedia('(max-width: 760px), (pointer: coarse)').matches) togglePanel(false);
  toast(`Riding along with ${f.callsign || f.flight || f.reg}`);
  schedulePoll();
  showRoute(f);
  updateFollowMeta();
}

function schedulePoll(delayMs) {
  clearTimeout(live.timer);
  const ms = delayMs ?? +fr.interval.value * 1000 * live.backoff;
  live.nextPollAt = Date.now() + ms;
  live.timer = setTimeout(poll, ms);
}

async function poll() {
  if (sim.mode !== 'follow' || !live.flight || live.polling) return;
  if (document.hidden) { schedulePoll(5000); return; } // don't spend credits in a background tab
  live.polling = true;
  try {
    const pred = FR.extrapolate(live.fix, Date.now(), live.turnRate);
    const query = FR.followQuery(live.flight, { lat: pred.lat, lon: pred.lon, gs: pred.gs }, +fr.interval.value);
    const byArea = !!query.bounds;
    const list = await live.client.live({ ...query, limit: byArea ? 100 : 10 }, 'light');
    // Match by fr24_id; an identifier query with exactly one hit is safe to take, an area query is not.
    const rec = list.find((r) => r.id && r.id === live.flight.id) || (!byArea && list.length === 1 ? list[0] : null);
    if (!rec) {
      setStatus('No live position in the last update: landed, out of coverage, or the flight ended. Holding the last known track.', true);
    } else if (rec.t > live.fix.t) {
      const now = Date.now();
      // Blend: remember where we're drawn now relative to the new prediction.
      const shown = { lat: plane.lat, lon: plane.lon, alt: plane.alt, hdg: plane.heading };
      const turn = FR.turnRateBetween(live.fix, rec);
      const pred = FR.extrapolate(rec, now, turn);
      live.off = { lat: shown.lat - pred.lat, lon: shown.lon - pred.lon, alt: shown.alt - pred.altM, hdg: FR.angleDiff(shown.hdg, pred.track) };
      live.prevFix = live.fix;
      live.fix = { ...rec };
      live.turnRate = turn;
      live.flight = { ...live.flight, ...Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== null && v !== undefined)) };
      live.lastFixAt = now;
      appendFlown({ lat: rec.lat, lon: rec.lon, altM: rec.altM, t: rec.t });
      setStatus(`Updated ${new Date(rec.t).toLocaleTimeString()} · source ${rec.source || 'n/a'}`);
    }
    live.backoff = 1;
  } catch (e) {
    setStatus(e.message || String(e), true);
    if (e.kind === 'auth' || e.kind === 'credits' || e.kind === 'network' || e.kind === 'validation') {
      live.polling = false;
      setStatus(`${e.message} Live updates paused; still dead-reckoning from the last position.`, true);
      return; // stop polling until the user presses "Update now"
    }
    live.backoff = Math.min(8, live.backoff * 2);
  }
  live.polling = false;
  if (sim.mode === 'follow') schedulePoll();
}

function liveStep(dt) {
  const now = Date.now();
  const p = FR.extrapolate(live.fix, now, live.turnRate);
  const k = Math.exp(-dt / 1.5); // decay the blend offset
  live.off.lat *= k; live.off.lon *= k; live.off.alt *= k; live.off.hdg *= k;
  plane.lat = p.lat + live.off.lat;
  plane.lon = p.lon + live.off.lon;
  plane.alt = p.altM + live.off.alt;
  plane.heading = (p.track + live.off.hdg + 2 * Math.PI) % (2 * Math.PI);
  plane.speed = Math.max(0, p.gs);
  plane.vs = p.dt >= 120 ? 0 : p.vs;
  // Attitude estimated from the kinematics: flight-path angle and coordinated-turn bank.
  const pitchT = Math.max(-15 * DEG, Math.min(15 * DEG, Math.atan2(plane.vs, Math.max(30, plane.speed))));
  const rollT = FR.bankFor(plane.speed, live.turnRate);
  const a = 1 - Math.exp(-dt / 0.8);
  live.pitchS += (pitchT - live.pitchS) * a;
  live.rollS += (rollT - live.rollS) * a;
  plane.pitch = live.pitchS;
  plane.roll = live.rollS;
  const h = globe.getHeight(new Cesium.Cartographic(plane.lon, plane.lat));
  plane.ground = Number.isFinite(h) ? Math.max(0, h) : 0;
  plane.onGround = plane.alt <= plane.ground + 2;
  if (plane.alt < plane.ground + 1.7) plane.alt = plane.ground + 1.7;
}

// ───────────────────────────── Route, flown path and ATC links ─────────────────────────────
const route = {
  token: 0, entities: [], orig: null, dest: null, flown: [], flownCart: [], remainingCart: [], remainingAt: 0,
  nearby: null, nearbyAt: 0, trackState: '',
};
// Note: Cesium takes (longitude, latitude); this helper takes (lat, lon) to match the rest of the module.
const C = (lat, lon, h = 0) => Cesium.Cartesian3.fromRadians(lon, lat, h);

function clearRoute() {
  route.token++;
  route.entities.splice(0).forEach((e) => viewer.entities.remove(e));
  route.orig = route.dest = route.nearby = null;
  route.flown = []; route.flownCart = []; route.remainingCart = []; route.trackState = '';
  fr.route.hidden = true; fr.atc.hidden = true;
}

function addRouteEntity(opts) { const e = viewer.entities.add(opts); route.entities.push(e); return e; }

function airportMarker(a, css, role) {
  const code = a.iata || a.icao;
  let lastText = '', lastAt = 0;
  const text = new Cesium.CallbackProperty(() => {
    const now = performance.now();
    if (now - lastAt < 500 && lastText) return lastText;
    lastAt = now;
    const R = HZ.wgs84LocalRadius(plane.lat);
    const dist = AP.gcDistance(plane.lat, plane.lon, a.lat, a.lon);
    const reach = HZ.surfaceDistance(Math.max(0, plane.alt), R) + HZ.surfaceDistance(a.elevFt * 0.3048 + 30, R);
    lastText = `${role} ${code} · ${HZ.formatDistance(dist)}${dist > reach ? ' · below horizon' : ''}`;
    return lastText;
  }, false);
  addRouteEntity({
    position: C(a.lat, a.lon, a.elevFt * 0.3048),
    point: { pixelSize: 11, color: Cesium.Color.fromCssColorString(css), outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { text, font: '600 13px ui-monospace, Menlo, monospace',
      fillColor: Cesium.Color.fromCssColorString(css), outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -18),
      disableDepthTestDistance: Number.POSITIVE_INFINITY },
  });
}

function setFlown(points) {
  route.flown = points.slice();
  route.flownCart = route.flown.map((p) => C(p.lat, p.lon, p.altM));
}
function appendFlown(p) {
  const last = route.flown[route.flown.length - 1];
  if (last && p.t <= last.t) return;
  route.flown.push(p);
  route.flownCart.push(C(p.lat, p.lon, p.altM));
}

async function resolveAirport(code) {
  if (!code) return null;
  const a = AP.lookupAirport(code);
  if (a || live.demo || !live.client?.airport) return a;
  try { return await live.client.airport(code); } catch { return null; }
}

async function showRoute(f, { refetchTrack = true } = {}) {
  const keepFlown = !refetchTrack ? route.flown.slice() : null;
  clearRoute();
  const token = route.token;
  if (!fr.optRoute.checked && !fr.optTrack.checked && !fr.optAtc.checked) return;
  try { await AP.loadAirports(); } catch { /* bundled table missing: fall back to FR24 lookups */ }
  const [orig, dest] = await Promise.all([resolveAirport(f.orig), resolveAirport(f.dest)]);
  if (token !== route.token) return; // a newer follow/route replaced this one
  route.orig = orig; route.dest = dest;

  if (fr.optRoute.checked) {
    if (orig) airportMarker(orig, '#7ee081', 'FROM');
    if (dest) airportMarker(dest, '#ffd166', 'TO');
    if (orig && dest) {
      // Planned great circle, faint, on the ground.
      addRouteEntity({ polyline: {
        positions: AP.greatCirclePoints(orig.lat, orig.lon, dest.lat, dest.lon, 128).map((p) => C(p.lat, p.lon, 0)),
        width: 1.5, arcType: Cesium.ArcType.NONE, material: Cesium.Color.WHITE.withAlpha(0.25) } });
    }
    if (dest) {
      // Remaining leg: from the aircraft down to the destination, dashed (recomputed once a second).
      addRouteEntity({ polyline: {
        positions: new Cesium.CallbackProperty(() => {
          const now = performance.now();
          if (now - route.remainingAt > 1000 || !route.remainingCart.length) {
            route.remainingAt = now;
            // Start ~5 km ahead so the line doesn't pass through the cockpit camera.
            const total = AP.gcDistance(plane.lat, plane.lon, dest.lat, dest.lon);
            const t0 = Math.min(0.5, 5000 / Math.max(1, total));
            const pts = AP.greatCirclePoints(plane.lat, plane.lon, dest.lat, dest.lon, 96, t0);
            const h0 = plane.alt, h1 = dest.elevFt * 0.3048, n = pts.length - 1;
            // Hold altitude, then descend on a ~3° glide (≈ 19 m along per 1 m down).
            route.remainingCart = pts.map((p, i) => {
              const togo = total * (1 - t0) * (1 - i / n);
              const h = h1 + Math.min(h0 - h1, Math.max(0, togo / 19)) ;
              return C(p.lat, p.lon, Math.max(h1, h));
            });
          }
          return route.remainingCart;
        }, false),
        width: 2.5, arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString('#ffd166'), dashLength: 18 }) } });
    }
  }

  if (fr.optTrack.checked || fr.optRoute.checked) {
    // Flown path at true altitude: loaded history + live fixes + the aircraft itself.
    addRouteEntity({ polyline: {
      positions: new Cesium.CallbackProperty(() => (sim.view === 'cockpit' ? route.flownCart : route.flownCart.concat([planePos])), false),
      width: 3, arcType: Cesium.ArcType.NONE,
      material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.15, color: Cesium.Color.fromCssColorString('#ff7a45') }) } });
  }
  if (keepFlown) setFlown(keepFlown);
  else if (live.fix) appendFlown({ lat: live.fix.lat, lon: live.fix.lon, altM: live.fix.altM, t: live.fix.t });

  fr.route.hidden = !fr.optRoute.checked && !fr.optTrack.checked;
  fr.atc.hidden = !fr.optAtc.checked;
  renderAtc(true);

  if (fr.optTrack.checked && refetchTrack && f.id) {
    route.trackState = 'Loading flown path…';
    try {
      const pts = await live.client.flightTrack(f.id);
      if (token !== route.token) return;
      const newer = route.flown.filter((p) => !pts.length || p.t > pts[pts.length - 1].t);
      setFlown(pts.concat(newer));
      route.trackState = pts.length ? `Flown path: ${pts.length} points from Flightradar24.` : 'No flown path returned for this flight.';
    } catch (e) {
      if (token !== route.token) return;
      route.trackState = `Flown path unavailable: ${e.message}`;
    }
  } else if (!fr.optTrack.checked) {
    route.trackState = 'Flown path: drawing from live updates only (history off).';
  }
}

function renderRouteInfo() {
  if (fr.route.hidden || !live.flight) return;
  const f = live.flight;
  const fmtKm = (m) => HZ.formatDistance(m);
  const o = route.orig, d = route.dest;
  fr.from.textContent = o
    ? `${AP.airportLabel(o)} · ${fmtKm(AP.gcDistance(o.lat, o.lon, plane.lat, plane.lon))} behind`
    : f.orig ? `${f.orig} (location unknown)` : 'not reported';
  if (d) {
    const togo = AP.gcDistance(plane.lat, plane.lon, d.lat, d.lon);
    const eta = f.eta && f.eta > Date.now() ? f.eta : plane.speed > 30 ? Date.now() + (togo / plane.speed) * 1000 : null;
    fr.to.textContent = `${AP.airportLabel(d)} · ${fmtKm(togo)} to go${eta ? ` · ETA ${new Date(eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${f.eta ? '' : ' (est.)'}` : ''}`;
    // Tie-in with the horizon math: can you see the destination yet?
    const R = HZ.wgs84LocalRadius(plane.lat);
    const sEye = HZ.surfaceDistance(Math.max(0, plane.alt), R);
    const sAirport = HZ.surfaceDistance(Math.max(0, d.elevFt * 0.3048 + 30), R); // ~30 m tower
    const reach = sEye + sAirport;
    fr.destVis.textContent = togo <= reach
      ? `${d.iata || d.icao} is within line of sight now (horizon ${fmtKm(sEye)}).`
      : `${d.iata || d.icao} is ${fmtKm(togo - reach)} beyond the horizon. Its tower comes into view at ${fmtKm(reach)} out.`;
  } else {
    fr.to.textContent = f.dest ? `${f.dest} (location unknown)` : 'not reported';
    fr.destVis.textContent = '';
  }
  fr.trackNote.textContent = route.trackState;
}

function renderAtc(force) {
  if (fr.atc.hidden) return;
  const now = Date.now();
  if (!force && now - route.nearbyAt < 10000) return;
  route.nearbyAt = now;
  route.nearby = AP.nearestAirport(plane.lat, plane.lon, 2);
  const seen = new Set();
  const links = [];
  const add = (a, label) => {
    const code = a?.icao;
    if (!code || seen.has(code)) return;
    seen.add(code);
    links.push(`<a class="chip" href="${AP.liveatcUrl(code)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(a.name)}">${escapeHtml(label)} ${escapeHtml(a.iata || code)}</a>`);
  };
  add(route.orig, 'Departure');
  add(route.nearby, 'Nearest');
  add(route.dest, 'Arrival');
  fr.atcLinks.innerHTML = links.join('') || '<span class="note">No airport codes available for this flight.</span>';
}

function updateFollowMeta() {
  if (sim.mode !== 'follow' || !live.flight) return;
  const f = live.flight;
  const age = Math.round((Date.now() - live.fix.t) / 1000);
  const next = Math.max(0, Math.round((live.nextPollAt - Date.now()) / 1000));
  const bits = [];
  if (f.type) bits.push(f.type);
  if (f.orig || f.dest) bits.push(`${f.orig || '?'}→${f.dest || '?'}`);
  bits.push(f.altFt >= 18000 ? `FL${Math.round(f.altFt / 100)}` : `${Math.round(f.altFt).toLocaleString()} ft`);
  bits.push(`${Math.round(f.gs / FR.KT)} kt`);
  bits.push(`position ${age}s old`);
  bits.push(live.polling ? 'updating…' : live.timer && next > 0 ? `next in ${next}s` : 'updates paused');
  fr.meta.textContent = `${bits.join(' · ')}${live.demo ? ' · DEMO DATA' : ''}`;
  renderRouteInfo();
  renderAtc(false);
  fr.title.textContent = f.callsign || f.flight || f.reg || 'Live flight';
}
setInterval(updateFollowMeta, 500);

function takeControls(silent) {
  if (sim.mode !== 'follow') return;
  clearTimeout(live.timer); live.timer = 0;
  sim.mode = 'free';
  // Hand over the current state; pick a throttle that holds the current speed.
  plane.throttle = Math.min(1, Math.max(0, (plane.speed - 60) / 340));
  plane.speed = Math.max(25, Math.min(900, plane.speed));
  setHold(true);
  fr.follow.hidden = true;
  updateTrafficVisibility();
  if (!silent) toast('You have the controls. Altitude hold on.');
}
fr.take.addEventListener('click', () => takeControls());
fr.stop.addEventListener('click', () => {
  takeControls(true);
  live.flight = null;
  clearRoute();
  markActiveResult();
  setStatus('Stopped following. Traffic markers stay as a snapshot.');
});
fr.refresh.addEventListener('click', () => { live.backoff = 1; live.polling = false; schedulePoll(0); });

// ───────────────────────────── Main loop ─────────────────────────────
let last = performance.now();
scene.preUpdate.addEventListener(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!sim.paused) { if (sim.mode === 'follow') liveStep(dt); else step(dt); }
  updateCamera();
  updateRing();
  updateReadouts(now);
});
scene.postRender.addEventListener(() => { drawHud(); drawTape(); });

setView('cockpit');
highlightPresets();

// Debug/automation hook (used by the smoke test; harmless in production).
window.__sim = { plane, sim, live, poll, route, setAltitude, goTo, setView, startDemo, terrainStats: () => terrainProvider.stats() };
