/* =============================================================================
 * physics.js — Realistic-feeling vehicle model (deliverable #1)
 * -----------------------------------------------------------------------------
 * This replaces the old "if (rotation == 90) move 6px" sprite rotation with a
 * proper kinematic BICYCLE MODEL integrated with delta time:
 *
 *   - The car has a heading and a scalar speed (momentum) — it keeps moving
 *     after you release the throttle and coasts down through drag + rolling
 *     resistance, giving real inertia.
 *   - Steering controls a front-wheel angle, not the body angle. The body only
 *     rotates when the car is actually moving (you can't pirouette while
 *     parked), and the rate of rotation is  omega = v/L * tan(steer).
 *   - Because the steering angle is capped and that cap SHRINKS with speed, the
 *     turning radius naturally widens at speed — fast sweeping corners, tight
 *     low-speed maneuvers. This is the "speed-dependent turning radius".
 *   - Reverse works because speed can go negative; the same omega formula then
 *     rotates the car the other way, exactly like backing up in a real car.
 *   - Surface ('road' | 'grass') changes traction: grass adds heavy drag, caps
 *     speed and reduces steering authority.
 * ========================================================================== */

// Neutral performance modifiers (a brand-new, undamaged car on fresh tyres).
const IDENTITY_MODS = {
  topSpeedMul: 1, accelMul: 1, gripMul: 1, brakeMul: 1, steerMul: 1,
};

class Car {
  constructor(stats) {
    this.setStats(stats);
    this.reset(0, 0, 0);
  }

  setStats(stats) {
    this.stats = stats;
    // Convert the car's km/h top speed into the internal px/s cap.
    this.maxSpeed = stats.topSpeed / CONFIG.speedKmhPerPx;
    this.maxReverse = CONFIG.maxReverseKmh / CONFIG.speedKmhPerPx;
  }

  reset(x, y, heading) {
    this.x = x;
    this.y = y;
    this.heading = heading; // radians, 0 = pointing up (north)
    this.speed = 0; // px/s along heading (negative = reverse)
    this.steer = 0; // current front-wheel angle (radians)
    this.engineOn = true; // false when out of fuel
    this.lateralG = 0; // |lateral acceleration| this frame (for tyre wear)
    this.slip = 0; // 0..1 how far past the grip budget we are (skid intensity)
  }

  // Unit forward vector for the current heading (screen coords: +y is down).
  forward() {
    return { x: Math.sin(this.heading), y: -Math.cos(this.heading) };
  }

  // Lateral grip budget (lateral accel the tyres can hold before sliding).
  static BASE_GRIP_ACCEL = 1700;

  /* dt, input:{throttle,brake,left,right,handbrake}, env:{surface,mods,speedLimitKmh,frozen}
   * surface: a SURFACES entry; mods: condition multipliers; speedLimitKmh: pit
   * limiter (or null); frozen: held stationary during a pit stop. */
  update(dt, input, env) {
    const surface = (env && env.surface) || SURFACES.road;
    const mods = (env && env.mods) || IDENTITY_MODS;

    // Pit hold: car is parked and serviced — freeze it, recentre the wheel.
    if (env && env.frozen) {
      this.speed = 0;
      this.steer = MathX.approach(this.steer, 0, CONFIG.steerReturn * dt);
      this.lateralG = 0; this.slip = 0;
      return;
    }

    // Effective grip blends the car, the surface, tyre wear & damage.
    const grip = this.stats.grip * surface.grip * mods.gripMul;

    /* --- Steering: ease the wheel toward the requested angle -------------- */
    const speedFrac = Math.min(1, Math.abs(this.speed) / this.maxSpeed);
    // Max usable lock shrinks as we speed up -> wider radius at speed.
    let maxSteer = MathX.lerp(CONFIG.maxSteerLow, CONFIG.maxSteerHigh, speedFrac) * grip * mods.steerMul;
    let steerInput = 0;
    if (input.left) steerInput -= 1;
    if (input.right) steerInput += 1;
    if (steerInput !== 0) {
      const target = steerInput * maxSteer;
      this.steer = MathX.approach(this.steer, target, CONFIG.steerRate * dt);
    } else {
      // No input: wheels self-centre.
      this.steer = MathX.approach(this.steer, 0, CONFIG.steerReturn * dt);
    }
    this.steer = MathX.clamp(this.steer, -maxSteer, maxSteer);

    /* --- Longitudinal forces --------------------------------------------- */
    let accel = 0;
    const hasFuel = this.engineOn;

    if (input.throttle && hasFuel) {
      accel += CONFIG.engineAccel * this.stats.accel * mods.accelMul * surface.accel / this.stats.mass;
    }
    if (input.brake) {
      if (this.speed > 8) {
        // friction brakes — scaled by the car's braking stat, damage & tyres
        accel -= CONFIG.brakeDecel * this.stats.braking * mods.brakeMul;
      } else if (hasFuel) {
        accel -= CONFIG.reverseAccel / this.stats.mass; // shift into reverse
      }
    }
    if (input.handbrake) {
      accel -= CONFIG.brakeDecel * 1.3 * Math.sign(this.speed || 1);
    }

    // Resistances always oppose motion.
    const v = this.speed;
    const drag = CONFIG.dragCoef * v * Math.abs(v);
    const roll = CONFIG.rollResist * v;
    accel -= drag + roll;
    // Engine braking when coasting (no throttle, no brake).
    if (!input.throttle && !input.brake) accel -= CONFIG.engineBrake * v;
    // Off-road surfaces add heavy rolling resistance.
    accel -= surface.drag * v;

    this.speed += accel * dt;

    /* --- Speed clamps ----------------------------------------------------- */
    let topFwd = this.maxSpeed * mods.topSpeedMul;
    if (surface.maxKmh != null) topFwd = Math.min(topFwd, surface.maxKmh / CONFIG.speedKmhPerPx);
    // Pit-lane speed limiter.
    if (env && env.speedLimitKmh != null) {
      topFwd = Math.min(topFwd, env.speedLimitKmh / CONFIG.speedKmhPerPx);
    }
    this.speed = MathX.clamp(this.speed, -this.maxReverse, topFwd);
    // Snap tiny speeds to zero so the car actually stops (no jitter).
    if (!input.throttle && Math.abs(this.speed) < 3) this.speed = 0;

    /* --- Heading: bicycle model. Body turns only while moving ------------- */
    let omega = 0;
    if (Math.abs(this.speed) > 1) {
      omega = (this.speed / CONFIG.wheelbase) * Math.tan(this.steer);
      this.heading += omega * dt;
    }
    // Keep heading in a sane range.
    if (this.heading > Math.PI) this.heading -= 2 * Math.PI;
    if (this.heading < -Math.PI) this.heading += 2 * Math.PI;

    /* --- Cornering load & slip (drives tyre wear and skid marks) ---------- */
    this.lateralG = Math.abs(this.speed * omega);
    const gripBudget = Car.BASE_GRIP_ACCEL * grip;
    this.slip = MathX.clamp(this.lateralG / gripBudget - 0.78, 0, 1);
    // Locking the brakes / handbrake also lays rubber.
    if (input.handbrake && Math.abs(this.speed) > 60) this.slip = Math.max(this.slip, 0.7);
    if (input.brake && this.speed > this.maxSpeed * 0.55) this.slip = Math.max(this.slip, 0.45);

    /* --- Integrate position ---------------------------------------------- */
    const f = this.forward();
    this.x += f.x * this.speed * dt;
    this.y += f.y * this.speed * dt;
  }

  // World positions of the rear tyres (for laying down skid marks).
  rearWheels() {
    const f = this.forward();
    const sx = f.y, sy = -f.x; // side vector (perpendicular to forward)
    const back = 0.34 * 92; // ~rear axle offset (CAR_LENGTH baked for both types)
    const halfTrack = 0.30 * 92;
    const bx = this.x - f.x * back, by = this.y - f.y * back;
    return [
      { x: bx + sx * halfTrack, y: by + sy * halfTrack },
      { x: bx - sx * halfTrack, y: by - sy * halfTrack },
    ];
  }

  // Hit the world boundary: clamp inside and bleed off speed (a soft wall).
  clampToBounds(bounds, radius) {
    let hit = false;
    if (this.x < bounds.minX + radius) { this.x = bounds.minX + radius; hit = true; }
    if (this.x > bounds.maxX - radius) { this.x = bounds.maxX - radius; hit = true; }
    if (this.y < bounds.minY + radius) { this.y = bounds.minY + radius; hit = true; }
    if (this.y > bounds.maxY - radius) { this.y = bounds.maxY - radius; hit = true; }
    if (hit) this.speed *= -CONFIG.wallRestitution;
    return hit;
  }

  get speedKmh() { return MathX.kmh(this.speed); }

  // Gear label for the dashboard.
  get gear() {
    if (this.speed < -2) return 'R';
    if (this.speed > 2) return 'D';
    return 'N';
  }
}
