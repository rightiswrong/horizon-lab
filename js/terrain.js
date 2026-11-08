// Open terrain without a Cesium Ion account.
// Decodes AWS "Terrain Tiles" (Mapzen Terrarium PNG encoding, Web Mercator XYZ)
// into Cesium heightmaps:  height = R·256 + G + B/256 − 32768  (metres).
// Bathymetry is clamped to sea level so oceans render as a flat water surface,
// which is the classic case for horizon-distance comparisons.
/* global Cesium */

const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const SRC_MAX_LEVEL = 13;     // deeper tiles are resampled from their level-13 ancestor
const GRID = 33;              // heightmap posts per tile edge sent to Cesium
const MAX_IN_FLIGHT = 10;     // throttle; returning undefined tells Cesium to retry later
const CACHE_LIMIT = 256;

export function createTerrariumTerrain({ exaggerateOcean = false } = {}) {
  const cache = new Map();    // "z/x/y" → Promise<Float32Array(256*256)>
  let inFlight = 0;
  let failures = 0;

  function loadSource(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (cache.has(key)) {
      const p = cache.get(key);
      cache.delete(key); cache.set(key, p); // LRU bump
      return p;
    }
    inFlight++;
    const url = TERRARIUM_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const p = fetch(url, { mode: 'cors' })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then((b) => createImageBitmap(b))
      .then((bmp) => {
        const c = new OffscreenCanvas(256, 256);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        const px = ctx.getImageData(0, 0, 256, 256).data;
        const out = new Float32Array(256 * 256);
        for (let i = 0, j = 0; i < out.length; i++, j += 4) {
          const h = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
          out[i] = exaggerateOcean ? h : Math.max(0, h);
        }
        return out;
      })
      .catch(() => { failures++; cache.delete(key); return null; })
      .finally(() => { inFlight--; });
    cache.set(key, p);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return p;
  }

  function sample(src, u, v) { // bilinear in pixel space, u,v ∈ [0,1]
    const fx = Math.min(255, Math.max(0, u * 256 - 0.5));
    const fy = Math.min(255, Math.max(0, v * 256 - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const a = src[y0 * 256 + x0], b = src[y0 * 256 + x1];
    const c = src[y1 * 256 + x0], d = src[y1 * 256 + x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  const flat = new Float32Array(GRID * GRID);

  const provider = new Cesium.CustomHeightmapTerrainProvider({
    width: GRID,
    height: GRID,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    credit: 'Terrain: AWS Terrain Tiles (Mapzen; SRTM, GMTED2010, ETOPO1 and others)',
    callback(x, y, level) {
      const dl = Math.max(0, level - SRC_MAX_LEVEL);
      const z = level - dl;
      const sx = x >> dl, sy = y >> dl;
      const key = `${z}/${sx}/${sy}`;
      if (!cache.has(key) && inFlight >= MAX_IN_FLIGHT) return undefined;
      const span = 1 << dl;
      const ox = x - sx * span, oy = y - sy * span;
      return loadSource(z, sx, sy).then((src) => {
        if (!src) return flat;
        const out = new Float32Array(GRID * GRID);
        for (let r = 0; r < GRID; r++) {
          const v = (oy + r / (GRID - 1)) / span;
          for (let c = 0; c < GRID; c++) {
            const u = (ox + c / (GRID - 1)) / span;
            out[r * GRID + c] = sample(src, u, v);
          }
        }
        return out;
      });
    },
  });

  provider.stats = () => ({ inFlight, cached: cache.size, failures });
  return provider;
}
