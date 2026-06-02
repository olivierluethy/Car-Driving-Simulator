/* =============================================================================
 * tracks.js — Coordinate-based track system (replaces image tracks)
 * -----------------------------------------------------------------------------
 * WHY VECTOR TRACKS (the answer to deliverable #7):
 *   A track is defined by a handful of control points (its racing line) plus a
 *   road width. A closed Catmull-Rom spline through those points gives a smooth
 *   centreline sampled into many small segments. From that single source of
 *   geometry we get, for free:
 *     - rendering (stroke the polyline with lineWidth = road width)
 *     - collision / off-road test (distance from car to the centreline)
 *     - checkpoints & finish line (perpendicular gates at chosen arc positions)
 *     - the playable boundary (bounding box of the centreline + margin)
 *   None of this is feasible with a flat PNG without per-pixel colour sampling.
 *   Vector tracks are also tiny (a few KB of numbers), scalable, and trivial to
 *   author or generate.
 * ========================================================================== */

const Track = (() => {
  /* ---- Catmull-Rom: smooth closed curve through control points ------------ */
  function catmullRomClosed(pts, samplesPerSeg) {
    const n = pts.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const p3 = pts[(i + 2) % n];
      for (let s = 0; s < samplesPerSeg; s++) {
        const t = s / samplesPerSeg;
        const t2 = t * t;
        const t3 = t2 * t;
        out.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
              (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
              (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
              (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
              (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    return out;
  }

  // Distance from point P to segment AB (and squared distance is enough to
  // compare, but we return the real distance for the off-road threshold test).
  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-6;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  // Do segments P1P2 and P3P4 intersect? Used for checkpoint-gate crossing.
  function segmentsIntersect(p1, p2, p3, p4) {
    const d = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
    if (Math.abs(d) < 1e-9) return false;
    const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / d;
    const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / d;
    return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
  }

  // A tiny deterministic PRNG so tree scatter is identical every reload
  // (Math.random would jitter the scenery between sessions).
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const KERB = 18; // rumble-strip width just beyond the asphalt (world px)

  // Smoothstep easing — gives the pit-lane entry/exit their gentle S-curve.
  function smoothstep(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

  // Min distance from (x,y) to an OPEN polyline (the pit lane / river are open).
  function nearestDistOpen(poly, x, y) {
    let best = Infinity;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i], b = poly[i + 1];
      const d = distToSegment(x, y, a.x, a.y, b.x, b.y);
      if (d < best) best = d;
    }
    return best;
  }

  // Is (x,y) over water? Lakes are ellipses; rivers are wide polylines.
  function isWaterPoint(water, x, y) {
    if (!water) return false;
    for (const l of water.lakes || []) {
      const dx = (x - l.x) / l.rx, dy = (y - l.y) / l.ry;
      if (dx * dx + dy * dy <= 1) return true;
    }
    for (const r of water.rivers || []) {
      if (nearestDistOpen(r.pts, x, y) <= r.width / 2) return true;
    }
    return false;
  }

  // Project (x,y) onto the closed centreline: nearest point, its segment index,
  // distance and side. Used for the bridge corridor constraint.
  function project(track, x, y) {
    const c = track.centre, N = c.length;
    let best = Infinity, bi = 0, px = 0, py = 0;
    for (let i = 0; i < N; i++) {
      const a = c[i], b = c[(i + 1) % N];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1e-6;
      let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = a.x + t * dx, cy = a.y + t * dy;
      const d = Math.hypot(x - cx, y - cy);
      if (d < best) { best = d; bi = i; px = cx; py = cy; }
    }
    return { dist: best, idx: bi, px, py };
  }

  // Group a circular boolean array into contiguous runs of `true` indices.
  function groupCircular(flag) {
    const N = flag.length, groups = [];
    let start = 0;
    while (start < N && flag[start]) start++;
    if (start === N) return [Array.from({ length: N }, (_, i) => i)]; // all true
    let cur = null;
    for (let k = 0; k < N; k++) {
      const i = (start + k) % N;
      if (flag[i]) { if (!cur) { cur = []; groups.push(cur); } cur.push(i); }
      else cur = null;
    }
    return groups;
  }

  // Find the MAIN STRAIGHT: the contiguous arc of the lap with the least total
  // curvature (a min-curvature sliding window). This is the real-circuit choice
  // — pit lane and start/finish belong on the longest, fastest straight, never
  // mid-corner. Returns ordered sample indices in the direction of travel.
  function findMainStraight(centre, tangents) {
    const N = centre.length;
    const curv = new Array(N);
    for (let i = 0; i < N; i++) {
      const a = tangents[i], b = tangents[(i + 1) % N];
      curv[i] = Math.abs(a.x * b.y - a.y * b.x); // |cross| ~ turn rate
    }
    const W = Math.min(Math.max(Math.round(N * CONFIG.pit.straightFrac), 12), Math.floor(N * 0.32));
    let bestStart = 0, bestSum = Infinity;
    for (let s = 0; s < N; s++) {
      let sum = 0;
      for (let k = 0; k < W; k++) sum += curv[(s + k) % N];
      if (sum < bestSum) { bestSum = sum; bestStart = s; }
    }
    const idxs = [];
    for (let k = 0; k <= W; k++) idxs.push((bestStart + k) % N);
    return idxs;
  }

  /* ---- Build the full geometry for one track definition ------------------- */
  function build(def) {
    const centre = catmullRomClosed(def.controls, def.samples || 16);
    const N = centre.length;

    // Tangents (unit forward direction) and normals at each sample point.
    const tangents = [];
    const normals = [];
    for (let i = 0; i < N; i++) {
      const a = centre[(i - 1 + N) % N];
      const b = centre[(i + 1) % N];
      let tx = b.x - a.x, ty = b.y - a.y;
      const m = Math.hypot(tx, ty) || 1;
      tx /= m; ty /= m;
      tangents.push({ x: tx, y: ty });
      normals.push({ x: -ty, y: tx }); // 90deg rotation
    }

    const half = def.width / 2;

    // The main straight hosts BOTH the start/finish line and the pit lane.
    const sIdxs = findMainStraight(centre, tangents);
    const sfK = Math.round((sIdxs.length - 1) * CONFIG.pit.sfOffsetFrac);
    const sfIndex = sIdxs[sfK]; // start/finish sample — guaranteed on the straight

    // Checkpoint gates: gate 0 is the start/finish (on the straight); the other
    // sectors are spread evenly around the lap from there. Each gate spans the
    // road slightly wide so the car can't slip past the ends.
    const gates = [];
    const cpCount = def.checkpoints;
    for (let c = 0; c < cpCount; c++) {
      const idx = (sfIndex + Math.round((c / cpCount) * N)) % N;
      const p = centre[idx];
      const n = normals[idx];
      const w = half * 1.15;
      gates.push({
        index: c,
        isFinish: c === 0,
        centre: { x: p.x, y: p.y },
        tangent: tangents[idx],
        a: { x: p.x - n.x * w, y: p.y - n.y * w },
        b: { x: p.x + n.x * w, y: p.y + n.y * w },
      });
    }

    // Bounding box -> playable area (with a generous margin for grandstands).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of centre) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const margin = def.width * 2.8;
    const bounds = {
      minX: minX - margin, minY: minY - margin,
      maxX: maxX + margin, maxY: maxY + margin,
    };

    const water = def.water || { lakes: [], rivers: [] };

    // ---- Bridges: wherever the road crosses water it becomes a bridge -------
    // A sample is a bridge if it (or a near neighbour, so decks start on land)
    // sits over water. Contiguous runs become individual bridges with rails.
    const wet = centre.map((p) => isWaterPoint(water, p.x, p.y));
    const PAD = 2;
    const bridgeFlag = new Array(N).fill(false);
    for (let i = 0; i < N; i++) {
      for (let d = -PAD; d <= PAD; d++) { if (wet[(i + d + N) % N]) { bridgeFlag[i] = true; break; } }
    }
    const bridges = groupCircular(bridgeFlag);

    const pit = buildPitLane(centre, tangents, normals, sIdxs, half);
    const hazards = buildHazards(centre, tangents, normals, half, def, sIdxs, water);
    const trees = scatterTrees(centre, bounds, half, pit, def, water);

    // Starting pose: on the straight, just behind the start/finish line.
    const startTan = gates[0].tangent;
    const start = {
      x: gates[0].centre.x - startTan.x * 80,
      y: gates[0].centre.y - startTan.y * 80,
      heading: Math.atan2(startTan.x, -startTan.y), // 0 == up
    };

    return {
      id: def.id, name: def.name, theme: def.theme,
      width: def.width, half,
      centre, tangents, normals, gates, bounds, trees, start,
      hazards, pit, straight: sIdxs,
      water, bridges, bridgeFlag,
      checkpointCount: cpCount,
    };
  }

  /* ---- Pit lane: an offset polyline PARALLEL to the main straight ---------
   * The lane centreline starts on the racing line (o = 0), tapers smoothly out
   * to a full offset (laneSep), runs parallel past the boxes, then tapers back
   * onto the racing line BEFORE the corner — leaving room to accelerate. Because
   * the tapers reach o = 0 the lane is physically continuous with the track (no
   * grass gap to cross), and the parallel "active" middle is the limiter zone. A
   * median + pit wall separates the lane from the track, exactly like a real
   * circuit. -------------------------------------------------------------- */
  function buildPitLane(centre, tangents, normals, sIdxs, half) {
    const P = CONFIG.pit;
    const M = sIdxs.length;
    const laneSep = half + P.median + P.laneWidth / 2;

    // Choose the side with the most open space (sample the middle of the straight).
    const midSample = sIdxs[Math.floor(M / 2)];
    const nm = normals[midSample], pm = centre[midSample];
    const room = (s) => nearestDist(centre, pm.x + nm.x * s * laneSep, pm.y + nm.y * s * laneSep);
    const side = room(1) >= room(-1) ? 1 : -1;

    const R = Math.max(3, Math.round(M * 0.24)); // taper length (samples)
    const padE = Math.max(2, Math.round(M * 0.12)); // straight left to accelerate after merge
    const lanePoly = [], active = [];
    for (let k = 0; k < M; k++) {
      const idx = sIdxs[k];
      const up = k / R;
      const down = ((M - 1 - padE) - k) / R;
      const o = laneSep * smoothstep(Math.min(up, down, 1));
      lanePoly.push({ x: centre[idx].x + normals[idx].x * side * o, y: centre[idx].y + normals[idx].y * side * o });
      active.push(o >= laneSep * 0.7);
    }

    // Pit box at the centre of the parallel plateau.
    const midK = MathClamp(Math.round((R + (M - 1 - padE)) / 2), 0, M - 1);
    const boxDir = tangents[sIdxs[midK]];
    const box = { x: lanePoly[midK].x, y: lanePoly[midK].y };

    // ---- Atmosphere geometry (precomputed; render just draws it) ----
    const activeKs = [];
    for (let k = 0; k < M; k++) if (active[k]) activeKs.push(k);

    // Pit wall: a barrier between the lane and the track, along the active zone.
    const wall = activeKs.map((k) => {
      const idx = sIdxs[k], n = normals[idx];
      return { x: centre[idx].x + n.x * side * (half + P.median * 0.55), y: centre[idx].y + n.y * side * (half + P.median * 0.55) };
    });

    // Team garages: a row behind the boxes (far side of the lane).
    const garages = [];
    const garageCount = 8;
    for (let g = 0; g < garageCount && activeKs.length; g++) {
      const k = activeKs[Math.round((g + 0.5) / garageCount * (activeKs.length - 1))];
      const idx = sIdxs[k], n = normals[idx], t = tangents[idx];
      garages.push({
        x: lanePoly[k].x + n.x * side * (P.laneWidth / 2 + P.garageDepth / 2),
        y: lanePoly[k].y + n.y * side * (P.laneWidth / 2 + P.garageDepth / 2),
        angle: Math.atan2(t.y, t.x),
      });
    }

    // Grandstands: opposite side of the racing line from the pit.
    const grandstands = [];
    const standCount = 3;
    for (let s = 0; s < standCount; s++) {
      const k = Math.round((s + 0.5) / standCount * (M - 1));
      const idx = sIdxs[k], n = normals[idx], t = tangents[idx];
      grandstands.push({
        x: centre[idx].x - n.x * side * (half + 130),
        y: centre[idx].y - n.y * side * (half + 130),
        angle: Math.atan2(t.y, t.x), len: 280,
      });
    }

    // Trackside floodlight poles down the straight (stand side).
    const lights = [];
    for (let s = 0; s < 5; s++) {
      const k = Math.round((s + 0.5) / 5 * (M - 1));
      const idx = sIdxs[k], n = normals[idx];
      lights.push({ x: centre[idx].x - n.x * side * (half + 46), y: centre[idx].y - n.y * side * (half + 46) });
    }

    return {
      side, laneSep, width: P.laneWidth,
      lanePoly, active,
      box, boxDir, boxAngle: Math.atan2(boxDir.y, boxDir.x),
      entry: lanePoly[0], exit: lanePoly[M - 1],
      garages, grandstands, lights, wall,
    };
  }

  function MathClamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Gravel / sand run-off traps on the sharpest corners (never on the straight).
  function buildHazards(centre, tangents, normals, half, def, sIdxs, water) {
    const N = centre.length;
    const straightSet = new Set(sIdxs);
    const curv = [];
    for (let i = 0; i < N; i++) {
      const a = tangents[i], b = tangents[(i + 1) % N];
      curv.push(Math.abs(a.x * b.y - a.y * b.x));
    }
    const peaks = [];
    const minSpacing = Math.max(8, Math.floor(N / 14));
    for (let i = 0; i < N; i++) {
      if (curv[i] < 0.05 || straightSet.has(i)) continue;
      if (curv[i] >= curv[(i - 1 + N) % N] && curv[i] >= curv[(i + 1) % N]) peaks.push({ i, c: curv[i] });
    }
    peaks.sort((p, q) => q.c - p.c);
    const chosen = [];
    for (const p of peaks) {
      if (chosen.every((c) => Math.abs(c - p.i) > minSpacing && Math.abs(c - p.i) < N - minSpacing)) chosen.push(p.i);
      if (chosen.length >= (def.hazardCount ?? 4)) break;
    }
    const hazards = [];
    chosen.forEach((idx, k) => {
      const p = centre[idx], n = normals[idx];
      const r = half * 1.25, gap = 10, dist = half + gap + r * 0.55;
      const cA = { x: p.x + n.x * dist, y: p.y + n.y * dist };
      const cB = { x: p.x - n.x * dist, y: p.y - n.y * dist };
      const c = nearestDist(centre, cA.x, cA.y) >= nearestDist(centre, cB.x, cB.y) ? cA : cB;
      if (nearestDist(centre, c.x, c.y) <= half) return;
      if (isWaterPoint(water, c.x, c.y)) return; // no gravel traps in the water
      hazards.push({ type: k % 3 === 2 ? 'sand' : 'gravel', x: c.x, y: c.y, r });
    });
    return hazards;
  }

  // Scatter trees on open grass — never on road, pit lane, grandstands or water.
  function scatterTrees(centre, bounds, half, pit, def, water) {
    const rand = mulberry32(def.seed || def.id * 7919);
    const trees = [];
    const target = def.trees ?? 60;
    let guard = 0;
    while (trees.length < target && guard < target * 40) {
      guard++;
      const x = bounds.minX + rand() * (bounds.maxX - bounds.minX);
      const y = bounds.minY + rand() * (bounds.maxY - bounds.minY);
      if (nearestDist(centre, x, y) <= half + 70) continue;
      if (nearestDistOpen(pit.lanePoly, x, y) <= pit.width * 1.4) continue;
      if (isWaterPoint(water, x, y)) continue;
      let blocked = false;
      for (const g of pit.garages) if (Math.hypot(x - g.x, y - g.y) < 130) { blocked = true; break; }
      if (!blocked) for (const s of pit.grandstands) if (Math.hypot(x - s.x, y - s.y) < 230) { blocked = true; break; }
      if (blocked) continue;
      trees.push({ x, y, r: 26 + rand() * 26 });
    }
    return trees;
  }

  // Is (x,y) in the pit-lane LIMITER zone (the parallel, active middle only)?
  function pointInPit(track, x, y) {
    const pit = track.pit, poly = pit.lanePoly, act = pit.active;
    let best = Infinity;
    for (let i = 0; i < poly.length - 1; i++) {
      if (!act[i] || !act[i + 1]) continue; // skip the tapered entry/exit
      const d = distToSegment(x, y, poly[i].x, poly[i].y, poly[i + 1].x, poly[i + 1].y);
      if (d < best) best = d;
    }
    return best <= pit.width / 2;
  }

  // Resolve the surface type at a world point (road/kerb/grass/gravel/sand).
  function surfaceAt(track, x, y) {
    // The whole pit lane — including the tapered entry/exit — is tarmac, so
    // branching off and merging back never crosses grass.
    if (nearestDistOpen(track.pit.lanePoly, x, y) <= track.pit.width / 2) return 'road';
    const d = nearestDist(track.centre, x, y);
    if (d <= track.half) return 'road'; // bridge decks land here too
    if (d <= track.half + KERB) return 'kerb';
    if (isWaterPoint(track.water, x, y)) return 'water'; // off the deck = open water
    for (const h of track.hazards) {
      if (Math.hypot(x - h.x, y - h.y) <= h.r) return h.type;
    }
    return 'grass';
  }

  // Min distance from (x,y) to the centreline polyline (closed loop).
  function nearestDist(centre, x, y) {
    let best = Infinity;
    const N = centre.length;
    for (let i = 0; i < N; i++) {
      const a = centre[i];
      const b = centre[(i + 1) % N];
      const d = distToSegment(x, y, a.x, a.y, b.x, b.y);
      if (d < best) best = d;
    }
    return best;
  }

  /* ---- Track definitions (control points trace the racing line) -----------
   * Each layout now includes a deliberate LONG MAIN STRAIGHT (a run of near-
   * collinear control points). The straight detector finds it automatically and
   * places the start/finish line and pit lane there — just like a real circuit.
   * (Layouts were revised for this; best-time records use a fresh storage key.)
   * -------------------------------------------------------------------------- */
  const DEFS = [
    {
      // Long straight across the TOP (y ~ 430).
      id: 1, name: 'Roalingway', theme: 'meadow', seed: 101,
      width: 230, checkpoints: 5, samples: 18, trees: 70,
      controls: [
        { x: 720, y: 440 }, { x: 1500, y: 425 }, { x: 2300, y: 425 }, { x: 3050, y: 450 },
        { x: 3450, y: 900 }, { x: 3300, y: 1450 },
        { x: 2550, y: 1650 }, { x: 1750, y: 1700 }, { x: 1050, y: 1750 },
        { x: 520, y: 1500 }, { x: 360, y: 1050 }, { x: 440, y: 680 },
      ],
    },
    {
      // Long straight across the TOP (y ~ 410).
      id: 2, name: 'Bridger', theme: 'lake', seed: 202,
      width: 250, checkpoints: 6, samples: 20, trees: 64,
      controls: [
        { x: 760, y: 430 }, { x: 1700, y: 405 }, { x: 2700, y: 410 }, { x: 3450, y: 520 },
        { x: 3700, y: 1150 }, { x: 3500, y: 1800 },
        { x: 2600, y: 2080 }, { x: 1500, y: 2100 },
        { x: 650, y: 1850 }, { x: 360, y: 1200 }, { x: 400, y: 740 },
      ],
    },
    {
      // Twisty top, then a long straight along the BOTTOM (y ~ 1860).
      id: 3, name: 'Crazy Road', theme: 'desert', seed: 303,
      width: 210, checkpoints: 7, samples: 16, trees: 50,
      controls: [
        { x: 600, y: 640 }, { x: 1150, y: 380 }, { x: 1700, y: 800 },
        { x: 2400, y: 470 }, { x: 3150, y: 700 }, { x: 3320, y: 1280 },
        { x: 2800, y: 1860 }, { x: 2000, y: 1885 }, { x: 1200, y: 1885 }, { x: 600, y: 1830 },
        { x: 360, y: 1300 }, { x: 560, y: 820 },
      ],
    },
    {
      // Long straight along the TOP (y ~ 430).
      id: 4, name: 'Loopingpool', theme: 'night', seed: 404,
      width: 220, checkpoints: 6, samples: 18, trees: 58,
      controls: [
        { x: 900, y: 460 }, { x: 1700, y: 420 }, { x: 2600, y: 425 }, { x: 3300, y: 470 },
        { x: 3520, y: 1000 }, { x: 3250, y: 1560 },
        { x: 2500, y: 1660 }, { x: 2050, y: 1250 }, { x: 1850, y: 1660 },
        { x: 1150, y: 1700 }, { x: 560, y: 1450 }, { x: 420, y: 950 },
      ],
    },
    {
      // RIVERSIDE — the long, scenic circuit. A big loop with a long main
      // straight (top-left, on land), fast sweeps down the right, a slow
      // technical/hairpin section along the bottom, and TWO bridges over a
      // meandering river, plus infield lakes. Significantly longer than the rest.
      id: 5, name: 'Riverside GP', theme: 'riverside', seed: 505,
      width: 240, checkpoints: 8, samples: 16, trees: 95, hazardCount: 5,
      controls: [
        { x: 650, y: 440 }, { x: 1500, y: 420 }, { x: 2350, y: 430 }, // main straight
        { x: 2900, y: 560 }, { x: 3150, y: 820 },                     // -> bridge 1
        { x: 3700, y: 950 }, { x: 4250, y: 1150 },                    // fast sweep
        { x: 4560, y: 1700 }, { x: 4400, y: 2300 },                   // right-hand sweepers
        { x: 3800, y: 2560 }, { x: 3050, y: 2520 },                   // -> bridge 2
        { x: 2450, y: 2360 }, { x: 2050, y: 2620 }, { x: 1500, y: 2450 }, // technical chicane
        { x: 900, y: 2350 }, { x: 620, y: 1850 },                     // hairpin
        { x: 520, y: 1250 }, { x: 560, y: 760 },                      // back straight (left)
      ],
      water: {
        lakes: [
          { x: 1650, y: 1450, rx: 430, ry: 300 },
          { x: 4150, y: 1780, rx: 360, ry: 300 },
        ],
        rivers: [
          { width: 330, pts: [
            { x: 3000, y: 320 }, { x: 2960, y: 1100 }, { x: 3020, y: 1700 },
            { x: 3060, y: 2300 }, { x: 2980, y: 2900 },
          ] },
        ],
      },
    },
  ];

  // Theme colour palettes for dark-mode rendering.
  const THEMES = {
    meadow:    { grass: '#14321f', grassAlt: '#173a24', road: '#2b2f36', edge: '#3c424b', tree: '#1f6b3a', treeDark: '#15502b', water: '#10324a', waterEdge: '#1b4e6e' },
    lake:      { grass: '#102a30', grassAlt: '#123238', road: '#2a2e35', edge: '#3a4049', tree: '#1f6b5a', treeDark: '#134b40', water: '#0e3346', waterEdge: '#176486' },
    desert:    { grass: '#2e2616', grassAlt: '#352b18', road: '#33302a', edge: '#46413a', tree: '#6b5a1f', treeDark: '#50431a', water: '#13384a', waterEdge: '#1d5570' },
    night:     { grass: '#161826', grassAlt: '#1b1d2e', road: '#262833', edge: '#363a4a', tree: '#2a3b6b', treeDark: '#1d2b50', water: '#0c1830', waterEdge: '#143a5e' },
    riverside: { grass: '#13301d', grassAlt: '#173a24', road: '#2b2f36', edge: '#3c424b', tree: '#1f6b3a', treeDark: '#155029', water: '#0f3a54', waterEdge: '#1c5f84' },
  };

  const built = DEFS.map(build);

  return {
    all: built,
    byId: (id) => built.find((t) => t.id === id) || built[0],
    theme: (name) => THEMES[name] || THEMES.meadow,
    nearestDist,
    segmentsIntersect,
    surfaceAt,
    pointInPit,
    project,
    isWater: (track, x, y) => isWaterPoint(track.water, x, y),
    KERB,
  };
})();
