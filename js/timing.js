/* =============================================================================
 * timing.js — Lap timing, sector splits & persistent records (deliverables 4-6)
 * -----------------------------------------------------------------------------
 * Checkpoints are perpendicular gates across the road (built in tracks.js). We
 * detect a crossing by testing whether the car's movement segment for this
 * frame (prevPos -> pos) intersects the gate segment — robust even at high
 * speed where the car can jump a long way between frames.
 *
 * Gate 0 is the start/finish line. The first time you cross it the clock starts;
 * each subsequent gate must be crossed IN ORDER (so you can't cut the course);
 * crossing gate 0 again after the final sector completes the lap. Sector times
 * are compared live against your personal-best lap's splits to produce the
 * F1/rally-style "+0.8 / -1.3" delta. Best times are persisted in localStorage.
 * ========================================================================== */

class TimingSystem {
  constructor(track) {
    this.track = track;
    this.storageKey = `cds_best_v2_${track.id}`; // v2: track layouts redesigned
    this.best = this._load();
    this.reset();
  }

  reset() {
    this.running = false;
    this.lapStartMs = 0;
    this.sectorStartMs = 0;
    this.nextCp = 0; // gate index we expect to cross next
    this.splits = []; // cumulative time at each crossed checkpoint this lap
    this.lastLapMs = null; // duration of the most recently completed lap
    this.lastLapDelta = null; // its delta vs best (ms, signed)
    this.sectorDelta = null; // delta at the most recent sector (ms, signed)
    this.lastSectorIndex = null;
    this.justImprovedBest = false;
    this.lapCount = 0;
  }

  _load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  _save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.best));
    } catch (_) { /* storage disabled — records just won't persist */ }
  }

  /* Called every frame with the car's previous & current world position. */
  update(prev, cur, nowMs) {
    this.justImprovedBest = false;
    const gate = this.track.gates[this.nextCp];
    if (!Track.segmentsIntersect(prev, cur, gate.a, gate.b)) return;

    if (gate.isFinish) {
      if (this.running) this._completeLap(nowMs);
      this._startLap(nowMs);
    } else {
      this._sector(gate, nowMs);
    }
  }

  _startLap(nowMs) {
    this.running = true;
    this.lapStartMs = nowMs;
    this.sectorStartMs = nowMs;
    this.splits = [];
    this.lastSectorIndex = null;
    this.sectorDelta = null;
    this.nextCp = this.track.checkpointCount > 1 ? 1 : 0;
  }

  _sector(gate, nowMs) {
    if (!this.running) return;
    const cumulative = nowMs - this.lapStartMs;
    this.splits[gate.index] = cumulative;
    // Live delta vs the personal-best lap's split at this same checkpoint.
    if (this.best && this.best.splits && this.best.splits[gate.index] != null) {
      this.sectorDelta = cumulative - this.best.splits[gate.index];
    } else {
      this.sectorDelta = null;
    }
    this.lastSectorIndex = gate.index;
    this.sectorStartMs = nowMs;
    this.nextCp = (gate.index + 1) % this.track.checkpointCount;
  }

  _completeLap(nowMs) {
    const lapMs = nowMs - this.lapStartMs;
    this.splits[0] = lapMs; // final split == full lap time
    this.lastLapMs = lapMs;
    this.lapCount++;
    this.lastLapDelta = this.best ? lapMs - this.best.time : null;

    if (!this.best || lapMs < this.best.time) {
      this.best = {
        time: lapMs,
        splits: this.splits.slice(),
        car: window.GameState ? window.GameState.carName : '',
        date: new Date().toISOString(),
      };
      this._save();
      this.justImprovedBest = true;
    }
  }

  // Frozen delta to show live between checkpoints (last sector's delta).
  get liveDelta() { return this.sectorDelta; }

  get currentLapMs() {
    return this.running ? this._now() - this.lapStartMs : 0;
  }

  _now() { return this._externalNow != null ? this._externalNow : 0; }
  setNow(ms) { this._externalNow = ms; }

  /* ---- Formatting helpers ------------------------------------------------- */
  static format(ms) {
    if (ms == null) return '--:--.--';
    const sign = ms < 0 ? '-' : '';
    ms = Math.abs(ms);
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  static formatDelta(ms) {
    if (ms == null) return '';
    const sign = ms > 0 ? '+' : '-';
    const v = Math.abs(ms) / 1000;
    return `${sign}${v.toFixed(2)}s`;
  }
}
