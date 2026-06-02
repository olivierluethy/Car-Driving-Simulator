/* =============================================================================
 * config.js — Tunable constants & per-car stats
 * -----------------------------------------------------------------------------
 * All physics is computed in world-pixels and seconds. Display values (km/h,
 * km, litres) are derived from these via the conversion factors below so that
 * the simulation stays numerically stable regardless of how we choose to label
 * the numbers for the player.
 * ========================================================================== */

const CONFIG = {
  /* ---- Display conversions ------------------------------------------------ */
  // Internal speed is px/s. Multiply by this to show km/h on the dashboard.
  speedKmhPerPx: 0.34,
  // Internal distance is px. Divide by this to convert to "metres".
  worldPxPerMetre: 9,

  /* ---- Camera ------------------------------------------------------------- */
  zoom: 0.92, // how zoomed-in the chase camera is (1 = world px == screen px)
  cameraLerp: 6, // how quickly the camera catches up to the car (higher = tighter)

  /* ---- Longitudinal physics (forces are px/s^2) --------------------------- */
  engineAccel: 360, // base forward acceleration, scaled per-car
  brakeDecel: 900, // deceleration while braking and still moving forward
  reverseAccel: 200, // acceleration into reverse once stopped
  maxReverseKmh: 45, // reverse speed cap
  dragCoef: 0.0009, // aerodynamic drag (~v^2). Shapes the top-speed curve.
  rollResist: 0.7, // rolling resistance (~v). Why you coast to a stop.
  engineBrake: 0.6, // extra deceleration when off throttle (engine braking ~v)

  /* ---- Steering (bicycle model) ------------------------------------------ */
  wheelbase: 46, // distance between axles (world px). Sets turning radius.
  maxSteerLow: 0.62, // max steering angle (rad ~36deg) at a crawl
  maxSteerHigh: 0.14, // max steering angle (rad ~8deg) at top speed
  steerRate: 3.4, // how fast the wheels turn toward the target angle (rad/s)
  steerReturn: 5.0, // how fast the wheels self-centre when no input (rad/s)

  /* ---- Surfaces ----------------------------------------------------------- */
  grassDrag: 2.6, // heavy rolling resistance on grass (~v) — kills momentum
  grassMaxKmh: 70, // you simply cannot go fast through grass
  grassGrip: 0.55, // steering authority multiplier off-road (twitchy/sloppy)
  wallRestitution: 0.25, // how much speed is kept when you hit the world wall

  /* ---- Fuel --------------------------------------------------------------- */
  tankLitres: 55,
  idleBurn: 0.00035, // litres/sec just for the engine running
  throttleBurn: 0.9, // litres burned scaled by throttle * speed fraction

  /* ---- Tyres (deliverable #7) -------------------------------------------- */
  tyre: {
    // Wear (0 = fresh, 100 = gone) accumulates from the loads below, each
    // scaled by dt so it's frame-rate independent. Numbers are %/sec at the
    // reference load, deliberately brisk so a strategy actually emerges.
    corneringWear: 9.0, // per unit of lateral-g over the grip budget
    speedWear: 1.4, // per speed-fraction while driving
    brakeWear: 6.0, // while hard braking at speed
    // Grip falls off as the tyre wears: grip *= 1 - gripLossAtFull*(wear/100)
    gripLossAtFull: 0.42,
    wornThreshold: 80, // tyres "excessively worn" -> pit recommended
  },

  /* ---- Damage (deliverables #2 & #3) ------------------------------------- */
  damage: {
    minor: 25, medium: 55, severe: 82, // level thresholds (%)
    mandatoryPit: 82, // at/above this a pit stop is mandatory
    impactScale: 0.10, // damage per km/h of wall/impact speed
    overdriveScale: 4.0, // damage/sec when cornering past the grip limit
    lowFuelStress: 6.0, // damage/sec when running the engine almost dry
    lowFuelPct: 4, // "almost dry" threshold (%)
    // Performance loss at 100% damage (interpolated by damage fraction):
    topSpeedLoss: 0.18, gripLoss: 0.30, accelLoss: 0.26,
    brakeLoss: 0.30, steerLoss: 0.34,
  },

  /* ---- Pit stop (deliverables #4-6) -------------------------------------- */
  pit: {
    speedLimitKmh: 80, // pit-lane speed limiter
    boxStopKmh: 6, // must be slower than this in the box to be serviced
    baseService: 1.0, // fixed crew time (s)
    tyreTime: 2.6, // time to change tyres (s)
    refuelPerLitre: 0.06, // time to add one litre (s)
    repairPerPct: 0.025, // time to repair one % of damage (s)
    // --- Lane geometry (the pit lane runs PARALLEL to the main straight) ---
    laneWidth: 130, // pit-lane width (world px)
    median: 60, // grass/wall gap between the track edge and the pit lane
    garageDepth: 95, // depth of the team garages behind the boxes
    straightFrac: 0.16, // main straight = this fraction of the lap (sliding window)
    sfOffsetFrac: 0.30, // start/finish sits this far along the straight
  },
};

/* -----------------------------------------------------------------------------
 * SURFACE table — the single source of truth for how each surface drives and
 * looks. game.js resolves a surface type from track geometry and hands the
 * matching entry to the physics + effects, so behaviour scales to any track.
 *   grip    — cornering/steering traction multiplier
 *   accel   — engine power multiplier (drive struggles off-tarmac)
 *   drag    — extra rolling resistance (~v) that bleeds momentum
 *   maxKmh  — hard speed cap on this surface (null = none)
 *   wear    — tyre-wear multiplier
 *   damage  — chassis damage rate (damage/sec) while on this surface at speed
 *   particle— debris kind emitted (null = none)
 * -------------------------------------------------------------------------- */
const SURFACES = {
  road:   { grip: 1.00, accel: 1.00, drag: 0.0, maxKmh: null, wear: 1.0,  damage: 0.0, particle: null,     color: null },
  kerb:   { grip: 0.92, accel: 0.98, drag: 0.4, maxKmh: null, wear: 1.7,  damage: 0.5, particle: null,     color: '#d1402f' },
  grass:  { grip: 0.60, accel: 0.80, drag: 2.6, maxKmh: 70,   wear: 2.0,  damage: 1.0, particle: 'grass',  color: '#3f7d3a' },
  gravel: { grip: 0.50, accel: 0.64, drag: 3.6, maxKmh: 55,   wear: 3.4,  damage: 3.2, particle: 'gravel', color: '#8a7b5c' },
  sand:   { grip: 0.42, accel: 0.50, drag: 4.6, maxKmh: 42,   wear: 4.0,  damage: 4.6, particle: 'sand',   color: '#c9b070' },
  // Open water (lakes/river off the bridge deck): you bog down — not drivable.
  water:  { grip: 0.30, accel: 0.28, drag: 5.6, maxKmh: 28,   wear: 1.0,  damage: 2.0, particle: null,     color: '#0f3a54' },
};

/* -----------------------------------------------------------------------------
 * Per-car stats. Sprites point "up" (north) at heading 0, matching the existing
 * car{N}.png art. Multipliers sit around 1.0.
 *   topSpeed — km/h, becomes the hard speed cap
 *   accel    — engine power multiplier
 *   grip     — steering authority & cornering traction multiplier
 *   braking  — brake-force multiplier (bigger = shorter stops)
 *   tyre     — tyre-wear multiplier (bigger = wears faster)
 *   fuelUse  — fuel-consumption multiplier (smaller = more efficient)
 *   mass     — affects how sluggishly the car responds (feel only)
 *   type     — 'sprite' (PNG art) or 'f1' (procedurally drawn open-wheeler)
 * -------------------------------------------------------------------------- */
const CAR_DATA = [
  // --- Road / arcade cars (PNG sprites) ---
  { id: 1, name: 'BMW',         type: 'sprite', sprite: 'images/cars/car1.png', topSpeed: 250, accel: 1.00, grip: 1.00, braking: 1.00, tyre: 1.00, fuelUse: 1.00, mass: 1.00, color: '#60a5fa' },
  { id: 2, name: 'Ferrari',     type: 'sprite', sprite: 'images/cars/car2.png', topSpeed: 305, accel: 1.28, grip: 1.06, braking: 1.10, tyre: 1.10, fuelUse: 1.10, mass: 0.92, color: '#ef4444' },
  { id: 3, name: 'Bugatti',     type: 'sprite', sprite: 'images/cars/car3.png', topSpeed: 330, accel: 1.36, grip: 1.00, braking: 1.05, tyre: 1.15, fuelUse: 1.20, mass: 1.05, color: '#3b82f6' },
  { id: 4, name: 'Sport Car',   type: 'sprite', sprite: 'images/cars/car4.png', topSpeed: 240, accel: 1.06, grip: 1.02, braking: 1.05, tyre: 0.95, fuelUse: 0.95, mass: 0.96, color: '#f59e0b' },
  { id: 5, name: 'Furry Car',   type: 'sprite', sprite: 'images/cars/car5.png', topSpeed: 200, accel: 0.86, grip: 0.96, braking: 0.95, tyre: 0.90, fuelUse: 0.85, mass: 1.10, color: '#a855f7' },
  { id: 6, name: 'Lamborghini', type: 'sprite', sprite: 'images/cars/car6.png', topSpeed: 312, accel: 1.30, grip: 1.06, braking: 1.12, tyre: 1.12, fuelUse: 1.15, mass: 0.94, color: '#eab308' },
  { id: 7, name: 'Dragon Car',  type: 'sprite', sprite: 'images/cars/car7.png', topSpeed: 280, accel: 1.16, grip: 0.94, braking: 1.00, tyre: 1.05, fuelUse: 1.05, mass: 1.02, color: '#22c55e' },
  { id: 8, name: 'White',       type: 'sprite', sprite: 'images/cars/car8.png', topSpeed: 230, accel: 0.96, grip: 1.00, braking: 1.00, tyre: 0.95, fuelUse: 0.95, mass: 1.00, color: '#e5e7eb' },
  { id: 9, name: "I'm Blue",    type: 'sprite', sprite: 'images/cars/car9.png', topSpeed: 262, accel: 1.10, grip: 1.00, braking: 1.05, tyre: 1.00, fuelUse: 1.00, mass: 0.98, color: '#06b6d4' },

  // --- Formula 1-inspired cars (procedurally drawn, no licensed assets) ---
  // Each one is a distinct strategic archetype.
  { id: 10, name: 'Apex GP-01', class: 'F1 · Balanced',  type: 'f1',
    topSpeed: 322, accel: 1.30, grip: 1.12, braking: 1.28, tyre: 1.00, fuelUse: 1.00, mass: 0.82,
    color: '#e11d2a', livery: { body: '#c9ccd2', accent: '#e11d2a', wing: '#1b1e26' } },
  { id: 11, name: 'Velocity V12', class: 'F1 · High Speed', type: 'f1',
    topSpeed: 352, accel: 1.36, grip: 0.98, braking: 1.10, tyre: 1.28, fuelUse: 1.22, mass: 0.86,
    color: '#22d3ee', livery: { body: '#15356e', accent: '#22d3ee', wing: '#0b1220' } },
  { id: 12, name: 'Vortex VX', class: 'F1 · Cornering',   type: 'f1',
    topSpeed: 306, accel: 1.26, grip: 1.24, braking: 1.38, tyre: 1.32, fuelUse: 1.08, mass: 0.80,
    color: '#a855f7', livery: { body: '#5b21b6', accent: '#f59e0b', wing: '#160a2b' } },
  { id: 13, name: 'Eco Spec E', class: 'F1 · Fuel Saver', type: 'f1',
    topSpeed: 300, accel: 1.18, grip: 1.06, braking: 1.22, tyre: 0.84, fuelUse: 0.68, mass: 0.88,
    color: '#22c55e', livery: { body: '#065f46', accent: '#22c55e', wing: '#0a1f17' } },
];

/* ---- Small shared math helpers --------------------------------------------*/
const MathX = {
  clamp: (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v),
  lerp: (a, b, t) => a + (b - a) * t,
  // Move `cur` toward `target` by at most `step`.
  approach: (cur, target, step) => {
    if (cur < target) return Math.min(cur + step, target);
    if (cur > target) return Math.max(cur - step, target);
    return cur;
  },
  // px/s -> km/h
  kmh: (pxPerSec) => Math.abs(pxPerSec) * CONFIG.speedKmhPerPx,
};
