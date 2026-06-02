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
  }

  // Unit forward vector for the current heading (screen coords: +y is down).
  forward() {
    return { x: Math.sin(this.heading), y: -Math.cos(this.heading) };
  }

  /* dt: seconds, input: {throttle,brake,left,right,handbrake}, surface string */
  update(dt, input, surface) {
    const onGrass = surface === 'grass';
    const grip = this.stats.grip * (onGrass ? CONFIG.grassGrip : 1);

    /* --- Steering: ease the wheel toward the requested angle -------------- */
    const speedFrac = Math.min(1, Math.abs(this.speed) / this.maxSpeed);
    // Max usable lock shrinks as we speed up -> wider radius at speed.
    const maxSteer = MathX.lerp(CONFIG.maxSteerLow, CONFIG.maxSteerHigh, speedFrac) * grip;
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
      accel += CONFIG.engineAccel * this.stats.accel / this.stats.mass;
    }
    if (input.brake) {
      if (this.speed > 8) {
        accel -= CONFIG.brakeDecel; // friction brakes while rolling forward
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
    // Grass eats momentum.
    if (onGrass) accel -= CONFIG.grassDrag * v;

    this.speed += accel * dt;

    /* --- Speed clamps ----------------------------------------------------- */
    let topFwd = this.maxSpeed;
    if (onGrass) topFwd = Math.min(topFwd, CONFIG.grassMaxKmh / CONFIG.speedKmhPerPx);
    this.speed = MathX.clamp(this.speed, -this.maxReverse, topFwd);
    // Snap tiny speeds to zero so the car actually stops (no jitter).
    if (!input.throttle && Math.abs(this.speed) < 3) this.speed = 0;

    /* --- Heading: bicycle model. Body turns only while moving ------------- */
    if (Math.abs(this.speed) > 1) {
      const omega = (this.speed / CONFIG.wheelbase) * Math.tan(this.steer);
      this.heading += omega * dt;
    }
    // Keep heading in a sane range.
    if (this.heading > Math.PI) this.heading -= 2 * Math.PI;
    if (this.heading < -Math.PI) this.heading += 2 * Math.PI;

    /* --- Integrate position ---------------------------------------------- */
    const f = this.forward();
    this.x += f.x * this.speed * dt;
    this.y += f.y * this.speed * dt;
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
