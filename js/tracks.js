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

    // Checkpoint gates: index 0 is the start/finish, the rest are evenly spaced
    // sectors. Each gate is a segment spanning the road, slightly wider than the
    // road so the car can't slip past the ends.
    const gates = [];
    const cpCount = def.checkpoints;
    for (let c = 0; c < cpCount; c++) {
      const idx = Math.round((c / cpCount) * N) % N;
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

    // Bounding box -> playable area (with a generous margin of grass).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of centre) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const margin = def.width * 2.2;
    const bounds = {
      minX: minX - margin, minY: minY - margin,
      maxX: maxX + margin, maxY: maxY + margin,
    };

    // Scatter trees on the grass, never on the road.
    const rand = mulberry32(def.seed || def.id * 7919);
    const trees = [];
    const targetTrees = def.trees ?? 60;
    let guard = 0;
    while (trees.length < targetTrees && guard < targetTrees * 30) {
      guard++;
      const x = bounds.minX + rand() * (bounds.maxX - bounds.minX);
      const y = bounds.minY + rand() * (bounds.maxY - bounds.minY);
      const d = nearestDist(centre, x, y);
      if (d > half + 70) {
        trees.push({ x, y, r: 26 + rand() * 26 });
      }
    }

    // Starting pose: just behind the finish line, facing along the track.
    const startTan = gates[0].tangent;
    const startHeading = Math.atan2(startTan.x, -startTan.y); // 0 == up
    const start = {
      x: gates[0].centre.x - startTan.x * 70,
      y: gates[0].centre.y - startTan.y * 70,
      heading: startHeading,
    };

    return {
      id: def.id, name: def.name, theme: def.theme,
      width: def.width, half,
      centre, tangents, normals, gates, bounds, trees, start,
      checkpointCount: cpCount,
    };
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

  /* ---- Track definitions (control points trace the racing line) ----------- */
  const DEFS = [
    {
      id: 1, name: 'Roalingway', theme: 'meadow', seed: 101,
      width: 230, checkpoints: 5, samples: 18, trees: 70,
      controls: [
        { x: 600, y: 500 }, { x: 1600, y: 480 }, { x: 2700, y: 560 },
        { x: 3400, y: 1000 }, { x: 3050, y: 1550 }, { x: 2100, y: 1500 },
        { x: 1500, y: 1750 }, { x: 700, y: 1850 }, { x: 320, y: 1300 },
        { x: 360, y: 820 },
      ],
    },
    {
      id: 2, name: 'Bridger', theme: 'lake', seed: 202,
      width: 250, checkpoints: 6, samples: 20, trees: 64,
      controls: [
        { x: 700, y: 420 }, { x: 2600, y: 380 }, { x: 3500, y: 700 },
        { x: 3650, y: 1500 }, { x: 3300, y: 2050 }, { x: 2200, y: 2150 },
        { x: 1200, y: 2000 }, { x: 520, y: 1650 }, { x: 360, y: 950 },
      ],
    },
    {
      id: 3, name: 'Crazy Road', theme: 'desert', seed: 303,
      width: 200, checkpoints: 7, samples: 16, trees: 50,
      controls: [
        { x: 500, y: 600 }, { x: 1200, y: 350 }, { x: 1700, y: 800 },
        { x: 2400, y: 450 }, { x: 3200, y: 700 }, { x: 3300, y: 1350 },
        { x: 2600, y: 1300 }, { x: 2400, y: 1850 }, { x: 1700, y: 1600 },
        { x: 1300, y: 2050 }, { x: 700, y: 1750 }, { x: 900, y: 1100 },
        { x: 380, y: 1050 },
      ],
    },
    {
      id: 4, name: 'Loopingpool', theme: 'night', seed: 404,
      width: 220, checkpoints: 6, samples: 18, trees: 58,
      controls: [
        { x: 1900, y: 380 }, { x: 2900, y: 560 }, { x: 3300, y: 1150 },
        { x: 2850, y: 1650 }, { x: 2050, y: 1500 }, { x: 1850, y: 950 },
        { x: 1550, y: 1500 }, { x: 700, y: 1650 }, { x: 360, y: 1100 },
        { x: 760, y: 560 },
      ],
    },
  ];

  // Theme colour palettes for dark-mode rendering.
  const THEMES = {
    meadow: { grass: '#14321f', grassAlt: '#173a24', road: '#2b2f36', edge: '#3c424b', tree: '#1f6b3a', treeDark: '#15502b' },
    lake:   { grass: '#102a30', grassAlt: '#123238', road: '#2a2e35', edge: '#3a4049', tree: '#1f6b5a', treeDark: '#134b40' },
    desert: { grass: '#2e2616', grassAlt: '#352b18', road: '#33302a', edge: '#46413a', tree: '#6b5a1f', treeDark: '#50431a' },
    night:  { grass: '#161826', grassAlt: '#1b1d2e', road: '#262833', edge: '#363a4a', tree: '#2a3b6b', treeDark: '#1d2b50' },
  };

  const built = DEFS.map(build);

  return {
    all: built,
    byId: (id) => built.find((t) => t.id === id) || built[0],
    theme: (name) => THEMES[name] || THEMES.meadow,
    nearestDist,
    segmentsIntersect,
  };
})();
