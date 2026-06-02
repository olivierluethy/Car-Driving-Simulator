/* =============================================================================
 * minimap.js — Real-time circuit minimap (Feature 1)
 * -----------------------------------------------------------------------------
 * Performance is the headline decision: the track outline never changes during a
 * session, so it is rasterised ONCE per track onto an offscreen canvas (the
 * "static layer") via a world->minimap transform derived from the centreline's
 * bounding box (this auto-scales to any track size). Every frame we only:
 *   1. blit that cached layer, and
 *   2. stamp a small heading-oriented triangle for the car.
 * So the per-frame cost is a single drawImage + a few path ops — it stays smooth
 * regardless of how long or detailed the circuit is.
 *
 * The static layer mirrors the main view's dark-mode look: water, tarmac, pit
 * lane, sector dots and a bright start/finish line, so the map reads instantly.
 * ========================================================================== */

const Minimap = (() => {
  let canvas, ctx;
  let stat, sctx; // offscreen static layer
  let dpr = 1, W = 0, H = 0; // CSS pixel size of the minimap
  let track = null;
  let tf = null; // world -> minimap transform {scale, ox, oy}

  const PAD = 12; // inner padding (minimap px)

  function init() {
    canvas = document.getElementById('minimap');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    stat = document.createElement('canvas');
    sctx = stat.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = r.width || 208; H = r.height || 150;
    canvas.width = W * dpr; canvas.height = H * dpr;
    stat.width = W * dpr; stat.height = H * dpr;
    if (track) { buildTransform(); renderStatic(); }
  }

  // Fit the centreline's bounding box into the minimap (preserving aspect).
  function buildTransform() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of track.centre) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const tw = maxX - minX, th = maxY - minY;
    const scale = Math.min((W - PAD * 2) / tw, (H - PAD * 2) / th);
    tf = {
      scale,
      ox: PAD + (W - PAD * 2 - tw * scale) / 2 - minX * scale,
      oy: PAD + (H - PAD * 2 - th * scale) / 2 - minY * scale,
    };
  }

  const wx = (x) => x * tf.scale + tf.ox;
  const wy = (y) => y * tf.scale + tf.oy;

  function strokeWorldPoly(c, pts, closed, w, style) {
    c.beginPath();
    c.moveTo(wx(pts[0].x), wy(pts[0].y));
    for (let i = 1; i < pts.length; i++) c.lineTo(wx(pts[i].x), wy(pts[i].y));
    if (closed) c.closePath();
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.strokeStyle = style; c.lineWidth = w; c.stroke();
  }

  function setTrack(t) {
    track = t;
    if (!canvas) return;
    buildTransform();
    renderStatic();
  }

  // Rasterise the unchanging track art to the offscreen layer.
  function renderStatic() {
    const theme = Track.theme(track.theme);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.clearRect(0, 0, W, H);

    // panel backdrop
    sctx.fillStyle = '#0c0f15';
    sctx.fillRect(0, 0, W, H);

    // water
    const w = track.water;
    if (w) {
      (w.lakes || []).forEach((l) => {
        sctx.fillStyle = theme.water;
        sctx.beginPath();
        sctx.ellipse(wx(l.x), wy(l.y), l.rx * tf.scale, l.ry * tf.scale, 0, 0, Math.PI * 2);
        sctx.fill();
      });
      (w.rivers || []).forEach((r) => strokeWorldPoly(sctx, r.pts, false, Math.max(2, r.width * tf.scale), theme.water));
    }

    // road (outline + tarmac), scaled road width with sensible floor
    const roadW = Math.max(3, track.width * tf.scale);
    strokeWorldPoly(sctx, track.centre, true, roadW + 2, '#3c424b');
    strokeWorldPoly(sctx, track.centre, true, roadW, '#2b2f36');

    // pit lane
    if (track.pit && track.pit.lanePoly) {
      strokeWorldPoly(sctx, track.pit.lanePoly, false, Math.max(2, track.pit.width * tf.scale * 0.8), '#22343d');
    }

    // bridges — brighten the deck so crossings stand out
    (track.bridges || []).forEach((idxList) => {
      if (idxList.length < 2) return;
      const pts = idxList.map((i) => track.centre[i]);
      strokeWorldPoly(sctx, pts, false, roadW, '#454b57');
    });

    // sector checkpoints
    track.gates.forEach((g) => {
      if (g.isFinish) return;
      sctx.fillStyle = 'rgba(34,211,238,0.7)';
      sctx.beginPath();
      sctx.arc(wx(g.centre.x), wy(g.centre.y), 2.6, 0, Math.PI * 2);
      sctx.fill();
    });

    // start/finish line (bright marker across the road)
    const sf = track.gates[0];
    const n = { x: -sf.tangent.y, y: sf.tangent.x };
    const hw = track.half;
    sctx.strokeStyle = '#f8fafc';
    sctx.lineWidth = 3;
    sctx.beginPath();
    sctx.moveTo(wx(sf.centre.x - n.x * hw), wy(sf.centre.y - n.y * hw));
    sctx.lineTo(wx(sf.centre.x + n.x * hw), wy(sf.centre.y + n.y * hw));
    sctx.stroke();
  }

  // Per-frame: blit the cached layer + draw the car marker (position + heading).
  function draw(car) {
    if (!canvas || !tf) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(stat, 0, 0, W * dpr, H * dpr, 0, 0, W, H);

    const cx = wx(car.x), cy = wy(car.y);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(car.heading); // sprite/marker convention: 0 == pointing up
    // glow
    ctx.fillStyle = 'rgba(225,29,42,0.35)';
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
    // heading triangle
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fillStyle = '#e11d2a';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  return { init, setTrack, draw, resize };
})();
