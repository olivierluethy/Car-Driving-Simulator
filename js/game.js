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

  // Atmosphere palettes (team garage doors + spectator dots).
  const TEAM_COLORS = ['#e11d2a', '#22d3ee', '#a855f7', '#22c55e', '#f59e0b', '#3b82f6', '#e5e7eb', '#ec4899'];
  const SPEC = ['#e5e7eb', '#fca5a5', '#93c5fd', '#fcd34d', '#86efac', '#f9a8d4', '#c4b5fd'];

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

  const rng = Math.random; // browser RNG is fine for visual scatter

  /* ---- Game state --------------------------------------------------------- */
  const G = {
    track: null,
    car: new Car(CAR_DATA[0]),
    timing: null,
    condition: new CarCondition(),
    pit: new PitStop(),
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
    surfaceType: 'road',
    inPit: false,
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
    G.condition.reset();
    G.pit.reset();
    Effects.reset();
    G.surfaceType = 'road';
    G.inPit = false;
    for (const k in keys) keys[k] = false;
  }

  /* ---- Update ------------------------------------------------------------- */
  let menuOpen = () => !document.getElementById('overlay').classList.contains('hidden');

  function update(dt) {
    const tk = G.track;

    // ---- Resolve surface & pit-lane membership ----
    const surfType = Track.surfaceAt(tk, G.car.x, G.car.y);
    const surfDef = SURFACES[surfType];
    G.surfaceType = surfType;
    G.offTrack = surfType !== 'road';
    const inPit = Track.pointInPit(tk, G.car.x, G.car.y);
    G.inPit = inPit;

    // ---- Performance modifiers from tyre wear & damage ----
    const mods = G.condition.modifiers(G.carData);
    const servicing = G.pit.isServicing();
    const env = {
      surface: surfDef,
      mods,
      speedLimitKmh: G.pit.limiterActive(inPit) ? CONFIG.pit.speedLimitKmh : null,
      frozen: servicing,
    };

    G.prev.x = G.car.x; G.prev.y = G.car.y;
    const prevWheels = G.car.rearWheels();

    const input = {
      throttle: !!keys.throttle && !servicing,
      brake: !!keys.brake && !servicing,
      left: !!keys.left && !servicing,
      right: !!keys.right && !servicing,
      handbrake: !!keys.handbrake && !servicing,
    };

    const speedBefore = G.car.speedKmh;
    G.car.update(dt, input, env);

    // Keep the car inside the playable area; a wall hit at speed = damage.
    if (G.car.clampToBounds(tk.bounds, CAR_LENGTH * 0.5)) G.condition.impact(speedBefore);

    // ---- Fuel (scaled by the car's efficiency) ----
    const speedFrac = Math.abs(G.car.speed) / G.car.maxSpeed;
    let burn = 0;
    if (!servicing) {
      burn = CONFIG.idleBurn +
        (input.throttle && G.car.engineOn ? CONFIG.throttleBurn * (0.3 + speedFrac) * G.carData.fuelUse * dt : 0);
      G.fuel = Math.max(0, G.fuel - burn);
    }
    G.car.engineOn = G.fuel > 0;
    const fuelPct = (G.fuel / CONFIG.tankLitres) * 100;

    // ---- Tyre wear & damage accumulation ----
    if (!servicing) {
      G.condition.update(dt, {
        lateralG: G.car.lateralG, slip: G.car.slip, speedFrac,
        braking: input.brake, throttle: input.throttle,
        surface: surfDef, fuelPct, carStats: G.carData,
      });
    }

    // ---- Pit-stop state machine (limiter/service/restrictions) ----
    G.pit.update(dt, { car: G.car, condition: G.condition, state: G, inPit, track: tk });

    // ---- Visual effects (skid marks, debris, smoke) ----
    if (!servicing) {
      const fwd = G.car.forward();
      const spd = Math.abs(G.car.speed);
      if (G.car.slip > 0.12 && spd > 40) {
        Effects.skidFromWheels(prevWheels, G.car.rearWheels(), G.car.slip);
      }
      if (surfDef.particle && spd > 30) {
        Effects.emitSurface(surfType, G.car.x, G.car.y, fwd, spd, Math.min(1, spd / G.car.maxSpeed), rng);
      }
      if (G.condition.damage >= CONFIG.damage.severe && spd > 20) {
        const sev = (G.condition.damage - CONFIG.damage.severe) / (100 - CONFIG.damage.severe);
        Effects.emitSmoke(G.car.x, G.car.y, fwd, 0.35 + sev * 0.6, rng);
      }
    }
    Effects.update(dt);

    // ---- Telemetry ----
    const movedM = (Math.abs(G.car.speed) * dt) / CONFIG.worldPxPerMetre;
    G.distanceM += movedM;
    G.sessionMs += dt * 1000;
    if (G.car.speedKmh > G.topKmh) G.topKmh = G.car.speedKmh;
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

    // Visible world rect (for effect culling).
    const hw = view.w / (2 * CONFIG.zoom) + 140;
    const hh = view.h / (2 * CONFIG.zoom) + 140;
    const vb = { minX: G.cam.x - hw, maxX: G.cam.x + hw, minY: G.cam.y - hh, maxY: G.cam.y + hh };

    ctx.save();
    ctx.translate(view.w / 2, view.h / 2);
    ctx.scale(CONFIG.zoom, CONFIG.zoom);
    ctx.translate(-G.cam.x, -G.cam.y);

    drawHazards(theme);
    drawRoad(theme);
    drawPitLane(theme);
    drawAtmosphere(theme); // grandstands, garages, pit wall, lights, gantry
    drawFinish();
    drawCheckpoints();
    Effects.drawMarks(ctx, vb); // rubber sits on the tarmac, under the car
    drawTrees(theme);
    drawCar();
    G.pit.draw(ctx, G.car); // pit crew around the car during a stop
    Effects.drawParticles(ctx, vb); // dust/debris over the top

    ctx.restore();
    drawVignette();
  }

  // Gravel/sand run-off traps beside the sharp corners.
  function drawHazards(theme) {
    G.track.hazards.forEach((h) => {
      const def = SURFACES[h.type];
      ctx.fillStyle = def.color;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
      ctx.fill();
      // speckle texture (deterministic-ish from position, cheap)
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = h.type === 'sand' ? '#b89a55' : '#6f6244';
      for (let i = 0; i < 18; i++) {
        const a = (i * 2.39963);
        const rr2 = ((i * 53) % 100) / 100 * h.r * 0.9;
        ctx.beginPath();
        ctx.arc(h.x + Math.cos(a) * rr2, h.y + Math.sin(a) * rr2, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
  }

  // Stroke a polyline as a thick band (used for the pit lane & wall).
  function strokePoly(poly, w, style) {
    if (poly.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Pit lane: a tarmac ribbon following the tapered lane polyline, with a blue
  // limiter line over the active zone and the pit box at its centre.
  function drawPitLane(theme) {
    const pit = G.track.pit;
    const poly = pit.lanePoly;
    strokePoly(poly, pit.width + 10, theme.edge); // kerb edge
    strokePoly(poly, pit.width, theme.road);      // tarmac

    // Blue pit-lane speed-limit line along the active (limiter) section only.
    ctx.save();
    ctx.setLineDash([22, 16]);
    ctx.strokeStyle = 'rgba(34,211,238,0.5)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < poly.length; i++) {
      if (pit.active[i]) {
        if (!pen) { ctx.moveTo(poly[i].x, poly[i].y); pen = true; }
        else ctx.lineTo(poly[i].x, poly[i].y);
      } else pen = false;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Pit box.
    const need = G.condition.needsPit((G.fuel / CONFIG.tankLitres) * 100);
    const color = need ? '#f59e0b' : '#22d3ee';
    ctx.save();
    ctx.translate(pit.box.x, pit.box.y);
    ctx.rotate(pit.boxAngle);
    ctx.fillStyle = need ? 'rgba(245,158,11,0.16)' : 'rgba(34,211,238,0.10)';
    ctx.fillRect(-46, -34, 92, 68);
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.strokeRect(-46, -34, 92, 68);
    ctx.rotate(-pit.boxAngle);
    ctx.fillStyle = color;
    ctx.font = '900 40px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', 0, 0);
    ctx.restore();
  }

  // Grandstands, team garages, pit wall, floodlights and the S/F gantry —
  // turning the main straight into the visual hub of the circuit.
  function drawAtmosphere(theme) {
    const pit = G.track.pit;

    // Team garages behind the boxes.
    pit.garages.forEach((g, i) => {
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.angle);
      const w = 72, h = CONFIG.pit.garageDepth;
      ctx.fillStyle = '#1b1f27';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#262c37'; // roof band toward the lane
      ctx.fillRect(-w / 2, -h / 2, w, h * 0.3);
      ctx.fillStyle = TEAM_COLORS[i % TEAM_COLORS.length]; // garage door
      ctx.fillRect(-w * 0.36, -h * 0.04, w * 0.72, h * 0.42);
      ctx.strokeStyle = '#0b0e13';
      ctx.lineWidth = 2;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    });

    // Pit wall (between the lane and the track) with a red/white top.
    if (pit.wall.length > 1) {
      strokePoly(pit.wall, 11, '#3a3f4a');
      ctx.lineCap = 'butt';
      for (let i = 0; i < pit.wall.length - 1; i++) {
        ctx.strokeStyle = i % 2 ? '#e5e7eb' : '#d1402f';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(pit.wall[i].x, pit.wall[i].y);
        ctx.lineTo(pit.wall[i + 1].x, pit.wall[i + 1].y);
        ctx.stroke();
      }
    }

    pit.grandstands.forEach(drawGrandstand);
    pit.lights.forEach(drawLight);
    drawGantry();
  }

  function drawGrandstand(s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    const len = s.len, depth = 120;
    ctx.fillStyle = '#202632';
    ctx.fillRect(-len / 2, -depth / 2, len, depth);
    for (let t = 0; t < 4; t++) { // seating tiers
      ctx.fillStyle = t % 2 ? '#283041' : '#222a38';
      ctx.fillRect(-len / 2, -depth / 2 + t * (depth / 4), len, depth / 4 - 3);
    }
    for (let i = 0; i < 100; i++) { // spectators
      const r = ((i * 53) % 100) / 100, r2 = ((i * 131) % 100) / 100;
      ctx.fillStyle = SPEC[(i * 7) % SPEC.length];
      ctx.beginPath();
      ctx.arc(-len / 2 + r * len, -depth / 2 + r2 * depth, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#0b0e13';
    ctx.lineWidth = 3;
    ctx.strokeRect(-len / 2, -depth / 2, len, depth);
    ctx.fillStyle = '#161b24'; // roof lip on the track side
    ctx.fillRect(-len / 2, -depth / 2 - 10, len, 12);
    ctx.restore();
  }

  function drawLight(l) {
    const gr = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, 64);
    gr.addColorStop(0, 'rgba(255,245,200,0.18)');
    gr.addColorStop(1, 'rgba(255,245,200,0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(l.x, l.y, 64, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#11151c';
    ctx.beginPath();
    ctx.arc(l.x, l.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.arc(l.x, l.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGantry() {
    const g = G.track.gates[0];
    const t = g.tangent, n = { x: -t.y, y: t.x }, half = G.track.half;
    const x1 = g.centre.x - n.x * (half + 22), y1 = g.centre.y - n.y * (half + 22);
    const x2 = g.centre.x + n.x * (half + 22), y2 = g.centre.y + n.y * (half + 22);
    ctx.strokeStyle = '#11151c';
    ctx.lineWidth = 13;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = '#e11d2a';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    for (let i = 0; i < 5; i++) { // start lights
      const f = (i + 1) / 6;
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath();
      ctx.arc(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, 4, 0, Math.PI * 2);
      ctx.fill();
    }
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
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading);

    if (G.carData.type === 'f1') {
      // ground shadow (narrow open-wheeler)
      ctx.fillStyle = 'rgba(0,0,0,0.33)';
      ctx.beginPath();
      ctx.ellipse(3, 5, CAR_LENGTH * 0.26, CAR_LENGTH * 0.52, 0, 0, Math.PI * 2);
      ctx.fill();
      F1.draw(ctx, CAR_LENGTH, G.carData.livery);
    } else {
      const img = getSprite(G.carData.sprite);
      const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0.5;
      const h = CAR_LENGTH;
      const w = h * ratio;
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

    // Off-track warning (and which surface)
    el('offtrack').style.opacity = G.offTrack && Math.abs(car.speed) > 5 ? '1' : '0';
    el('surface-tag').textContent = `SURFACE · ${G.surfaceType.toUpperCase()}`;

    // ---- Tyres ----
    const tyrePct = 100 - G.condition.tyreWear;
    el('tyre-pct').textContent = `${Math.round(tyrePct)}%`;
    el('tyre-bar').style.width = `${tyrePct}%`;
    const tl = G.condition.tyreLevel();
    el('tyre-bar').className = `h-full transition-all duration-200 ${tl === 'worn' ? 'bg-apex-bad' : tl === 'low' ? 'bg-amber-400' : 'bg-apex-good'}`;

    // ---- Damage ----
    const dmg = G.condition.damage;
    el('damage-pct').textContent = `${Math.round(dmg)}%`;
    el('damage-bar').style.width = `${dmg}%`;
    const dlv = G.condition.damageLevel();
    el('damage-bar').className = `h-full transition-all duration-200 ${dlv === 'severe' ? 'bg-apex-bad' : dlv === 'medium' ? 'bg-orange-400' : dlv === 'minor' ? 'bg-amber-400' : 'bg-apex-good'}`;

    // ---- Pit status ----
    const fuelPct = (G.fuel / CONFIG.tankLitres) * 100;
    const need = G.condition.needsPit(fuelPct);
    const ps = el('pit-status');
    el('pit-count').textContent = `STOPS ${G.pit.pitStopsUsed}`;
    if (G.pit.isServicing()) {
      ps.textContent = 'IN PIT'; ps.style.color = '#22d3ee';
    } else if (need) {
      ps.textContent = `PIT · ${need}`; ps.style.color = G.condition.pitMandatory() ? '#ef4444' : '#f59e0b';
    } else {
      ps.textContent = 'OK'; ps.style.color = '#22c55e';
    }

    // ---- Pit-required banner ----
    const banner = el('pit-banner');
    if (need && !G.pit.isServicing() && !G.inPit) {
      banner.style.opacity = '1';
      const mand = G.condition.pitMandatory();
      banner.firstElementChild.textContent = `${mand ? 'PIT REQUIRED' : 'PIT RECOMMENDED'} · ${need}`;
    } else {
      banner.style.opacity = '0';
    }

    updatePitOverlay();
    updateSectorStrip();
    drawSpeedo();
  }

  // The Formula 1-style service panel shown while the crew works on the car.
  function updatePitOverlay() {
    const po = el('pit-overlay');
    const pit = G.pit;
    if (!pit.isServicing()) {
      if (!po.classList.contains('hidden')) { po.classList.add('hidden'); po.classList.remove('flex'); }
      return;
    }
    po.classList.remove('hidden'); po.classList.add('flex');
    const p = MathX.clamp(pit.serviceElapsed / pit.serviceTotal, 0, 1);
    el('pit-eta').textContent = pit.etaRemaining().toFixed(1);
    el('pit-progress').style.width = `${p * 100}%`;

    const task = (active, doneCond, dotId, txtId) => {
      const dot = el(dotId), txt = el(txtId);
      if (!active) { dot.className = 'w-2.5 h-2.5 rounded-full bg-apex-panel2'; txt.textContent = '—'; txt.className = 'text-[11px] text-apex-mut'; return; }
      const done = doneCond;
      dot.className = `w-2.5 h-2.5 rounded-full ${done ? 'bg-apex-good' : 'bg-amber-400'}`;
      txt.textContent = done ? 'DONE' : 'WORKING';
      txt.className = `text-[11px] ${done ? 'text-apex-good' : 'text-amber-300'}`;
    };
    task(pit.tasks.tyres, p >= 0.6, 'task-tyres-dot', 'task-tyres');
    task(pit.tasks.fuel, p >= 1, 'task-fuel-dot', 'task-fuel');
    task(pit.tasks.repair, p >= 1, 'task-repair-dot', 'task-repair');
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
