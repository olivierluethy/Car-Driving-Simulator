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
};

/* -----------------------------------------------------------------------------
 * Per-car stats. Sprites point "up" (north) at heading 0, matching the existing
 * car{N}.png art. `accel` and `grip` are multipliers around 1.0.
 *   topSpeed — km/h, becomes the hard speed cap
 *   accel    — engine power multiplier
 *   grip     — steering authority & cornering traction multiplier
 *   mass     — affects how sluggishly the car responds (feel only)
 * -------------------------------------------------------------------------- */
const CAR_DATA = [
  { id: 1, name: 'BMW',         sprite: 'images/cars/car1.png', topSpeed: 250, accel: 1.00, grip: 1.00, mass: 1.00, color: '#60a5fa' },
  { id: 2, name: 'Ferrari',     sprite: 'images/cars/car2.png', topSpeed: 305, accel: 1.28, grip: 1.06, mass: 0.92, color: '#ef4444' },
  { id: 3, name: 'Bugatti',     sprite: 'images/cars/car3.png', topSpeed: 330, accel: 1.36, grip: 1.00, mass: 1.05, color: '#3b82f6' },
  { id: 4, name: 'Sport Car',   sprite: 'images/cars/car4.png', topSpeed: 240, accel: 1.06, grip: 1.02, mass: 0.96, color: '#f59e0b' },
  { id: 5, name: 'Furry Car',   sprite: 'images/cars/car5.png', topSpeed: 200, accel: 0.86, grip: 0.96, mass: 1.10, color: '#a855f7' },
  { id: 6, name: 'Lamborghini', sprite: 'images/cars/car6.png', topSpeed: 312, accel: 1.30, grip: 1.06, mass: 0.94, color: '#eab308' },
  { id: 7, name: 'Dragon Car',  sprite: 'images/cars/car7.png', topSpeed: 280, accel: 1.16, grip: 0.94, mass: 1.02, color: '#22c55e' },
  { id: 8, name: 'White',       sprite: 'images/cars/car8.png', topSpeed: 230, accel: 0.96, grip: 1.00, mass: 1.00, color: '#e5e7eb' },
  { id: 9, name: "I'm Blue",    sprite: 'images/cars/car9.png', topSpeed: 262, accel: 1.10, grip: 1.00, mass: 0.98, color: '#06b6d4' },
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
