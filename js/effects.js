/* =============================================================================
 * effects.js — Tyre marks + dust/debris particles (deliverables #8, #9, #10)
 * -----------------------------------------------------------------------------
 * Two performance-bounded subsystems (deliverable #13):
 *
 *  1. SKID MARKS — a flat list of short, fading line segments laid under the
 *     rear tyres while the car slides/brakes. They follow the EXACT path taken
 *     (we add a segment prevWheel -> curWheel each frame), fade over time, and
 *     are VIEW-CULLED so only on-screen marks cost anything. A hard cap drops
 *     the oldest marks, so the cost never grows with track size or session
 *     length. We deliberately avoid a world-sized offscreen canvas (which would
 *     blow up memory on large tracks) — a culled segment list scales better.
 *
 *  2. PARTICLES — an OBJECT POOL of fixed size. Emitting never allocates; it
 *     reuses dead slots. Dust clouds (grow + fade) and debris bits (fly + drag)
 *     are surface-coloured and scale their count/speed with vehicle speed, so
 *     "the faster you go, the more dramatic" without ever exceeding the cap.
 * ========================================================================== */

const Effects = (() => {
  const MAX_MARKS = 1400; // hard cap on skid segments
  const MAX_PARTICLES = 260; // object-pool size

  let marks = [];
  const pool = [];
  let cursor = 0;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    pool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 1, grow: 0, r: 0, g: 0, b: 0, cloud: false });
  }

  function reset() {
    marks.length = 0;
    for (const p of pool) p.active = false;
    cursor = 0;
  }

  /* ---- Skid marks --------------------------------------------------------- */
  function addSkid(x1, y1, x2, y2, intensity) {
    marks.push({ x1, y1, x2, y2, a: 0.55 * intensity + 0.15, w: 4 + intensity * 5 });
    if (marks.length > MAX_MARKS) marks.splice(0, marks.length - MAX_MARKS);
  }

  // Lay rubber from both rear wheels along the path travelled this frame.
  function skidFromWheels(prev, cur, intensity) {
    for (let i = 0; i < 2; i++) addSkid(prev[i].x, prev[i].y, cur[i].x, cur[i].y, intensity);
  }

  /* ---- Particle emission -------------------------------------------------- */
  function spawn(x, y, vx, vy, maxLife, size, grow, col, cloud) {
    // Find a free slot (linear probe from a rotating cursor — O(1) amortised).
    let tries = 0;
    while (pool[cursor].active && tries < MAX_PARTICLES) { cursor = (cursor + 1) % MAX_PARTICLES; tries++; }
    const p = pool[cursor];
    cursor = (cursor + 1) % MAX_PARTICLES;
    p.active = true;
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = maxLife; p.maxLife = maxLife;
    p.size = size; p.grow = grow; p.cloud = cloud;
    p.r = col[0]; p.g = col[1]; p.b = col[2];
  }

  // hexish colours per surface, as [r,g,b]
  const COL = {
    grass: [70, 120, 55],
    gravel: [150, 130, 95],
    sand: [205, 180, 120],
    smoke: [60, 60, 64],
  };

  // Emit surface debris behind the car. `fwd` is the car's unit forward vector,
  // `speed` px/s, `speedFrac` 0..1, `type` the surface particle kind.
  function emitSurface(type, x, y, fwd, speed, speedFrac, rng) {
    if (!type || speedFrac < 0.08) return;
    const back = { x: -fwd.x, y: -fwd.y };
    const rear = { x: x - fwd.x * 28, y: y - fwd.y * 28 };

    if (type === 'sand') {
      // dust cloud + sand grains
      const n = 1 + Math.round(speedFrac * 3);
      for (let i = 0; i < n; i++) {
        const a = (rng() - 0.5) * 1.4;
        const sp = speed * (0.15 + rng() * 0.2);
        spawn(rear.x, rear.y, back.x * sp + (rng() - 0.5) * 40, back.y * sp + (rng() - 0.5) * 40,
          0.7 + rng() * 0.6, 9 + rng() * 10, 28, COL.sand, true);
      }
      if (rng() < 0.6) spawn(rear.x, rear.y, back.x * speed * 0.4 + (rng() - 0.5) * 80, back.y * speed * 0.4 + (rng() - 0.5) * 80, 0.5, 3, 0, COL.sand, false);
    } else if (type === 'gravel') {
      const n = 1 + Math.round(speedFrac * 4);
      for (let i = 0; i < n; i++) {
        const sp = speed * (0.3 + rng() * 0.4);
        spawn(rear.x, rear.y, back.x * sp + (rng() - 0.5) * 160, back.y * sp + (rng() - 0.5) * 160,
          0.5 + rng() * 0.4, 2.5 + rng() * 3, 0, COL.gravel, false);
      }
      if (rng() < 0.4) spawn(rear.x, rear.y, back.x * speed * 0.2, back.y * speed * 0.2, 0.6, 8, 22, COL.gravel, true);
    } else if (type === 'grass') {
      const n = 1 + Math.round(speedFrac * 3);
      for (let i = 0; i < n; i++) {
        const sp = speed * (0.25 + rng() * 0.35);
        spawn(rear.x, rear.y, back.x * sp + (rng() - 0.5) * 130, back.y * sp + (rng() - 0.5) * 130,
          0.45 + rng() * 0.35, 2 + rng() * 3, 0, COL.grass, false);
      }
    }
  }

  // Engine smoke when the car is badly damaged.
  function emitSmoke(x, y, fwd, severity, rng) {
    if (rng() > severity * 0.5) return;
    spawn(x - fwd.x * 20, y - fwd.y * 20,
      (rng() - 0.5) * 30 - fwd.x * 20, (rng() - 0.5) * 30 - fwd.y * 20,
      0.9 + rng() * 0.7, 10 + rng() * 8, 34, COL.smoke, true);
  }

  /* ---- Update ------------------------------------------------------------- */
  function update(dt) {
    // Fade skid marks; drop fully-faded ones (compact in place).
    let w = 0;
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      m.a -= dt * 0.07; // ~14s to fully fade
      if (m.a > 0.01) marks[w++] = m;
    }
    marks.length = w;

    for (const p of pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= (1 - 2.6 * dt); // air drag
      p.vy *= (1 - 2.6 * dt);
      if (p.cloud) p.size += p.grow * dt;
    }
  }

  /* ---- Draw (world space; caller has applied the camera transform) -------- */
  function drawMarks(ctx, vb) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0c0e12';
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      // view-cull: skip segments fully outside the visible world rect
      if ((m.x1 < vb.minX && m.x2 < vb.minX) || (m.x1 > vb.maxX && m.x2 > vb.maxX) ||
          (m.y1 < vb.minY && m.y2 < vb.minY) || (m.y1 > vb.maxY && m.y2 > vb.maxY)) continue;
      ctx.globalAlpha = m.a;
      ctx.lineWidth = m.w;
      ctx.beginPath();
      ctx.moveTo(m.x1, m.y1);
      ctx.lineTo(m.x2, m.y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles(ctx, vb) {
    for (const p of pool) {
      if (!p.active) continue;
      if (p.x < vb.minX || p.x > vb.maxX || p.y < vb.minY || p.y > vb.maxY) continue;
      const t = p.life / p.maxLife;
      ctx.globalAlpha = p.cloud ? t * 0.4 : t * 0.9;
      ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function activeParticleCount() {
    let n = 0; for (const p of pool) if (p.active) n++; return n;
  }

  return { reset, skidFromWheels, emitSurface, emitSmoke, update, drawMarks, drawParticles,
    get markCount() { return marks.length; }, activeParticleCount };
})();
