// Cartoon map of New York City for MTA Manager mode: real shorelines, real MTA route geometry,
// animated trains, platform crowds, fares popping out of stations, incidents and landmarks.
//
// Detail is tiered by zoom so the map stays readable:
//   overview  — lines, small train pills, crowd rings, area names
//   district  — + route bullets on trains, names of the busiest hubs
//   street    — + every station name (collision-free), landmark names
// Exact numbers live in the hover tooltip and the selection card, not on the map.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const U = SC.util, net = SC.net, C = SC.content, ICON = SC.icons, AU = SC.audio;
  const INK = '#1d1d24';
  const BORO_FILL = { M: '#ffe8a3', Bk: '#ffd2a8', Q: '#e7f0a8', Bx: '#ffc9c4', SI: '#cdeec0' };
  const WATER = '#6fc3ea', WATER_DARK = '#4aa8d6';
  const CROWD = { calm: [122, 92, 255], busy: [255, 160, 30], packed: [255, 59, 59] };
  const TIER_DISTRICT = 1.45, TIER_STREET = 2.5;

  class MapView extends U.Emitter {
    constructor(canvas, sim) {
      super();
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.sim = sim;
      this.cx = 0; this.cy = 0; this.zoom = 0.03; this.target = null; this.refZoom = 0.03;
      this.selected = null; this.hover = null; this.hoverPt = null; this.highlightRoute = null;
      this.floaters = []; this.particles = []; this.tapTimer = 0; this.time = 0;
      this.buildPaths();
      this.bindInput();
      this.resize();
      this.fitHome(true);
    }

    buildPaths() {
      const ring = (p, r) => { for (let i = 0; i < r.length; i += 2) i ? p.lineTo(r[i], r[i + 1]) : p.moveTo(r[i], r[i + 1]); p.closePath(); };
      this.landPath = new Path2D(); net.land.forEach(r => ring(this.landPath, r));
      this.regionClip = new Path2D(); const b = net.bounds; this.regionClip.rect(b.x0 - 1e5, b.y0 - 1e5, (b.x1 - b.x0) + 2e5, (b.y1 - b.y0) + 2e5); ring(this.regionClip, net.nycRegion);
      this.boroPaths = net.boroughs.map(bo => { const p = new Path2D(); bo.rings.forEach(r => ring(p, r)); return { code: bo.code, path: p }; });
      this.allBoros = new Path2D(); this.boroPaths.forEach(bp => this.allBoros.addPath(bp.path));
      this.parkPaths = net.parks.map(pk => { const p = new Path2D(); ring(p, pk.pts); return p; });
      this.airportPaths = net.airports.map(a => { const p = new Path2D(); ring(p, a.pts); return p; });
      // per-route normals for drawing parallel trunk lines
      for (const r of net.routes) {
        const L = r.line; r.nx = []; r.ny = [];
        for (let i = 0; i < L.x.length; i++) {
          const a = Math.max(0, i - 1), c = Math.min(L.x.length - 1, i + 1);
          const dx = L.x[c] - L.x[a], dy = L.y[c] - L.y[a], l = Math.hypot(dx, dy) || 1;
          r.nx.push(-dy / l); r.ny.push(dx / l);
        }
        r.faint = U.rgb(U.mix(r.rgb, [205, 200, 190], 0.55));
      }
      const box = (list) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const s of list) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y); } return { x0, y0, x1, y1 }; };
      this.subwayBox = box(net.stations);
      this.coreBox = box(net.stations.filter(s => s.boro !== 'SI'));
      this.boxOf = box;
      // one label per station complex: the busiest member carries the name
      const best = {};
      for (const s of net.stations) { const key = s.complex || 's' + s.idx; if (!best[key] || s.weight > best[key].weight) best[key] = s; }
      this.labelStations = Object.values(best).sort((a, b) => b.weight - a.weight);
    }

    // ---------------- camera ----------------
    resize() { const r = U.fitCanvas(this.canvas); this.W = r.w; this.H = r.h; this.dpr = r.dpr; this.refZoom = this.zoomFor(this.coreBox, 30); }
    zoomFor(box, pad) { const zx = (this.W - pad * 2) / Math.max(200, box.x1 - box.x0), zy = (this.H - pad * 2) / Math.max(200, box.y1 - box.y0); return U.clamp(Math.min(zx, zy), this.minZoom(), this.maxZoom()); }
    fitBox(box, instant, pad = 60) {
      const t = { cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, zoom: this.zoomFor(box, pad) };
      if (instant) { this.cx = t.cx; this.cy = t.cy; this.zoom = t.zoom; this.target = null; } else this.target = t;
    }
    // whole city
    fitAll(instant) { this.fitBox(this.coreBox, instant, 30); }
    // the part of the city you actually run (or the whole city before the first line opens)
    fitHome(instant) {
      const st = this.sim.state; const act = net.stations.filter(s => s.routes.some(ri => st.routes[net.routes[ri].id].active));
      if (!act.length) return this.fitAll(instant);
      const b = this.boxOf(act); const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2; const half = 4500;
      this.fitBox({ x0: Math.min(b.x0, cx - half), x1: Math.max(b.x1, cx + half), y0: Math.min(b.y0, cy - half), y1: Math.max(b.y1, cy + half) }, instant, 50);
    }
    focusRoute(id) { const r = net.routeById[id]; this.fitBox(this.boxOf(r.stops.map(si => net.stations[si])), false, 80); }
    focusPoint(x, y, zoom) { this.target = { cx: x, cy: y, zoom: zoom || Math.max(this.zoom, this.refZoom * 2.8) }; }
    zoomBy(f) { const z = U.clamp((this.target ? this.target.zoom : this.zoom) * f, this.minZoom(), this.maxZoom()); this.target = { cx: this.target ? this.target.cx : this.cx, cy: this.target ? this.target.cy : this.cy, zoom: z }; }
    minZoom() { return 0.006; }
    maxZoom() { return 0.35; }
    rel() { return this.zoom / (this.refZoom || 0.03); }
    toScreen(x, y) { return [(x - this.cx) * this.zoom + this.W / 2, (y - this.cy) * this.zoom + this.H / 2]; }
    toWorld(sx, sy) { return [(sx - this.W / 2) / this.zoom + this.cx, (sy - this.H / 2) / this.zoom + this.cy]; }
    sizeK() { return U.clamp(Math.pow(this.rel(), 0.45), 0.7, 2.2); }
    onScreen(x, y, m = 30) { return x > -m && y > -m && x < this.W + m && y < this.H + m; }

    // ---------------- input ----------------
    bindInput() {
      const c = this.canvas; const ptrs = new Map(); let drag = null, pinch = null, moved = 0;
      c.addEventListener('pointerdown', e => {
        c.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); moved = 0; this.target = null;
        if (ptrs.size === 1) drag = { x: e.offsetX, y: e.offsetY, cx: this.cx, cy: this.cy };
        if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom }; drag = null; }
      });
      c.addEventListener('pointermove', e => {
        if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        if (pinch && ptrs.size === 2) {
          const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
          this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, U.clamp(pinch.zoom * d / pinch.d, this.minZoom(), this.maxZoom())); moved = 99;
        } else if (drag) {
          const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y; moved = Math.max(moved, Math.hypot(dx, dy));
          if (moved > 4) { this.cx = drag.cx - dx / this.zoom; this.cy = drag.cy - dy / this.zoom; this.clampCam(); c.style.cursor = 'grabbing'; this.hover = null; }
        } else if (e.pointerType === 'mouse') { this.hover = this.hitTest(e.offsetX, e.offsetY); this.hoverPt = [e.offsetX, e.offsetY]; c.style.cursor = this.hover ? 'pointer' : 'grab'; }
      });
      c.addEventListener('pointerleave', () => { this.hover = null; });
      const up = e => {
        ptrs.delete(e.pointerId); c.style.cursor = 'grab';
        if (drag && moved < 6 && ptrs.size === 0) { const hit = this.hitTest(e.offsetX, e.offsetY); this.select(hit); }
        if (ptrs.size < 2) pinch = null; if (ptrs.size === 0) drag = null;
      };
      c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
      c.addEventListener('wheel', e => { e.preventDefault(); this.target = null; this.zoomAt(e.offsetX, e.offsetY, U.clamp(this.zoom * Math.pow(1.0015, -e.deltaY), this.minZoom(), this.maxZoom())); }, { passive: false });
    }
    zoomAt(sx, sy, z) { const [wx, wy] = this.toWorld(sx, sy); this.zoom = z; const [wx2, wy2] = this.toWorld(sx, sy); this.cx += wx - wx2; this.cy += wy - wy2; this.clampCam(); }
    clampCam() { const b = net.bounds; this.cx = U.clamp(this.cx, b.x0 + 3000, b.x1 - 3000); this.cy = U.clamp(this.cy, b.y0 + 3000, b.y1 - 3000); }
    select(hit) { this.selected = hit; this.emit('select', hit); if (hit) SC.audio.click(); }
    isActiveStation(st) { const s = this.sim.state; return st.routes.some(ri => s.routes[net.routes[ri].id].active); }

    hitTest(sx, sy) {
      const s = this.sim.state; const k = this.sizeK();
      let best = null, bd = 13 * k;
      for (const t of s.trains) { const p = this.trainScreen(t); const d = Math.hypot(p.x - sx, p.y - sy); if (d < bd) { bd = d; best = { type: 'train', id: t.id }; } }
      if (best) return best;
      bd = 16 * k;
      for (const inc of s.incidents) { const p = this.incidentPos(inc); if (!p) continue; const [x, y] = this.toScreen(p.x, p.y); const d = Math.hypot(x - sx, y - 16 * k - sy); if (d < bd) { bd = d; best = { type: 'incident', id: inc.id }; } }
      if (best) return best;
      bd = 10 * k;
      for (const st of net.stations) { if (this.rel() < TIER_STREET && !this.isActiveStation(st)) continue; const [x, y] = this.toScreen(st.x, st.y); const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = { type: 'station', idx: st.idx }; } }
      if (best) return best;
      bd = 8;
      for (const r of net.routes) {
        const L = r.line;
        for (let i = 1; i < L.x.length; i++) {
          const [ax, ay] = this.toScreen(L.x[i - 1], L.y[i - 1]), [bx, by] = this.toScreen(L.x[i], L.y[i]);
          const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1; let t = ((sx - ax) * dx + (sy - ay) * dy) / l2; t = U.clamp(t, 0, 1);
          const d = Math.hypot(ax + t * dx - sx, ay + t * dy - sy); if (d < bd) { bd = d; best = { type: 'route', id: r.id }; }
        }
      }
      return best;
    }
    incidentPos(inc) {
      const r = net.routeById[inc.route];
      if (inc.train) { const t = this.sim.state.trains.find(x => x.id === inc.train); if (t) return this.sim.trainPos(t); }
      const st = net.stations[r.stops[U.clamp(inc.k || 0, 0, r.stops.length - 1)]]; return { x: st.x, y: st.y };
    }
    lineWidth() { return U.clamp(4.2 * this.sizeK(), 3, 9); }
    trainScreen(t) {
      const r = net.routeById[t.route]; const p = this.sim.trainPos(t); let [x, y] = this.toScreen(p.x, p.y);
      const o = r.offset * this.lineWidth() * 0.95; const i = r.line.seg(t.d); x += r.nx[i] * o; y += r.ny[i] * o;
      return { x, y, a: p.a + (t.dir < 0 ? Math.PI : 0), wx: p.x, wy: p.y };
    }

    // ---------------- update ----------------
    update(dt) {
      this.time += dt;
      if (this.target) {
        const k = 1 - Math.pow(0.002, dt);
        this.cx += (this.target.cx - this.cx) * k; this.cy += (this.target.cy - this.cy) * k; this.zoom += (this.target.zoom - this.zoom) * k;
        if (Math.abs(this.target.zoom - this.zoom) < 1e-5 && Math.hypot(this.target.cx - this.cx, this.target.cy - this.cy) < 2) this.target = null;
      }
      // fares collected at the gates float up from a few of the busiest stations in view
      this.tapTimer -= dt;
      if (this.tapTimer <= 0) {
        this.tapTimer = 1.0;
        const fare = this.sim.farePaid(); const taps = this.sim.flushTaps(); this.pending = this.pending || new Map();
        for (const [idx, n] of taps) this.pending.set(idx, (this.pending.get(idx) || 0) + n);
        const cand = [];
        for (const [idx, n] of this.pending) { const st = net.stations[idx]; const [x, y] = this.toScreen(st.x, st.y); if (this.onScreen(x, y, -20)) cand.push([idx, n, x, y]); }
        cand.sort((a, b) => b[1] - a[1]);
        let added = 0; const maxNew = this.rel() >= TIER_DISTRICT ? 3 : 2;
        for (const [idx, n, x, y] of cand) {
          if (added >= maxNew) break;
          if (this.floaters.some(f => { const [fx, fy] = this.toScreen(f.x, f.y); return Math.hypot(fx - x, fy - y) < 70; })) continue;
          const st = net.stations[idx]; const amt = n * fare; if (amt < 0.01) continue;
          this.floaters.push({ x: st.x, y: st.y, t: 0, text: '+' + U.money(amt, amt < 1000) }); this.pending.delete(idx); added++;
        }
        if (added) AU.tap();
        if (this.pending.size > 600) this.pending.clear();
      }
      this.floaters.forEach(f => f.t += dt); this.floaters = this.floaters.filter(f => f.t < 1.6);
      this.particles.forEach(p => { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; }); this.particles = this.particles.filter(p => p.t < p.life);
    }

    // ---------------- render ----------------
    render() {
      const ctx = this.ctx, W = this.W, H = this.H, dpr = this.dpr, z = this.zoom, t = this.time;
      const k = this.sizeK();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // water with a gentle animated ripple
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, WATER); g.addColorStop(1, WATER_DARK);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 2;
      const step = 56, off = (t * 10) % step; ctx.beginPath();
      for (let y = -step; y < H + step; y += step) for (let x = -step + ((y / step) % 2 ? step / 2 : 0); x < W + step; x += step) {
        const xx = x + off, yy = y + Math.sin(t * 1.3 + x * 0.05) * 3; ctx.moveTo(xx + Math.cos(Math.PI * 1.15) * 7, yy + Math.sin(Math.PI * 1.15) * 7); ctx.arc(xx, yy, 7, Math.PI * 1.15, Math.PI * 1.85);
      }
      ctx.stroke();
      // static land layers are cached and only re-rendered when the camera moves
      const key = `${this.cx.toFixed(1)},${this.cy.toFixed(1)},${z.toFixed(7)},${W},${H},${dpr}`;
      if (key !== this.baseKey) {
        this.baseKey = key; const c = this.base || (this.base = document.createElement('canvas'));
        if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
        const b = c.getContext('2d'); b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, c.width, c.height);
        this.drawLand(b, W, H, dpr, z); b.setTransform(dpr, 0, 0, dpr, 0, 0); this.drawAreaLabels(b);
      }
      ctx.drawImage(this.base, 0, 0, W, H);
      this.occ = [];
      this.drawLandmarks(ctx, k);
      this.drawRoutes(ctx, k);
      this.drawStations(ctx, k);
      this.drawTrains(ctx, k);
      this.drawIncidents(ctx, k);
      this.drawNight(ctx, k);
      this.drawNames(ctx, k);
      this.drawFloaters(ctx, k);
      this.drawTooltip(ctx);
    }

    drawLand(ctx, W, H, dpr, z) {
      ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - this.cx * z), dpr * (H / 2 - this.cy * z));
      const px = 1 / z;
      ctx.save(); ctx.clip(this.regionClip, 'evenodd'); ctx.fillStyle = '#e6e0cd'; ctx.fill(this.landPath, 'evenodd'); ctx.lineWidth = 1.2 * px; ctx.strokeStyle = '#b3ab95'; ctx.stroke(this.landPath); ctx.restore();
      ctx.save(); ctx.translate(4 * px, 5 * px); ctx.fillStyle = 'rgba(16,64,96,.3)'; ctx.fill(this.allBoros, 'evenodd'); ctx.restore();
      for (const bp of this.boroPaths) { ctx.fillStyle = BORO_FILL[bp.code] || '#eee'; ctx.fill(bp.path, 'evenodd'); }
      ctx.fillStyle = '#9edb7c'; this.parkPaths.forEach(p => ctx.fill(p));
      ctx.lineWidth = 1.2 * px; ctx.strokeStyle = '#6aa954'; this.parkPaths.forEach(p => ctx.stroke(p));
      ctx.fillStyle = '#d6d8e0'; this.airportPaths.forEach(p => ctx.fill(p)); ctx.strokeStyle = '#9a9eab'; this.airportPaths.forEach(p => ctx.stroke(p));
      ctx.lineJoin = 'round'; ctx.lineWidth = 2.2 * px; ctx.strokeStyle = INK;
      for (const bp of this.boroPaths) ctx.stroke(bp.path);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // borough & water names (cached with the land)
    drawAreaLabels(ctx) {
      const rel = this.rel();
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const L of net.labels) {
        if (L.kind === 'nj' && rel > 2.2) continue;
        if (L.kind === 'water' && L.size < 0.6 && rel < 1.2) continue;
        const [x, y] = this.toScreen(L.x, L.y); if (x < -300 || x > this.W + 300 || y < -100 || y > this.H + 100) continue;
        const size = U.clamp(20 * L.size * Math.pow(rel, 0.45), 9, 46);
        ctx.save(); ctx.translate(x, y); ctx.rotate(L.rot);
        if (L.kind === 'water') { ctx.font = `italic 600 ${size * 0.8}px Georgia, serif`; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillText(L.text, 0, 0); }
        else {
          ctx.font = `900 ${size}px "Arial Black", Helvetica, Arial, sans-serif`;
          if ('letterSpacing' in ctx) ctx.letterSpacing = `${size * 0.14}px`;
          ctx.fillStyle = L.kind === 'nj' ? 'rgba(90,82,66,.32)' : 'rgba(40,30,60,.17)'; ctx.fillText(L.text, 0, 0);
        }
        ctx.restore();
      }
      ctx.restore();
    }

    drawLandmarks(ctx, k) {
      const t = this.time; const size = U.clamp(20 * k, 15, 34);
      ctx.save(); ctx.globalAlpha = 0.92;
      for (const lm of net.landmarks) {
        const [x, y] = this.toScreen(lm.x, lm.y); lm.sx = x; lm.sy = y; lm.ss = size;
        if (!this.onScreen(x, y, 60)) continue;
        ICON.draw(ctx, lm.kind, x, y, size, t);
      }
      ctx.restore();
      // Staten Island Ferry shuttling across the harbor
      const f = net.ferry; const ph = (t / 40) % 2; const u = ph < 1 ? U.smooth(ph) : 1 - U.smooth(ph - 1);
      const [fx, fy] = this.toScreen(U.lerp(f.x0, f.x1, u), U.lerp(f.y0, f.y1, u));
      ICON.draw(ctx, 'ferry', fx, fy + Math.sin(t * 2) * 1.5, U.clamp(15 * k, 11, 26), t, ph >= 1);
    }

    pathFor(ctx, r, off) {
      const L = r.line; const o = r.offset * off; ctx.beginPath();
      for (let i = 0; i < L.x.length; i++) { const [x, y] = this.toScreen(L.x[i], L.y[i]); const X = x + r.nx[i] * o, Y = y + r.ny[i] * o; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
    }
    drawRoutes(ctx, k) {
      const s = this.sim.state; const w = this.lineWidth(), off = w * 0.95;
      const hl = this.highlightRoute || (this.selected && this.selected.type === 'route' ? this.selected.id : null) || (this.hover && this.hover.type === 'route' ? this.hover.id : null);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      // lines you haven't opened yet: thin, quiet, washed-out
      ctx.lineWidth = Math.max(1.4, w * 0.38);
      for (const r of net.routes) { if (s.routes[r.id].active || r.id === hl) continue; this.pathFor(ctx, r, off); ctx.strokeStyle = r.faint; ctx.stroke(); }
      // lines in service: ink casing, then colour
      const act = net.routes.filter(r => s.routes[r.id].active);
      ctx.lineWidth = w + 3; ctx.strokeStyle = INK; for (const r of act) { this.pathFor(ctx, r, off); ctx.stroke(); }
      ctx.lineWidth = w; for (const r of act) { this.pathFor(ctx, r, off); ctx.strokeStyle = r.color; ctx.stroke(); }
      if (hl) {
        const r = net.routeById[hl]; this.pathFor(ctx, r, off);
        ctx.lineWidth = w + 9; ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.stroke();
        if (!s.routes[r.id].active) ctx.setLineDash([w * 1.4, w * 1.1]);
        ctx.lineWidth = w; ctx.strokeStyle = r.color; ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // station dots + one crowd ring per station (size = how many are waiting, colour = how full)
    drawStations(ctx, k) {
      const rel = this.rel(); const r0 = U.clamp(2.7 * k, 2.2, 6); const t = this.time;
      this.r0 = r0;
      for (const st of net.stations) {
        const [x, y] = this.toScreen(st.x, st.y); const active = this.isActiveStation(st);
        st.sx = x; st.sy = y; st.on = active;
        if (!this.onScreen(x, y, 20)) continue;
        if (!active) { if (rel >= TIER_STREET) { ctx.fillStyle = 'rgba(40,40,50,.28)'; ctx.beginPath(); ctx.arc(x, y, r0 * 0.6, 0, U.TAU); ctx.fill(); } continue; }
        const w = this.sim.stationWaiting(st.idx);
        if (w > 15) {
          const full = w / this.sim.platformCap(st); const col = full > 0.85 ? CROWD.packed : full > 0.5 ? CROWD.busy : CROWD.calm;
          const pulse = full > 0.85 ? 1 + Math.sin(t * 5 + st.idx) * 0.08 : 1;
          const R = (r0 + U.clamp(Math.sqrt(w) * 0.32 * k, 1.5, 15 * k)) * pulse;
          ctx.beginPath(); ctx.arc(x, y, R, 0, U.TAU); ctx.fillStyle = U.rgba(col, 0.22); ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = U.rgba(col, 0.85); ctx.stroke();
        }
      }
      const closedCol = '#ff5d5d';
      for (const st of net.stations) {
        if (!st.on || !this.onScreen(st.sx, st.sy, 20)) continue;
        const transfer = st.complexRoutes.length > 1; const r = transfer ? r0 * 1.3 : r0;
        ctx.beginPath(); ctx.arc(st.sx, st.sy, r, 0, U.TAU); ctx.fillStyle = this.sim.stationClosed(st.idx) ? closedCol : '#fff'; ctx.fill();
        ctx.lineWidth = U.clamp(1.5 * k, 1.2, 2.6); ctx.strokeStyle = INK; ctx.stroke();
        if (rel >= TIER_STREET) this.occ.push([st.sx - r, st.sy - r, st.sx + r, st.sy + r]);
      }
      const sel = this.selected;
      if (sel && sel.type === 'station') { const st = net.stations[sel.idx]; const [x, y] = this.toScreen(st.x, st.y); ctx.beginPath(); ctx.arc(x, y, r0 * 2.6 + Math.sin(t * 5) * 1.5, 0, U.TAU); ctx.strokeStyle = '#ff2d7a'; ctx.lineWidth = 3; ctx.stroke(); }
    }

    drawTrains(ctx, k) {
      const s = this.sim.state; const rel = this.rel(); const night = this.nightLevel(); const sel = this.selected;
      const detailed = rel >= TIER_DISTRICT;
      for (const t of s.trains) {
        const r = net.routeById[t.route]; const p = this.trainScreen(t); const { x, y } = p;
        if (!this.onScreen(x, y, 40)) continue;
        const isSel = sel && sel.type === 'train' && sel.id === t.id;
        const moving = t.state === 'run' && t.v > 0.5; const bob = moving ? Math.sin(this.time * 18 + t.id) * 0.6 : 0;
        ctx.save(); ctx.translate(x, y + bob); ctx.rotate(p.a);
        if (!detailed && !isSel) {
          // overview: a small pill in the line's colour
          const L = U.clamp(11 * k, 9, 16), Wd = L * 0.5;
          U.roundRect(ctx, -L / 2, -Wd / 2, L, Wd, Wd / 2); ctx.fillStyle = r.color; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = '#fff'; ctx.stroke();
          ctx.lineWidth = 1; ctx.strokeStyle = INK; U.roundRect(ctx, -L / 2 - 1.3, -Wd / 2 - 1.3, L + 2.6, Wd + 2.6, Wd / 2 + 1.3); ctx.stroke();
        } else {
          const L = U.clamp(17 * k, 13, 36), Wd = L * 0.42; const m = C.MODEL[t.model];
          if (night > 0.2 && moving) { const gr = ctx.createRadialGradient(L * 0.6, 0, 0, L * 0.6, 0, L * 1.5); gr.addColorStop(0, `rgba(255,240,170,${0.5 * night})`); gr.addColorStop(1, 'rgba(255,240,170,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(L * 0.5, 0); ctx.arc(L * 0.5, 0, L * 1.5, -0.45, 0.45); ctx.fill(); }
          U.roundRect(ctx, -L / 2, -Wd / 2, L, Wd, Wd * 0.45); ctx.fillStyle = m.body; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = INK; ctx.stroke();
          ctx.fillStyle = r.color; ctx.fillRect(-L / 2 + 2, Wd * 0.12, L - 4, Wd * 0.2);
          ctx.fillStyle = night > 0.3 ? '#fff6c8' : '#29405f'; for (let j = 0; j < 3; j++) ctx.fillRect(-L / 2 + 3 + j * (L - 6) / 3, -Wd * 0.3, (L - 6) / 3 - 2, Wd * 0.3);
          ctx.fillStyle = '#fff59a'; ctx.beginPath(); ctx.arc(L / 2 - 1.5, 0, Wd * 0.14, 0, U.TAU); ctx.fill();
        }
        if (t.state === 'broken') { ctx.strokeStyle = `rgba(255,40,40,${0.5 + 0.5 * Math.sin(this.time * 10)})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, 12 * k, 0, U.TAU); ctx.stroke(); }
        ctx.restore();
        if (detailed || isSel) {
          const br = U.clamp(5.5 * k, 5, 10), by = y - U.clamp(17 * k, 13, 36) * 0.42 * 0.9 - br * 0.7;
          ctx.beginPath(); ctx.arc(x, by, br, 0, U.TAU); ctx.fillStyle = r.color; ctx.fill(); ctx.lineWidth = 1.3; ctx.strokeStyle = INK; ctx.stroke();
          ctx.fillStyle = r.text; ctx.font = `900 ${br * (r.label.length > 1 ? 0.85 : 1.25)}px Helvetica, Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(r.label, x, by + br * 0.05);
        }
        if (t.state === 'broken' && Math.random() < 0.2) this.particles.push({ x: p.wx, y: p.wy, vx: U.rand(-40, 40), vy: -U.rand(60, 120), t: 0, life: 1.1 });
        if (isSel) { ctx.beginPath(); ctx.arc(x, y, 18 * k + Math.sin(this.time * 6) * 2, 0, U.TAU); ctx.strokeStyle = '#ff2d7a'; ctx.lineWidth = 3; ctx.stroke(); }
      }
      for (const p of this.particles) { const [x, y] = this.toScreen(p.x, p.y); const a = 1 - p.t / p.life; ctx.beginPath(); ctx.arc(x, y - p.t * 18, 2.5 + p.t * 6, 0, U.TAU); ctx.fillStyle = `rgba(90,90,100,${0.45 * a})`; ctx.fill(); }
    }

    drawIncidents(ctx, k) {
      const s = this.sim.state;
      for (const inc of s.incidents) {
        const p = this.incidentPos(inc); if (!p) continue; const [x, y0] = this.toScreen(p.x, p.y); const y = y0 - 16 * k;
        if (!this.onScreen(x, y, 30)) continue;
        const pulse = 1 + Math.sin(this.time * 7 + inc.id) * 0.1; const R = U.clamp(10 * k, 9, 18) * pulse;
        ctx.beginPath(); ctx.moveTo(x, y - R); ctx.lineTo(x + R * 1.05, y + R * 0.8); ctx.lineTo(x - R * 1.05, y + R * 0.8); ctx.closePath();
        ctx.fillStyle = '#ffd400'; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = INK; ctx.stroke();
        ctx.font = `${R * 0.9}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(inc.icon, x, y + R * 0.22);
        this.occ.push([x - R, y - R, x + R, y + R]);
        const sel = this.selected; if (sel && sel.type === 'incident' && sel.id === inc.id) { ctx.beginPath(); ctx.arc(x, y, R * 1.8, 0, U.TAU); ctx.strokeStyle = '#ff2d7a'; ctx.lineWidth = 3; ctx.stroke(); }
      }
    }

    // ---------------- names (collision-free) ----------------
    place(box) { for (const o of this.occ) if (box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]) return false; this.occ.push(box); return true; }
    label(ctx, text, x, y, r, opts) {
      const size = opts.size, h = size + 4; const w = ctx.measureText(text).width + 6;
      const spots = [[x + r + 3, y - h / 2, 'left'], [x - r - 3 - w, y - h / 2, 'left'], [x - w / 2, y - r - 3 - h, 'left'], [x - w / 2, y + r + 3, 'left']];
      for (const [bx, by] of spots) {
        if (bx < 2 || by < 2 || bx + w > this.W - 2 || by + h > this.H - 2) continue;
        if (!this.place([bx, by, bx + w, by + h])) continue;
        ctx.lineWidth = 3.5; ctx.strokeStyle = opts.halo || 'rgba(255,255,255,.92)'; ctx.strokeText(text, bx + 3, by + h / 2); ctx.fillStyle = opts.color || INK; ctx.fillText(text, bx + 3, by + h / 2);
        return true;
      }
      return false;
    }
    drawNames(ctx, k) {
      const rel = this.rel(); const sel = this.selected; const r0 = this.r0 || 3;
      ctx.save(); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      // the selected station always gets its name, in bold
      if (sel && sel.type === 'station') { const st = net.stations[sel.idx]; const [x, y] = this.toScreen(st.x, st.y); ctx.font = '800 13px Helvetica, Arial, sans-serif'; this.label(ctx, U.stationName(st.name), x, y, r0 * 2.8, { size: 13 }); }
      if (rel >= TIER_DISTRICT) {
        const street = rel >= TIER_STREET; const size = street ? U.clamp(10.5 + (rel - TIER_STREET) * 0.6, 10.5, 13) : 11.5;
        ctx.font = `${street ? 600 : 800} ${size}px Helvetica, Arial, sans-serif`;
        let n = 0; const max = street ? 90 : 14;
        for (const st of this.labelStations) {
          if (n >= max) break;
          const cx = net.complexes[st.complex || 's' + st.idx] || [st.idx];
          if (!cx.some(i => net.stations[i].on)) continue;
          if (!street && st.weight < 2.4) continue;
          const [x, y] = this.toScreen(st.x, st.y); if (!this.onScreen(x, y, -4)) continue;
          if (this.label(ctx, U.stationName(st.name), x, y, r0 * 1.4, { size })) n++;
        }
      }
      if (rel >= TIER_STREET) {
        ctx.font = 'italic 600 10.5px Georgia, serif';
        for (const lm of net.landmarks) { if (lm.sx == null || !this.onScreen(lm.sx, lm.sy, -4)) continue; this.label(ctx, lm.name, lm.sx, lm.sy - lm.ss * 0.4, lm.ss * 0.55, { size: 10.5, color: '#5a4e3a' }); }
      }
      ctx.restore();
    }

    drawFloaters(ctx, k) {
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const f of this.floaters) {
        const [x, y] = this.toScreen(f.x, f.y); const a = f.t < 1.1 ? 1 : 1 - (f.t - 1.1) / 0.5; const yy = y - 12 - f.t * 26; const sc = f.t < 0.15 ? U.easeOutBack(f.t / 0.15) : 1;
        const size = 12 * sc;
        ctx.globalAlpha = Math.max(0, a); ctx.font = `900 ${size}px "Arial Black", Helvetica, Arial`;
        ctx.lineWidth = 3; ctx.strokeStyle = '#0f3d1d'; ctx.strokeText(f.text, x, yy); ctx.fillStyle = '#6dff8a'; ctx.fillText(f.text, x, yy);
      }
      ctx.restore();
    }

    // hover card with the numbers the map itself no longer shows
    drawTooltip(ctx) {
      const h = this.hover; if (!h || !this.hoverPt) return; const s = this.sim.state;
      let title = '', line = '';
      if (h.type === 'station') { const st = net.stations[h.idx]; title = U.stationName(st.name); const w = this.sim.stationWaiting(st.idx); const act = st.complexRoutes.map(ri => net.routes[ri]).filter(r => s.routes[r.id].active).map(r => r.label).join(' '); line = st.on ? `${U.num(w)} waiting · ${act}` : 'No service yet — open a line here'; }
      else if (h.type === 'train') { const t = s.trains.find(x => x.id === h.id); if (!t) return; const m = C.MODEL[t.model]; title = `${net.routeById[t.route].shortName} · #${t.id}`; line = `${m.name} · ${Math.round(t.load)}/${m.cap} riders`; }
      else if (h.type === 'incident') { const inc = s.incidents.find(i => i.id === h.id); if (!inc) return; title = `${inc.icon} ${inc.label}`; line = `Click to send a crew (${U.money(inc.fix)})`; }
      else if (h.type === 'route') { const r = net.routeById[h.id]; title = r.name; line = s.routes[r.id].active ? `${this.sim.routeTrains(r.id).length} trains in service` : `Not running · ${r.stops.length} stations`; }
      ctx.save(); ctx.font = '800 12.5px Helvetica, Arial'; const w1 = ctx.measureText(title).width; ctx.font = '600 11.5px Helvetica, Arial'; const w2 = ctx.measureText(line).width;
      const w = Math.max(w1, w2) + 20, hh = 42; let x = this.hoverPt[0] + 14, y = this.hoverPt[1] + 14;
      if (x + w > this.W - 6) x = this.hoverPt[0] - w - 10; if (y + hh > this.H - 6) y = this.hoverPt[1] - hh - 10;
      U.roundRect(ctx, x, y, w, hh, 9); ctx.fillStyle = '#fffaf0'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = INK; ctx.font = '800 12.5px Helvetica, Arial'; ctx.fillText(title, x + 10, y + 14); ctx.font = '600 11.5px Helvetica, Arial'; ctx.fillStyle = '#4a4a55'; ctx.fillText(line, x + 10, y + 29);
      ctx.restore();
    }

    nightLevel() { const h = this.sim.hour(); if (h >= 6.5 && h <= 18.5) return 0; if (h > 18.5 && h < 20.5) return (h - 18.5) / 2; if (h > 4.5 && h < 6.5) return 1 - (h - 4.5) / 2; return 1; }
    drawNight(ctx, k) {
      const n = this.nightLevel(); if (n <= 0) return;
      ctx.fillStyle = `rgba(16,22,70,${0.34 * n})`; ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalCompositeOperation = 'lighter';
      for (const st of net.stations) { if (!st.on || !this.onScreen(st.sx, st.sy, 0)) continue; ctx.beginPath(); ctx.arc(st.sx, st.sy, 6 * k, 0, U.TAU); ctx.fillStyle = `rgba(255,220,120,${0.22 * n})`; ctx.fill(); }
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  SC.MapView = MapView;
})(window.SC);
