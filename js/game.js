/* =============================================================================
 * game.js — Main loop, chase camera, canvas rendering, input & HUD
 * -----------------------------------------------------------------------------
 * Pulls everything together:
 *   - a fixed-ish requestAnimationFrame loop with delta time (real physics)
 *   - a chase camera that always keeps the car centred (solves "losing the car")
 *   - canvas rendering of grass / road / finish / checkpoints / trees / car
 *   - keyboard input, world-boundary clamping, fuel & telemetry, timing hooks
 * ========================================================================== */

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const speedo = document.getElementById('speedo');
  const sctx = speedo.getContext('2d');

  const CAR_LENGTH = 92; // world px, nose-to-tail render size

  let view = { w: 0, h: 0, dpr: 1 };
  function resize() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = view.w * view.dpr;
    canvas.height = view.h * view.dpr;
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---- Input -------------------------------------------------------------- */
  const keys = {};
  const KEYMAP = {
    ArrowUp: 'throttle', KeyW: 'throttle',
    ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'handbrake',
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') { GameAPI.restart(); return; }
    const act = KEYMAP[e.code];
    if (act) { keys[act] = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    const act = KEYMAP[e.code];
    if (act) { keys[act] = false; e.preventDefault(); }
  });
  // Drop all inputs if the window loses focus (no stuck throttle).
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  /* ---- Sprite cache ------------------------------------------------------- */
  const spriteCache = {};
  function getSprite(src) {
    if (!spriteCache[src]) {
      const img = new Image();
      img.src = src;
      spriteCache[src] = img;
    }
    return spriteCache[src];
  }

  /* ---- Game state --------------------------------------------------------- */
  const G = {
    track: null,
    car: new Car(CAR_DATA[0]),
    timing: null,
    carData: CAR_DATA[0],
    cam: { x: 0, y: 0 },
    clock: 0, // ms of active driving time (paused while a menu is open)
    prev: { x: 0, y: 0 },
    fuel: CONFIG.tankLitres,
    distanceM: 0,
    topKmh: 0,
    sessionMs: 0,
    consumption: 0, // smoothed L/100km
    offTrack: false,
  };
  window.GameState = { carName: G.carData.name, carId: G.carData.id, trackId: 1 };

  function load(trackId, carId) {
    G.track = Track.byId(trackId);
    G.carData = CAR_DATA.find((c) => c.id === carId) || CAR_DATA[0];
    G.car.setStats(G.carData);
    G.timing = new TimingSystem(G.track);
    restart();
    window.GameState.carName = G.carData.name;
    window.GameState.carId = G.carData.id;
    window.GameState.trackId = G.track.id;
    document.getElementById('hud-track-name').textContent = G.track.name;
    document.getElementById('hud-car-name').textContent = G.carData.name;
    buildSectorStrip();
    refreshBest();
  }

  function restart() {
    const s = G.track.start;
    G.car.reset(s.x, s.y, s.heading);
    G.car.engineOn = true;
    G.cam.x = s.x; G.cam.y = s.y;
    G.prev.x = s.x; G.prev.y = s.y;
    G.clock = 0;
    G.fuel = CONFIG.tankLitres;
    G.distanceM = 0;
    G.topKmh = 0;
    G.sessionMs = 0;
    G.consumption = 8;
    G.timing.reset();
    for (const k in keys) keys[k] = false;
  }

  /* ---- Update ------------------------------------------------------------- */
  let menuOpen = () => !document.getElementById('overlay').classList.contains('hidden');

  function update(dt) {
    // Surface from distance to the centreline (road vs grass).
    const distToRoad = Track.nearestDist(G.track.centre, G.car.x, G.car.y);
    const surface = distToRoad <= G.track.half ? 'road' : 'grass';
    G.offTrack = surface === 'grass';

    G.prev.x = G.car.x; G.prev.y = G.car.y;

    const input = {
      throttle: !!keys.throttle,
      brake: !!keys.brake,
      left: !!keys.left,
      right: !!keys.right,
      handbrake: !!keys.handbrake,
    };
    G.car.update(dt, input, surface);

    // Keep the car inside the playable area (deliverable #2).
    G.car.clampToBounds(G.track.bounds, CAR_LENGTH * 0.5);

    // ---- Fuel ----
    const speedFrac = Math.abs(G.car.speed) / G.car.maxSpeed;
    const burn = CONFIG.idleBurn +
      (input.throttle && G.car.engineOn ? CONFIG.throttleBurn * (0.3 + speedFrac) * dt : 0);
    G.fuel = Math.max(0, G.fuel - burn);
    G.car.engineOn = G.fuel > 0;

    // ---- Telemetry ----
    const movedM = (Math.abs(G.car.speed) * dt) / CONFIG.worldPxPerMetre;
    G.distanceM += movedM;
    G.sessionMs += dt * 1000;
    if (G.car.speedKmh > G.topKmh) G.topKmh = G.car.speedKmh;
    // Smooth instantaneous consumption -> L/100km for the range estimate.
    const inst = movedM > 0.001 ? (burn / (movedM / 1000)) : G.consumption; // L/km
    G.consumption = MathX.lerp(G.consumption, inst * 100, 0.02);

    // ---- Timing ----
    G.clock += dt * 1000;
    G.timing.setNow(G.clock);
    G.timing.update(G.prev, { x: G.car.x, y: G.car.y }, G.clock);
    if (G.timing.justImprovedBest) flashBest();

    // ---- Camera follow (smooth) ----
    const t = 1 - Math.exp(-CONFIG.cameraLerp * dt);
    G.cam.x = MathX.lerp(G.cam.x, G.car.x, t);
    G.cam.y = MathX.lerp(G.cam.y, G.car.y, t);
  }

  /* ---- Render ------------------------------------------------------------- */
  function render() {
    const tk = G.track;
    const theme = Track.theme(tk.theme);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

    // Grass background.
    ctx.fillStyle = theme.grass;
    ctx.fillRect(0, 0, view.w, view.h);

    ctx.save();
    ctx.translate(view.w / 2, view.h / 2);
    ctx.scale(CONFIG.zoom, CONFIG.zoom);
    ctx.translate(-G.cam.x, -G.cam.y);

    drawRoad(theme);
    drawFinish();
    drawCheckpoints();
    drawTrees(theme);
    drawCar();

    ctx.restore();
    drawVignette();
  }

  function pathCentre() {
    const c = G.track.centre;
    ctx.beginPath();
    ctx.moveTo(c[0].x, c[0].y);
    for (let i = 1; i < c.length; i++) ctx.lineTo(c[i].x, c[i].y);
    ctx.closePath();
  }

  function drawRoad(theme) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Outer kerb / edge
    pathCentre();
    ctx.strokeStyle = theme.edge;
    ctx.lineWidth = G.track.width + 18;
    ctx.stroke();
    // Asphalt
    pathCentre();
    ctx.strokeStyle = theme.road;
    ctx.lineWidth = G.track.width;
    ctx.stroke();
    // Centre dashes
    pathCentre();
    ctx.setLineDash([28, 36]);
    ctx.strokeStyle = 'rgba(245, 215, 120, 0.45)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawFinish() {
    const g = G.track.gates[0];
    const tan = g.tangent;
    const nx = -tan.y, ny = tan.x; // normal across the road
    const half = G.track.half;
    const cols = 8;
    const cell = (half * 2) / cols;
    const depth = 30;
    ctx.save();
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < cols; i++) {
        const dist = -half + i * cell;
        const along = (row - 0.5) * depth;
        const cx = g.centre.x + nx * (dist + cell / 2) + tan.x * along;
        const cy = g.centre.y + ny * (dist + cell / 2) + tan.y * along;
        ctx.fillStyle = (i + row) % 2 === 0 ? '#f8fafc' : '#0a0c10';
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.atan2(tan.y, tan.x));
        ctx.fillRect(-cell / 2, -depth / 2, cell, depth);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawCheckpoints() {
    G.track.gates.forEach((g) => {
      if (g.isFinish) return;
      const isNext = g.index === G.timing.nextCp;
      ctx.beginPath();
      ctx.moveTo(g.a.x, g.a.y);
      ctx.lineTo(g.b.x, g.b.y);
      ctx.strokeStyle = isNext ? 'rgba(34,211,238,0.85)' : 'rgba(34,211,238,0.18)';
      ctx.lineWidth = isNext ? 7 : 4;
      ctx.stroke();
    });
  }

  function drawTrees(theme) {
    G.track.trees.forEach((t) => {
      // trunk shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(t.x + 5, t.y + 6, t.r * 0.95, t.r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      // canopy
      ctx.fillStyle = theme.treeDark;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = theme.tree;
      ctx.beginPath();
      ctx.arc(t.x - t.r * 0.18, t.y - t.r * 0.18, t.r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawCar() {
    const car = G.car;
    const img = getSprite(G.carData.sprite);
    const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0.5;
    const h = CAR_LENGTH;
    const w = h * ratio;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(4, 6, w * 0.55, h * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (img.complete && img.naturalWidth) {
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      ctx.fillStyle = G.carData.color;
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    ctx.restore();
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(
      view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.35,
      view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  /* ---- HUD ---------------------------------------------------------------- */
  const el = (id) => document.getElementById(id);
  function updateHUD() {
    const car = G.car;
    el('speed-val').textContent = Math.round(car.speedKmh);
    const gear = el('gear');
    gear.textContent = car.gear;
    gear.style.color = car.gear === 'R' ? '#f59e0b' : car.gear === 'D' ? '#22c55e' : '#7c8597';

    // Fuel
    const pct = (G.fuel / CONFIG.tankLitres) * 100;
    el('fuel-pct').textContent = `${Math.round(pct)}%`;
    const bar = el('fuel-bar');
    bar.style.width = `${pct}%`;
    bar.className = `h-full transition-all duration-200 ${pct < 15 ? 'bg-apex-bad' : pct < 35 ? 'bg-amber-400' : 'bg-apex-good'}`;

    el('distance').textContent = `${(G.distanceM / 1000).toFixed(2)} km`;
    el('session-time').textContent = fmtClock(G.sessionMs);
    const avg = G.sessionMs > 1000 ? (G.distanceM / 1000) / (G.sessionMs / 3600000) : 0;
    el('avg-speed').textContent = `${Math.round(avg)} km/h`;
    el('top-speed').textContent = `${Math.round(G.topKmh)} km/h`;
    const rangeKm = G.consumption > 0.1 ? G.fuel / (G.consumption / 100) : 0;
    el('range').textContent = G.fuel <= 0 ? 'EMPTY' : `${Math.round(rangeKm)} km`;

    // Timing
    el('lap-current').textContent = TimingSystem.format(G.timing.currentLapMs);
    el('lap-count').textContent = `LAP ${G.timing.lapCount}`;
    el('lap-last').textContent = TimingSystem.format(G.timing.lastLapMs);

    const deltaEl = el('lap-delta');
    const d = G.timing.liveDelta;
    if (d == null) {
      deltaEl.textContent = '';
    } else {
      deltaEl.textContent = TimingSystem.formatDelta(d);
      deltaEl.style.color = d <= 0 ? '#22c55e' : '#ef4444';
    }

    // Off-track warning
    el('offtrack').style.opacity = G.offTrack && Math.abs(car.speed) > 5 ? '1' : '0';

    updateSectorStrip();
    drawSpeedo();
  }

  function fmtClock(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function refreshBest() {
    el('lap-best').textContent = G.timing.best ? TimingSystem.format(G.timing.best.time) : '--:--.--';
  }
  function flashBest() {
    refreshBest();
    const b = el('lap-best');
    b.classList.remove('flash-good'); void b.offsetWidth; b.classList.add('flash-good');
  }

  function buildSectorStrip() {
    const strip = el('sector-strip');
    strip.innerHTML = '';
    for (let i = 0; i < G.track.checkpointCount; i++) {
      const seg = document.createElement('div');
      seg.className = 'flex-1 h-1.5 rounded-full bg-apex-panel2';
      seg.dataset.idx = i;
      strip.appendChild(seg);
    }
  }
  function updateSectorStrip() {
    const strip = el('sector-strip');
    const passed = G.timing.lastSectorIndex;
    [...strip.children].forEach((seg, i) => {
      const done = G.timing.running && passed != null && i <= passed && i > 0;
      const isNext = i === G.timing.nextCp && G.timing.running;
      seg.className = `flex-1 h-1.5 rounded-full ${done ? 'bg-apex-accent2' : isNext ? 'bg-slate-500' : 'bg-apex-panel2'}`;
    });
  }

  /* ---- Speedometer gauge -------------------------------------------------- */
  function drawSpeedo() {
    const W = speedo.width, H = speedo.height;
    const cx = W / 2, cy = H / 2, r = W / 2 - 12;
    sctx.clearRect(0, 0, W, H);

    const start = Math.PI * 0.75;
    const end = Math.PI * 2.25;
    const maxKmh = Math.max(G.carData.topSpeed, 1);
    const frac = Math.min(1, G.car.speedKmh / maxKmh);

    // Track arc
    sctx.lineCap = 'round';
    sctx.beginPath();
    sctx.arc(cx, cy, r, start, end);
    sctx.strokeStyle = '#1d212b';
    sctx.lineWidth = 10;
    sctx.stroke();

    // Value arc (colour shifts toward red near top speed)
    const ang = start + (end - start) * frac;
    sctx.beginPath();
    sctx.arc(cx, cy, r, start, ang);
    sctx.strokeStyle = frac > 0.82 ? '#ef4444' : frac > 0.55 ? '#f59e0b' : '#22d3ee';
    sctx.lineWidth = 10;
    sctx.stroke();

    // Reverse indicator
    if (G.car.gear === 'R') {
      sctx.beginPath();
      sctx.arc(cx, cy, r, start, start + 0.5);
      sctx.strokeStyle = '#f59e0b';
      sctx.lineWidth = 10;
      sctx.stroke();
    }

    // Tick marks
    for (let i = 0; i <= 10; i++) {
      const a = start + (end - start) * (i / 10);
      const x1 = cx + Math.cos(a) * (r - 14);
      const y1 = cy + Math.sin(a) * (r - 14);
      const x2 = cx + Math.cos(a) * (r - 7);
      const y2 = cy + Math.sin(a) * (r - 7);
      sctx.beginPath();
      sctx.moveTo(x1, y1); sctx.lineTo(x2, y2);
      sctx.strokeStyle = '#3a4150';
      sctx.lineWidth = 2;
      sctx.stroke();
    }
  }

  /* ---- Main loop ---------------------------------------------------------- */
  let last = 0;
  function frame(ts) {
    if (!last) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    dt = Math.min(dt, 0.05); // clamp big gaps (tab switches) to avoid tunnelling

    if (!menuOpen()) update(dt);
    render();
    updateHUD();
    requestAnimationFrame(frame);
  }

  /* ---- Public API + boot -------------------------------------------------- */
  window.GameAPI = {
    selectTrack: (id) => load(id, G.carData.id),
    selectCar: (id) => load(G.track.id, id),
    restart,
    currentTrackId: () => (G.track ? G.track.id : 1),
    currentCarId: () => G.carData.id,
  };

  UI.init();
  load(1, 1);
  requestAnimationFrame(frame);
})();
