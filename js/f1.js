/* =============================================================================
 * f1.js — Procedural Formula 1-style car renderer (deliverable #1)
 * -----------------------------------------------------------------------------
 * The F1 cars are DRAWN, not loaded from images. This is a deliberate choice:
 *   - zero licensed/copyrighted assets — every shape is generated here
 *   - razor-sharp at any zoom (vector, not raster)
 *   - each car is just a livery (3 colours), so adding cars is trivial
 * The silhouette reads as a modern open-wheeler: narrow tub, exposed wheels,
 * wide front & rear wings, sidepods, cockpit + halo. Drawn in local space with
 * the nose pointing "up" (-Y) so it matches the heading convention everywhere.
 * ========================================================================== */

const F1 = (() => {
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Draw an F1 car centred at the origin, nose toward -Y, total length L.
  function draw(ctx, L, livery) {
    const body = livery.body || '#c9ccd2';
    const accent = livery.accent || '#e11d2a';
    const wing = livery.wing || '#15181f';
    const hw = L * 0.13; // chassis half-width

    // --- Wheels (behind the body) ---
    const wL = L * 0.19, wW = L * 0.09;
    const fy = -L * 0.27, ry = L * 0.30, fx = L * 0.26, rx = L * 0.28;
    ctx.fillStyle = '#0b0d11';
    for (const [wx, wy] of [[-fx, fy], [fx, fy], [-rx, ry], [rx, ry]]) {
      rr(ctx, wx - wW / 2, wy - wL / 2, wW, wL, wW * 0.32); ctx.fill();
    }
    // wheel sheen
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (const [wx, wy] of [[-fx, fy], [fx, fy], [-rx, ry], [rx, ry]]) {
      rr(ctx, wx - wW / 2, wy - wL / 2, wW * 0.4, wL, wW * 0.2); ctx.fill();
    }

    // --- Rear wing ---
    ctx.fillStyle = wing;
    rr(ctx, -L * 0.25, L * 0.41, L * 0.50, L * 0.075, 3); ctx.fill();
    ctx.fillStyle = accent;
    rr(ctx, -L * 0.25, L * 0.41, L * 0.50, L * 0.022, 2); ctx.fill();

    // --- Front wing ---
    ctx.fillStyle = wing;
    rr(ctx, -L * 0.24, -L * 0.50, L * 0.48, L * 0.06, 3); ctx.fill();
    ctx.fillStyle = accent;
    rr(ctx, -L * 0.24, -L * 0.485, L * 0.48, L * 0.018, 2); ctx.fill();

    // --- Chassis / body (tapered tub with sidepods) ---
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(0, -L * 0.47);
    ctx.quadraticCurveTo(hw * 0.55, -L * 0.30, hw * 0.7, -L * 0.05);
    ctx.lineTo(hw * 1.08, L * 0.06);   // sidepod widest point
    ctx.quadraticCurveTo(hw * 1.12, L * 0.30, hw * 0.5, L * 0.40);
    ctx.lineTo(-hw * 0.5, L * 0.40);
    ctx.quadraticCurveTo(-hw * 1.12, L * 0.30, -hw * 1.08, L * 0.06);
    ctx.lineTo(-hw * 0.7, -L * 0.05);
    ctx.quadraticCurveTo(-hw * 0.55, -L * 0.30, 0, -L * 0.47);
    ctx.closePath();
    ctx.fill();

    // --- Centre accent stripe ---
    ctx.fillStyle = accent;
    rr(ctx, -L * 0.028, -L * 0.44, L * 0.056, L * 0.8, 2); ctx.fill();

    // --- Airbox behind the cockpit ---
    ctx.fillStyle = wing;
    rr(ctx, -hw * 0.34, L * 0.06, hw * 0.68, L * 0.2, 3); ctx.fill();

    // --- Cockpit + halo ---
    ctx.fillStyle = '#05070b';
    ctx.beginPath();
    ctx.ellipse(0, -L * 0.04, hw * 0.5, L * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0b0d11';
    ctx.lineWidth = L * 0.028;
    ctx.beginPath();
    ctx.arc(0, -L * 0.10, hw * 0.52, Math.PI * 0.12, Math.PI * 0.88);
    ctx.stroke();
  }

  // Produce a garage thumbnail (data URL) for a livery.
  function thumbnail(livery, size = 140) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    g.translate(size / 2, size / 2);
    draw(g, size * 0.9, livery);
    return c.toDataURL('image/png');
  }

  return { draw, thumbnail };
})();
