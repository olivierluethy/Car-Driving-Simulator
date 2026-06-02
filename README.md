# Apex — Car Driving Simulator

A browser-based, top-down driving simulator with realistic vehicle physics,
vector tracks, full telemetry, and a racing-style lap/sector timing system.

Originally developed by Olivier Lüthy (tracks 1, 2 & 4 designed by Alexander
Denti). This version is a ground-up rebuild of the physics, rendering, and UI.

## How to play

Open `index.html` in a browser (or serve the folder, e.g. `python3 -m http.server`).

| Key            | Action                    |
| -------------- | ------------------------- |
| `↑` / `W`      | Throttle                  |
| `↓` / `S`      | Brake, then reverse       |
| `←` `→` / `A` `D` | Steer                  |
| `Space`        | Handbrake                 |
| `R`            | Restart current run       |

Use **TRACKS** / **GARAGE** in the top bar to switch track or car.

---

## Architecture & technical decisions

The original version rendered the car as a DOM `<img>` rotated with CSS and
moved it with a `setInterval` that hard-coded pixel offsets for ~8 fixed angles.
Tracks were flat PNGs. That made realistic motion, collisions, and timing
impossible. This rebuild replaces all of it.

### 1. Vehicle physics — kinematic bicycle model (`js/physics.js`)
The car has a **heading** and a **scalar speed** integrated with **delta time**
in a `requestAnimationFrame` loop:
- **Momentum / inertia** — speed persists; the car coasts down through
  aerodynamic drag (`~v²`) and rolling resistance (`~v`).
- **Front-wheel steering** — steering controls a *wheel angle*, not the body
  angle. The body rotates only while moving, at `ω = v / wheelbase · tan(δ)`,
  so you can't pirouette while parked.
- **Steering limits + speed-dependent radius** — the max steering lock shrinks
  with speed (≈36° at a crawl → ≈8° at top speed), so the turning radius widens
  naturally at speed (~64px tight → ~326px sweeping).
- **Reverse** — speed goes negative; the same `ω` formula rotates the car the
  other way, exactly like backing up.
- **Friction / traction** — surface (`road`/`grass`) changes grip: grass adds
  heavy drag, caps speed, and reduces steering authority.

### 2. Tracks — coordinate-based, not images (`js/tracks.js`)  ← deliverable #7
**Decision: Option B (vector tracks).** Each track is a handful of control
points + a road width. A **closed Catmull-Rom spline** produces a smooth
centreline sampled into hundreds of small segments. From that single source of
geometry we derive *everything*:
- **Rendering** — stroke the polyline with `lineWidth = road width`.
- **Collision / off-road** — distance from the car to the centreline.
- **Checkpoints & finish line** — perpendicular gates at chosen arc positions.
- **Playable boundary** — bounding box of the centreline + margin.

Image tracks can't do any of this without fragile per-pixel colour sampling.
Vector tracks are also tiny, scalable, and trivial to author or generate — they
win on performance, maintainability, checkpoints, collisions, and scalability.

### 3. Boundaries (deliverable #2)
Two layers keep the player in the world: a **chase camera** that always centres
the car (you can never lose it), grass that bleeds off momentum if you leave the
road, and a **hard world boundary** (`clampToBounds`) that stops the car at the
edge of the playable area with a soft bounce.

### 4. Timing & sectors (`js/timing.js`)  ← deliverables #4–6
Checkpoint crossings are detected by **segment intersection** of the car's
per-frame movement vector against each gate (robust at high speed). Gates must
be crossed **in order** (no course-cutting). Sector times are compared live
against your personal-best lap's splits to show the F1/rally-style `+0.8 / -1.3`
delta. **Best times persist in `localStorage`** (`cds_best_v1_<trackId>`).

### 5. Dashboard / HUD (deliverable #3)
A live canvas **speedometer gauge** plus real-time telemetry: speed (km/h),
gear (D/N/R), fuel % + bar, fuel-based range estimate, distance, session time,
average speed, and top speed.

### 6. UI — Tailwind CSS, dark mode (deliverables #8–9)
All custom SCSS/CSS was removed. The UI is rebuilt with **Tailwind**
(dark-mode only), Orbitron/Rajdhani racing typography, frosted-glass HUD panels,
and animated track/car selectors.

> **Tailwind via Play CDN:** used here for a zero-build static project. For
> production, replace the CDN `<script>` with a compiled Tailwind build
> (`npx tailwindcss -o dist.css --minify`) to drop the runtime dependency.

## Project structure
```
index.html        Markup + Tailwind config + HUD
js/config.js      Physics constants + per-car stats
js/tracks.js      Catmull-Rom vector tracks, geometry, checkpoints
js/physics.js     Bicycle-model Car class
js/timing.js      Lap/sector timing + localStorage records
js/ui.js          Track/garage selector overlays
js/game.js        Main loop, camera, canvas rendering, input, HUD
images/           Car sprites + track thumbnails
```
