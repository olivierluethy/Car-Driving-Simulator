/* =============================================================================
 * condition.js — Tyre wear & damage model (deliverables #2, #3, #7)
 * -----------------------------------------------------------------------------
 * This class is the bridge between "what the driver did" and "how the car now
 * performs". It consumes per-frame telemetry (cornering load, braking, surface,
 * impacts, fuel) and accumulates two 0-100 quantities — tyreWear and damage —
 * then exposes:
 *   - modifiers(): the multiplier set the physics applies, so a worn/damaged
 *     car genuinely loses top speed, grip, acceleration, braking and steering.
 *   - severity levels + needsPit(): what the HUD and pit logic key off.
 *
 * Keeping accumulation and effect separate means tuning consequences never
 * touches the physics, and the same model works for any car or surface.
 * ========================================================================== */

class CarCondition {
  constructor() { this.reset(); }

  reset() {
    this.tyreWear = 0; // 0 fresh -> 100 gone
    this.damage = 0; // 0 pristine -> 100 wrecked
    this.lastImpactKmh = 0;
  }

  /* telem: { lateralG, slip, speedFrac, braking, throttle, surface, fuelPct } */
  update(dt, telem) {
    const T = CONFIG.tyre, D = CONFIG.damage;
    const car = telem.carStats;

    // --- Tyre wear ---
    const cornerLoad = telem.lateralG / Car.BASE_GRIP_ACCEL; // ~0..1.2
    let wear = T.corneringWear * cornerLoad * cornerLoad;          // hard cornering
    wear += T.speedWear * telem.speedFrac;                        // sustained speed
    if (telem.braking && telem.speedFrac > 0.4) wear += T.brakeWear * telem.speedFrac; // heavy braking
    wear *= telem.surface.wear * car.tyre;                       // surface + car compound
    this.tyreWear = MathX.clamp(this.tyreWear + wear * dt, 0, 100);

    // --- Damage ---
    let dmg = telem.surface.damage * telem.speedFrac;            // running through gravel/sand/grass
    if (telem.slip > 0.5 && telem.speedFrac > 0.5) dmg += D.overdriveScale * telem.slip; // overdriving
    if (telem.fuelPct <= D.lowFuelPct && telem.throttle) dmg += D.lowFuelStress; // running it dry
    this.damage = MathX.clamp(this.damage + dmg * dt, 0, 100);
  }

  // A discrete collision (wall / hard contact). speedKmh = impact speed.
  impact(speedKmh) {
    if (speedKmh < 25) return; // gentle nudges don't count
    const add = CONFIG.damage.impactScale * (speedKmh - 25);
    this.damage = MathX.clamp(this.damage + add, 0, 100);
    this.lastImpactKmh = speedKmh;
  }

  // Multipliers consumed by Car.update().
  modifiers(carStats) {
    const D = CONFIG.damage, T = CONFIG.tyre;
    const wf = this.tyreWear / 100, df = this.damage / 100;
    const tyreGrip = 1 - T.gripLossAtFull * wf;
    return {
      topSpeedMul: 1 - D.topSpeedLoss * df,
      accelMul: 1 - D.accelLoss * df,
      gripMul: tyreGrip * (1 - D.gripLoss * df),
      brakeMul: tyreGrip * (1 - D.brakeLoss * df),
      steerMul: 1 - D.steerLoss * df,
    };
  }

  /* ---- Severity / strategy queries --------------------------------------- */
  damageLevel() {
    const D = CONFIG.damage;
    if (this.damage >= D.severe) return 'severe';
    if (this.damage >= D.medium) return 'medium';
    if (this.damage >= D.minor) return 'minor';
    return 'ok';
  }

  tyreLevel() {
    if (this.tyreWear >= CONFIG.tyre.wornThreshold) return 'worn';
    if (this.tyreWear >= 55) return 'low';
    return 'ok';
  }

  pitMandatory() { return this.damage >= CONFIG.damage.mandatoryPit; }

  // Why (if at all) the car wants the pit lane.
  needsPit(fuelPct) {
    if (this.pitMandatory()) return 'DAMAGE';
    if (this.tyreWear >= CONFIG.tyre.wornThreshold) return 'TYRES';
    if (fuelPct <= 8) return 'FUEL';
    return null;
  }
}
