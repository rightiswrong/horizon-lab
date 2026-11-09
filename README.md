# Horizon Flight Simulator

A browser flight sim about one question: **how far away is the horizon from a given height?**

You fly over a full-size WGS84 globe with real satellite imagery and real terrain. A glowing ring on the globe marks the geometric horizon, worked out from your altitude. On the HUD, a dashed **eye level** line (0°) sits above a solid **true horizon** line, and the gap between them is the horizon dip. The Horizon lab panel shows the numbers, a cross-section diagram and a log-log chart of distance against height.


## Play

- **Locally:** `python3 -m http.server 8080` in this folder, then open http://localhost:8080. Opening `index.html` straight from disk won't work, because browsers block web workers on `file://`.
- **GitHub Pages:** push this folder to a repo, then go to **Settings → Pages → Deploy from a branch → `main` / `(root)`**. Your sim will be at `https://<user>.github.io/<repo>/`. The `.nojekyll` file is already included.

There is no build step, no npm install and no API key.

| Input | Keyboard | Touch |
|---|---|---|
| Pitch | W/S or ↑/↓ (S = nose up, invertible) | Stick up/down |
| Roll / turn | A/D or ←/→ | Stick left/right |
| Yaw | Q/E | — |
| Throttle | Shift / Ctrl (or R / F) | THR slider |
| Altitude presets | 1–9 (1.7 m → 2,000 km) | Horizon lab chips |
| View: cockpit / chase / orbit | C | View button |
| Altitude hold | H | Hold button |
| Time warp 1/5/25/100× | T | Settings |
| Pause / panel | P / M | Horizon lab button |
| Ride along with a live flight | Horizon lab → Live flight | same |

The **Quick previews** let you jump between altitudes (standing on a beach, airliner, U-2, the Kármán line, the ISS) and between locations (open Pacific, Swiss Alps, Grand Canyon, Everest, Gibraltar and more).

## Ride along with a real flight (Flightradar24)

In the **Horizon lab → Live flight** panel you can pick a real aircraft. The sim then puts your eye in its cockpit: the ring, HUD lines, cross-section and numbers all show the horizon from that flight, live.

1. Get a key at **https://fr24api.flightradar24.com** (key management page). The free **sandbox key** returns static sample data at no cost. Tick "Sandbox key" if you use it.
2. Paste the key, then either search by **flight number**, **callsign** or **registration**, or tap **Flights near me** (a 300 km box around your position).
3. Tap a result, or click a red traffic marker on the globe. **Take the controls** hands the aircraft over to you mid-flight. **Demo traffic** shows the feature with simulated aircraft and no key.

### Route, flown path and ATC audio
Three options in the Live flight panel (remembered per device):

| Option | What you get | API cost |
|---|---|---|
| **Airports & route** | FROM/TO airport markers with live distance labels (marked *below horizon* until they could actually be seen), the planned great circle, and the remaining leg from the aircraft to the destination (dashed, with a ~3° descent at the end). The panel shows the distance flown and to go, the ETA, and how far past the horizon the destination still is. | None: coordinates come from the bundled OurAirports table (`data/airports.json`, ~5,800 airports, public domain). FR24's `/static/airports/{code}/full` is used only for codes not in the table. |
| **Flown path** | The actual track so far at true altitude (orange), from `GET /api/flight-tracks?flight_id=…`, extended with each live update. | One flight-tracks call per flight you follow (FR24 charges per point returned) |
| **ATC audio links** | Buttons for the **departure**, **nearest** and **arrival** airports that open that airport's page on [LiveATC.net](https://www.liveatc.net/), where you can listen in their player. | None |

About the audio: LiveATC.net's terms only allow personal, non-commercial listening, require permission before linking directly to audio streams, and prohibit third-party use of the streams. So this app doesn't embed, proxy or deep-link audio. It links to LiveATC's own pages, credited to them. Not every airport has a feed. Oceanic and en-route coverage is patchy, so the "nearest" link may have no feed mid-ocean.

To rebuild the airport table from a fresh OurAirports `airports.csv`: `python3 -I scripts/build_airports.py airports.csv data/airports.json`.

How it works (`js/fr24.js`):
- Search uses `GET /api/live/flight-positions/full` (type, route). Polling the followed flight uses the cheaper `/light` variant, every 10, 20 (default) or 60 s. Polling pauses in background tabs and backs off after errors.
- FR24 units are converted to SI: `alt` ft → m, `gspeed` kt → m/s, `vspeed` fpm → m/s, `track` ° → rad.
- Between updates the aircraft is dead-reckoned with constant ground speed, vertical speed and turn rate. Each new fix is blended in over about 1.5 s, so the view never jumps. Pitch is estimated as atan(V/S ÷ GS). Bank comes from the coordinated-turn relation tan φ = v·ω/g, with ω measured from successive tracks.
- FR24 `alt` is **pressure altitude** (standard 1013.25 hPa), not true height. It can be off by a few hundred feet from the real geometric height, which moves the horizon by under 1%. Because the tracking is ADS-B/MLAT, it is also a few seconds behind real time.

### Your API key and the browser
- The key is kept in memory only, unless you tick **Remember on this device** (localStorage). It is sent only to Flightradar24, or to your own proxy if you set one. Never commit a key to the repo.
- Flightradar24 doesn't document whether its API accepts calls made directly from a web page (CORS). If the app says *"The browser blocked the request"*, deploy the proxy below.

### Optional proxy (Cloudflare Worker, free tier)
`worker/fr24-proxy.js` adds CORS headers and only forwards the read-only live-position endpoints. It can also hold your key as a secret, so visitors to your Pages site don't need one.
```bash
npm i -g wrangler
cd worker
# edit wrangler.toml → ALLOWED_ORIGINS = "https://<you>.github.io"
wrangler deploy
wrangler secret put FR24_API_KEY     # optional: server-side key
```
Paste the Worker URL into **Live flight → Advanced → Proxy URL**. If you store the key as a secret, keep `ALLOWED_ORIGINS` tight, because every visitor's polling spends your credits.

Flightradar24 data is subject to [their API terms](https://fr24api.flightradar24.com). Respect the plan's usage limits and don't redistribute raw data.

## The math

For an observer at height *h* above a sphere of radius *R*, the sight line to the horizon just touches the surface. A tangent is perpendicular to the radius at the touching point, so centre O, eye P and horizon point H form a right triangle with hypotenuse *R + h*:

```
d² + R² = (R + h)²   ⇒   d = √(2Rh + h²) ≈ √(2Rh)        (line-of-sight distance)
cos θ = R / (R + h)  ⇒   s = R·θ                          (distance along the ground)
dip = θ                                                   (horizon angle below eye level)
visible fraction of the sphere = (1 − cos θ)/2 = h / (2(R + h))
```

With R = 6,371 km and *h* in metres, **d ≈ 3.57 √h km**. Atmospheric refraction bends light around the bulge. That has the same effect as a larger effective radius R′ = R/(1 − k), with k ≈ 0.13, which gives **d ≈ 3.86 √h km**. Two objects can see each other out to √(2Rh₁) + √(2Rh₂).

| Height | d (geometric) | Dip |
|---|---|---|
| 1.7 m (eye) | 4.7 km | 0.04° |
| 100 m | 35.7 km | 0.32° |
| 11 km (airliner) | 375 km | 3.4° |
| 100 km (Kármán line) | 1,133 km | 10.1° |
| 408 km (ISS) | 2,316 km | 20.0° |

All of this is in `js/horizon.js`, with no engine dependencies, and is unit-tested. The table uses the mean radius R = 6,371 km, while the in-game readouts use the local WGS84 radius, so they can differ by about 0.2% (`npm test`, Node 18+). The ring uses the WGS84 Gaussian mean radius at your latitude, so it sits on the horizon the engine actually renders. The 3D view is drawn without refraction, so the ring and HUD use the geometric value. The panel also shows the refracted value.

## Tech

| Layer | Choice | Why |
|---|---|---|
| Engine | **CesiumJS 1.147** (Apache-2.0), vendored in `vendor/cesium` (~14 MB) | A true-to-scale ellipsoidal globe with streaming level of detail, atmosphere and terrain. Unreal 5 has no web export, and a Unity WebGL build would need the Editor. Cesium also exists as *Cesium for Unreal/Unity*, so the data stack ports directly. |
| Imagery | **EOX Sentinel-2 cloudless** (2020: CC BY-NC-SA 4.0; 2016: CC BY 4.0), or **OpenStreetMap** | Free, global, satellite-like imagery with no key. Falls back to OSM automatically if EOX is unreachable. |
| Terrain | **AWS Terrain Tiles** (Mapzen Terrarium PNG), decoded in `js/terrain.js` | Open global elevation without Cesium Ion. Bathymetry is clamped to sea level so oceans give a clean horizon. |
| Flight model | Arcade, coordinated turns (turn rate = g·tanφ / v), energy trade in climbs and dives | Easy to fly. The point is the horizon, not stall modelling. |

Repo size is about 15 MB, far below GitHub's limits.

### Project layout
```
index.html          page shell, HUD and panel markup
css/style.css       UI (desktop and mobile layouts)
js/main.js          viewer, flight model, cameras, HUD, instruments, input
js/horizon.js       horizon math (pure, tested)
js/terrain.js       Terrarium → Cesium heightmap provider
js/fr24.js          Flightradar24 client, unit conversion, dead reckoning, demo traffic
js/airports.js      airport lookup, great circles, LiveATC links
data/airports.json  OurAirports subset (public domain)
scripts/            build_airports.py (regenerates data/airports.json)
worker/             optional CORS proxy (Cloudflare Worker) for the FR24 API
tests/              node:test unit tests
vendor/cesium/      CesiumJS build (Apache-2.0)
```

## Attribution and licences

- Code: MIT (see `LICENSE`). CesiumJS: Apache-2.0 (`vendor/cesium/LICENSE.md`).
- Sentinel-2 cloudless — https://s2maps.eu by EOX IT Services GmbH (contains modified Copernicus Sentinel data). The 2020 layer is **non-commercial** (CC BY-NC-SA 4.0). For commercial use, switch the default to the 2016 layer (CC BY 4.0) or to OSM.
- © OpenStreetMap contributors. Keep traffic light, as the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) asks.
- Airports: [OurAirports](https://ourairports.com/data/), public domain.
- ATC audio: links to [LiveATC.net](https://www.liveatc.net/) pages only. Their streams are not embedded or redistributed.
- Terrain Tiles on AWS Open Data (Mapzen). Sources include SRTM, GMTED2010, ETOPO1 and others.
