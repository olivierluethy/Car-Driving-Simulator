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

Use **TRACKS** / **GARAGE** in the top bar to switch track or car. The garage
includes four **Formula 1-style cars** (procedurally drawn — no licensed art),
each a distinct strategic archetype: Balanced, High Speed, Cornering, Fuel Saver.

### Racing strategy (F1 systems)
- **Surfaces matter.** Kerbs, grass, **gravel** and **sand** run-off traps each
  cut grip/speed differently and throw surface-coloured dust & debris.
- **Tyres wear** from hard cornering, speed, braking and off-track running —
  losing grip and braking as they go.
- **Damage** builds from running through traps, overdriving past the grip limit,
  wall impacts, and running the tank dry. It saps top speed, accel, grip,
  braking and steering.
- **Pit when the HUD says so.** Drive into the **pit box** (the cyan/amber `P`
  on the inside of the start straight); the speed limiter engages automatically
  and the crew changes tyres, refuels and repairs. **One scheduled stop** is
  allowed — a second is only permitted with *severe* damage.

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

---

## Formula 1 expansion — technical decisions

The F1 layer was added without disturbing the core loop, by introducing small
single-responsibility modules that communicate through plain data.

### 7. Surfaces as data, not pixels (`SURFACES` + `tracks.surfaceAt`)
Rather than colour-sampling an image, each track bakes **gravel/sand run-off
traps** onto the outside of its sharpest corners (found via centreline
curvature) and the start straight gets a **pit lane**. A single `surfaceAt()`
banded test returns `road → kerb → grass → gravel → sand`, and one `SURFACES`
table is the source of truth for how every surface *drives* (grip, accel, drag,
speed cap) and *looks* (particle kind/colour). Add a surface in one place and
the physics, wear, damage and effects all pick it up.

### 8. Condition is decoupled from physics (`js/condition.js`)
`CarCondition` consumes telemetry (lateral-g, braking, surface, impacts, fuel)
and accumulates **tyre wear** and **damage** (0–100). It outputs a set of
**multipliers** (`topSpeedMul`, `gripMul`, `accelMul`, `brakeMul`, `steerMul`)
that `Car.update()` simply applies. This separation means consequences can be
re-tuned without ever touching the vehicle model, and a worn/damaged car
genuinely drives worse. Severity thresholds drive the HUD and pit logic.

### 9. Pit stop as a state machine (`js/pit.js`)
`idle → limiter → servicing → released`. Entering the pit-lane zone auto-engages
the **speed limiter** (the physics caps speed); stopping in the box starts a
**timed service** that interpolates fuel/repair so the gauges visibly recover,
swaps tyres partway, and animates a **4-corner crew** (jacks, wheel guns, refuel
rig) in world space. The **one-scheduled-stop restriction** lives here: a second
stop is refused unless damage is severe.

### 10. Effects are bounded by construction (`js/effects.js`)
Two subsystems sized for performance (deliverable #13):
- **Skid marks** — a flat list of short fading segments laid under the rear
  tyres along the *exact* path while sliding/braking. **View-culled** and
  **hard-capped (1400)**, so cost never grows with track size or session length.
  (We deliberately avoid a world-sized offscreen canvas, which would blow up
  memory on big tracks.)
- **Particles** — a fixed **object pool (260)**: emitting reuses dead slots and
  never allocates. Dust clouds and debris are surface-coloured and scale their
  count/velocity with speed — "faster = more dramatic" without exceeding the cap.

### 11. F1 cars are drawn, not imported (`js/f1.js`)
The open-wheel cars are generated on canvas from a 3-colour livery — **zero
licensed assets**, razor-sharp at any zoom, and trivial to extend. The same
`F1.draw()` renders both the in-world car and the garage thumbnail.

### 12. Pit lane on the main straight (real-circuit redesign)
The first pit implementation dropped a floating rectangle beside `centre[0]` —
an arbitrary sample that often landed mid-corner, offset across a strip of grass.
That produced every problem real circuits avoid: exiting into a corner, instant
off-track, even needing to reverse. The redesign follows motorsport practice:

- **Find the main straight.** `findMainStraight()` slides a window around the
  lap and picks the arc with the **least total curvature** — the longest, fastest
  straight. The **start/finish line and pit lane are placed there**, and the
  track control points were revised so every layout has a clear straight.
  (Validated: the chosen straight is 6–13× straighter than the lap average.)
- **A real tapered lane.** The pit lane is an **offset polyline parallel to the
  straight**. Its centreline starts *on* the racing line (offset 0), eases out to
  full offset with a `smoothstep` **entry taper**, runs parallel past the boxes,
  then eases back onto the racing line with an **exit taper** that completes
  *before* the corner — leaving room to accelerate. Because the tapers reach the
  racing line, the lane is **continuous tarmac** (no grass to cross), and there
  are **no sharp turns**. A **median + pit wall** separates the parallel section
  from the track, just like F1.
- **Limiter only where it should be.** Only the parallel "active" middle counts
  as the pit zone, so staying on the racing line never trips the limiter; the
  tapers are still tarmac so branching in/out is smooth.
- **Atmosphere on the straight.** Team garages behind the boxes, a striped pit
  wall, grandstands full of spectators opposite, trackside floodlights and a
  start/finish gantry make the straight the hub of the circuit.

The pit side (left/right) is auto-chosen per track based on which side has more
open space.

## Project structure
```
index.html        Markup + Tailwind config + HUD + pit overlay
js/config.js      Physics constants, SURFACES table, tyre/damage/pit tuning, cars
js/tracks.js      Catmull-Rom vector tracks, hazards, pit lane, surfaceAt()
js/physics.js     Bicycle-model Car (surfaces, condition mods, limiter)
js/effects.js     Pooled particles + view-culled fading tyre marks
js/condition.js   Tyre-wear & damage model -> performance modifiers
js/pit.js         Pit-lane state machine, restrictions, crew animation
js/f1.js          Procedural F1 car renderer + garage thumbnails
js/timing.js      Lap/sector timing + localStorage records
js/ui.js          Track/garage selector overlays
js/game.js        Main loop, camera, canvas rendering, input, HUD
images/           Car sprites + favicon
```
