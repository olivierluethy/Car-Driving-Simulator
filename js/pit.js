/* =============================================================================
 * pit.js — Pit lane, speed limiter & pit-stop state machine (deliverables 4-6)
 * -----------------------------------------------------------------------------
 * A small state machine drives the whole pit experience:
 *
 *   idle  --enter pit zone-->  limiter  --stop in the box-->  servicing
 *     ^                                                          |
 *     |--------------------- leave pit zone ------- released <---/
 *
 * - Entering the pit-lane zone auto-engages the speed limiter (the physics caps
 *   speed; we just report that the limiter is on).
 * - Coming to rest in the box starts a timed service. We interpolate fuel and
 *   damage repair over the service so the gauges visibly recover, swap tyres
 *   partway through, and animate a 4-corner pit crew around the car.
 * - RESTRICTION (deliverable #6): one scheduled stop is allowed. A second stop
 *   is only permitted when damage is severe (mandatory) — otherwise the box is
 *   "closed" and we tell the driver why.
 * ========================================================================== */

class PitStop {
  constructor() { this.reset(); }

  reset() {
    this.phase = 'idle'; // idle | limiter | servicing | released
    this.pitStopsUsed = 0;
    this.scheduledUsed = false; // has the one normal stop been taken?
    this.servicedThisVisit = false; // prevent re-servicing without leaving
    this.serviceTotal = 0;
    this.serviceElapsed = 0;
    this.tasks = { tyres: false, fuel: false, repair: false };
    this.startFuel = 0; this.startDamage = 0;
    this.message = '';
    this.closed = false; // box refused service (restriction)
  }

  isServicing() { return this.phase === 'servicing'; }
  limiterActive(inPit) { return inPit && this.phase !== 'servicing'; }
  etaRemaining() { return Math.max(0, this.serviceTotal - this.serviceElapsed); }

  /* ctx: { car, condition, state (G), inPit } */
  update(dt, ctx) {
    const { car, condition, state, inPit } = ctx;
    const fuelPct = (state.fuel / CONFIG.tankLitres) * 100;

    if (!inPit) {
      // Left the pit lane — reset for the next visit.
      if (this.phase !== 'servicing') {
        this.phase = 'idle';
        this.servicedThisVisit = false;
        this.closed = false;
        this.message = '';
      }
      return;
    }

    // We are in the pit lane.
    if (this.phase === 'idle') this.phase = 'limiter';

    if (this.phase === 'limiter' && !this.servicedThisVisit) {
      const stopped = Math.abs(car.speedKmh) < CONFIG.pit.boxStopKmh;
      const nearBox = Math.hypot(car.x - ctx.track.pit.box.x, car.y - ctx.track.pit.box.y) < ctx.track.pit.width;
      if (stopped && nearBox) this._tryStart(condition, fuelPct);
    }

    if (this.phase === 'servicing') this._service(dt, ctx, fuelPct);
  }

  _tryStart(condition, fuelPct) {
    const mandatory = condition.pitMandatory();
    // Restriction: only one scheduled stop unless damage forces another.
    if (this.scheduledUsed && !mandatory) {
      this.closed = true;
      this.message = 'PIT CLOSED · extra stop only with severe damage';
      return;
    }
    // Work out what needs doing.
    this.tasks = {
      tyres: condition.tyreWear > 5,
      fuel: fuelPct < 99,
      repair: condition.damage > 3,
    };
    if (!this.tasks.tyres && !this.tasks.fuel && !this.tasks.repair) {
      this.message = 'NOTHING TO SERVICE';
      return;
    }
    const P = CONFIG.pit;
    const litres = CONFIG.tankLitres * (1 - fuelPct / 100);
    this.serviceTotal = P.baseService +
      (this.tasks.tyres ? P.tyreTime : 0) +
      (this.tasks.fuel ? litres * P.refuelPerLitre : 0) +
      (this.tasks.repair ? condition.damage * P.repairPerPct : 0);
    this.serviceElapsed = 0;
    this.startFuel = fuelPct;
    this.startDamage = condition.damage;
    this.startTyre = condition.tyreWear;
    this.phase = 'servicing';
    this.mandatory = mandatory;
    this.message = 'SERVICING';
    this.closed = false;
  }

  _service(dt, ctx, fuelPct) {
    const { condition, state } = ctx;
    this.serviceElapsed += dt;
    const p = MathX.clamp(this.serviceElapsed / this.serviceTotal, 0, 1);

    // Interpolate the recoverable quantities so gauges visibly heal.
    if (this.tasks.fuel) state.fuel = MathX.lerp(CONFIG.tankLitres * this.startFuel / 100, CONFIG.tankLitres, p);
    if (this.tasks.repair) condition.damage = MathX.lerp(this.startDamage, 0, p);
    // Tyres are swapped as a discrete event ~60% through the stop.
    if (this.tasks.tyres && p >= 0.6) condition.tyreWear = 0;

    if (p >= 1) {
      // Snap to final values.
      if (this.tasks.fuel) state.fuel = CONFIG.tankLitres;
      if (this.tasks.repair) condition.damage = 0;
      if (this.tasks.tyres) condition.tyreWear = 0;
      ctx.car.engineOn = true;
      this.pitStopsUsed++;
      if (!this.scheduledUsed) this.scheduledUsed = true;
      this.servicedThisVisit = true;
      this.phase = 'released';
      this.message = 'GO GO GO';
    }
  }

  /* ---- In-world pit-crew animation (drawn after the car) ------------------ */
  draw(ctx, car) {
    if (this.phase !== 'servicing') return;
    const p = MathX.clamp(this.serviceElapsed / this.serviceTotal, 0, 1);
    // Crew rush in (0-0.15), work (0.15-0.85), retreat (0.85-1).
    const presence = p < 0.15 ? p / 0.15 : p > 0.85 ? (1 - p) / 0.15 : 1;
    const f = car.forward();
    const s = { x: f.y, y: -f.x }; // side vector
    const L = 92;
    const wheelLong = 0.32 * L, wheelSide = 0.34 * L;
    const corners = [
      { lo: wheelLong, si: wheelSide }, { lo: wheelLong, si: -wheelSide },
      { lo: -wheelLong, si: wheelSide }, { lo: -wheelLong, si: -wheelSide },
    ];

    ctx.save();
    // Jacks (front & rear) — little wedges along the car axis.
    ctx.fillStyle = '#9aa3b2';
    for (const dir of [1, -1]) {
      const jx = car.x + f.x * dir * (L * 0.62), jy = car.y + f.y * dir * (L * 0.62);
      ctx.globalAlpha = presence;
      ctx.beginPath();
      ctx.arc(jx, jy, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    // Four tyre-gun mechanics, sliding in from outboard.
    for (const c of corners) {
      const reach = (1 - presence) * 34;
      const baseX = car.x + f.x * c.lo + s.x * c.si;
      const baseY = car.y + f.y * c.lo + s.y * c.si;
      const sgn = Math.sign(c.si);
      const mx = baseX + s.x * sgn * (16 + reach);
      const my = baseY + s.y * sgn * (16 + reach);
      ctx.globalAlpha = presence;
      // body
      ctx.fillStyle = '#e11d2a';
      ctx.beginPath(); ctx.arc(mx, my, 8, 0, Math.PI * 2); ctx.fill();
      // helmet
      ctx.fillStyle = '#0b0e13';
      ctx.beginPath(); ctx.arc(mx, my, 4.2, 0, Math.PI * 2); ctx.fill();
      // wheel gun line to the wheel
      ctx.strokeStyle = 'rgba(230,230,235,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(baseX, baseY); ctx.stroke();
    }
    // Refuel rig (a hose to the side) if refuelling.
    if (this.tasks.fuel) {
      const hx = car.x + s.x * (wheelSide + 26), hy = car.y + s.y * (wheelSide + 26);
      ctx.globalAlpha = presence;
      ctx.fillStyle = '#22c55e';
      ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(34,197,94,0.8)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(car.x + s.x * 6, car.y + s.y * 6); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
