/* =============================================================================
 * ui.js — Menus / selectors (track & garage overlays)
 * -----------------------------------------------------------------------------
 * Builds the Tailwind overlay grids for choosing a track or a car, and wires
 * the top-bar buttons. All game state changes go through window.GameAPI, which
 * game.js publishes once it has booted.
 * ========================================================================== */

const UI = (() => {
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayBody = document.getElementById('overlay-body');

  function open(kind) {
    overlayBody.innerHTML = '';
    if (kind === 'tracks') {
      overlayTitle.textContent = 'SELECT TRACK';
      Track.all.forEach((t) => overlayBody.appendChild(trackCard(t)));
    } else {
      overlayTitle.textContent = 'SELECT CAR';
      CAR_DATA.forEach((c) => overlayBody.appendChild(carCard(c)));
    }
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
  }

  function close() {
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
  }

  // ---- Track card: shows a mini SVG preview of the actual centreline --------
  function trackCard(t) {
    const el = document.createElement('button');
    const active = window.GameAPI && window.GameAPI.currentTrackId() === t.id;
    el.className =
      'group rounded-xl overflow-hidden border text-left transition-all ' +
      (active ? 'border-apex-accent2 ring-1 ring-apex-accent2' : 'border-apex-line hover:border-apex-accent2');
    const best = loadBest(t.id);
    el.innerHTML = `
      <div class="aspect-video bg-apex-panel2 flex items-center justify-center p-3">
        ${trackPreviewSvg(t)}
      </div>
      <div class="px-3 py-2 bg-apex-panel">
        <div class="font-display font-bold text-sm">${t.name}</div>
        <div class="text-[11px] text-apex-mut flex justify-between mt-0.5">
          <span>${t.checkpointCount} sectors</span>
          <span class="text-apex-accent2 tab-num">${best ? TimingSystem.format(best.time) : 'no record'}</span>
        </div>
      </div>`;
    el.onclick = () => { window.GameAPI.selectTrack(t.id); close(); };
    return el;
  }

  // A small inline SVG drawing of the centreline, normalised to a viewBox.
  function trackPreviewSvg(t) {
    const b = t.bounds;
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const pts = t.centre.map((p) => `${(p.x - b.minX).toFixed(0)},${(p.y - b.minY).toFixed(0)}`).join(' ');
    const sw = Math.max(w, h) * 0.06;
    const fin = t.gates[0].centre;
    return `<svg viewBox="0 0 ${w} ${h}" class="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <polygon points="${pts}" fill="none" stroke="#2b2f36" stroke-width="${sw * 1.4}" stroke-linejoin="round"/>
        <polygon points="${pts}" fill="none" stroke="#3b4150" stroke-width="${sw}" stroke-linejoin="round"/>
        <circle cx="${(fin.x - b.minX).toFixed(0)}" cy="${(fin.y - b.minY).toFixed(0)}" r="${sw}" fill="#22d3ee"/>
      </svg>`;
  }

  // ---- Car card -------------------------------------------------------------
  function carCard(c) {
    const el = document.createElement('button');
    const active = window.GameAPI && window.GameAPI.currentCarId() === c.id;
    el.className =
      'group rounded-xl overflow-hidden border text-left transition-all ' +
      (active ? 'border-apex-accent2 ring-1 ring-apex-accent2' : 'border-apex-line hover:border-apex-accent2');
    // F1 cars are drawn procedurally; road cars use their PNG sprite.
    const thumb = c.type === 'f1' ? F1.thumbnail(c.livery) : c.sprite;
    const badge = c.class
      ? `<span class="text-[9px] tracking-widest text-apex-accent2 bg-apex-accent2/10 px-1.5 py-0.5 rounded">${c.class}</span>`
      : '';
    el.innerHTML = `
      <div class="aspect-square bg-apex-panel2 flex items-center justify-center p-4 relative">
        ${badge ? `<div class="absolute top-2 left-2">${badge}</div>` : ''}
        <img src="${thumb}" alt="${c.name}" class="car-thumb max-h-24 object-contain drop-shadow-lg" />
      </div>
      <div class="px-3 py-2 bg-apex-panel">
        <div class="font-display font-bold text-sm flex items-center justify-between">
          ${c.name}
          <span class="w-2.5 h-2.5 rounded-full" style="background:${c.color}"></span>
        </div>
        ${statBar('SPD', (c.topSpeed - 180) / 180)}
        ${statBar('ACC', (c.accel - 0.8) / 0.6)}
        ${statBar('GRP', (c.grip - 0.9) / 0.4)}
        ${statBar('BRK', (c.braking - 0.9) / 0.5)}
      </div>`;
    el.onclick = () => { window.GameAPI.selectCar(c.id); close(); };
    return el;
  }

  function statBar(label, frac) {
    frac = Math.max(0.08, Math.min(1, frac));
    return `<div class="flex items-center gap-2 mt-1">
        <span class="text-[9px] tracking-widest text-apex-mut w-7">${label}</span>
        <div class="flex-1 h-1.5 rounded-full bg-apex-panel2 overflow-hidden">
          <div class="h-full bg-apex-accent2" style="width:${(frac * 100).toFixed(0)}%"></div>
        </div>
      </div>`;
  }

  function loadBest(trackId) {
    try {
      const raw = localStorage.getItem(`cds_best_v2_${trackId}`);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  // ---- Wire up buttons ------------------------------------------------------
  function init() {
    document.getElementById('btn-tracks').onclick = () => open('tracks');
    document.getElementById('btn-cars').onclick = () => open('cars');
    document.getElementById('btn-restart').onclick = () => window.GameAPI.restart();
    document.getElementById('overlay-close').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  return { init, open, close };
})();
