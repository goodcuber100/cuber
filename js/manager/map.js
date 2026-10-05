// Cartoon map of New York City for MTA Manager mode: real shorelines, real MTA route geometry,
// animated trains, crowds, fares popping out of stations, incidents and landmarks.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const U = SC.util, net = SC.net, C = SC.content, ICON = SC.icons, AU = SC.audio;
  const INK = '#1d1d24';
  const BORO_FILL = { M: '#ffe8a3', Bk: '#ffd2a8', Q: '#e7f0a8', Bx: '#ffc9c4', SI: '#cdeec0' };
  const WATER = '#6fc3ea', WATER_DARK = '#4aa8d6';

  class MapView extends U.Emitter {
    constructor(canvas, sim) {
      super();
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.sim = sim;
      this.cx = 0; this.cy = 0; this.zoom = 0.03; this.target = null;
      this.selected = null; this.hover = null; this.highlightRoute = null;
      this.floaters = []; this.particles = []; this.tapTimer = 0; this.time = 0;
      this.buildPaths();
      this.bindInput();
      this.resize();
      this.fitAll(true);
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
          const a = Math.max(0, i - 1), b = Math.min(L.x.length - 1, i + 1);
          const dx = L.x[b] - L.x[a], dy = L.y[b] - L.y[a], l = Math.hypot(dx, dy) || 1;
          r.nx.push(-dy / l); r.ny.push(dx / l);
        }
      }
      // world extents of the subway itself
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of net.stations) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y); }
      this.subwayBox = { x0, y0, x1, y1 };
    }

    resize() { const r = U.fitCanvas(this.canvas); this.W = r.w; this.H = r.h; this.dpr = r.dpr; }
    fitBox(box, instant, pad = 60) {
      const zx = (this.W - pad * 2) / Math.max(200, box.x1 - box.x0), zy = (this.H - pad * 2) / Math.max(200, box.y1 - box.y0);
      const z = U.clamp(Math.min(zx, zy), this.minZoom(), this.maxZoom());
      const t = { cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, zoom: z };
      if (instant) { this.cx = t.cx; this.cy = t.cy; this.zoom = t.zoom; this.target = null; } else this.target = t;
    }
    fitAll(instant) { this.fitBox(this.subwayBox, instant, 30); this.homeZoom = this.target ? this.target.zoom : this.zoom; }
    focusRoute(id) {
      const r = net.routeById[id]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const si of r.stops) { const s = net.stations[si]; x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y); }
      this.fitBox({ x0, y0, x1, y1 }, false, 80);
    }
    focusPoint(x, y, zoom) { this.target = { cx: x, cy: y, zoom: zoom || Math.max(this.zoom, this.homeZoom * 2.5) }; }
    minZoom() { return 0.006; }
    maxZoom() { return 0.35; }
    toScreen(x, y) { return [(x - this.cx) * this.zoom + this.W / 2, (y - this.cy) * this.zoom + this.H / 2]; }
    toWorld(sx, sy) { return [(sx - this.W / 2) / this.zoom + this.cx, (sy - this.H / 2) / this.zoom + this.cy]; }
    sizeK() { return U.clamp(Math.pow(this.zoom / (this.homeZoom || 0.03), 0.45), 0.7, 2.4); }

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
          if (moved > 4) { this.cx = drag.cx - dx / this.zoom; this.cy = drag.cy - dy / this.zoom; this.clampCam(); c.style.cursor = 'grabbing'; }
        } else { this.hover = this.hitTest(e.offsetX, e.offsetY); c.style.cursor = this.hover ? 'pointer' : 'grab'; }
      });
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

    hitTest(sx, sy) {
      const s = this.sim.state; const k = this.sizeK();
      let best = null, bd = 16 * k;
      for (const t of s.trains) { const p = this.sim.trainPos(t); const [x, y] = this.toScreen(p.x, p.y); const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = { type: 'train', id: t.id }; } }
      if (best) return best;
      bd = 18 * k;
      for (const inc of s.incidents) { const p = this.incidentPos(inc); if (!p) continue; const [x, y] = this.toScreen(p.x, p.y - 0); const d = Math.hypot(x - sx, y - (sy + 18 * k)); if (d < bd) { bd = d; best = { type: 'incident', id: inc.id }; } }
      if (best) return best;
      bd = 11 * k;
      for (const st of net.stations) { const [x, y] = this.toScreen(st.x, st.y); const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = { type: 'station', idx: st.idx }; } }
      if (best) return best;
      bd = 9;
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

    // ---------------- update ----------------
    update(dt) {
      this.time += dt;
      if (this.target) {
        const k = 1 - Math.pow(0.002, dt);
        this.cx += (this.target.cx - this.cx) * k; this.cy += (this.target.cy - this.cy) * k; this.zoom += (this.target.zoom - this.zoom) * k;
        if (Math.abs(this.target.zoom - this.zoom) < 1e-5 && Math.hypot(this.target.cx - this.cx, this.target.cy - this.cy) < 2) this.target = null;
      }
      // turn fare taps into floating "+$" money popups (a few busy stations at a time)
      this.tapTimer -= dt;
      if (this.tapTimer <= 0) {
        this.tapTimer = 0.7;
        const fare = this.sim.farePaid(); const taps = this.sim.flushTaps(); this.pending = this.pending || new Map();
        for (const [idx, n] of taps) this.pending.set(idx, (this.pending.get(idx) || 0) + n);
        const cand = [...this.pending.entries()].filter(([idx]) => { const st = net.stations[idx]; const [x, y] = this.toScreen(st.x, st.y); return x > 0 && y > 0 && x < this.W && y < this.H && !this.floaters.some(f => f.idx === idx); });
        cand.sort((a, b) => b[1] - a[1]);
        const maxNew = this.zoom > this.homeZoom * 2 ? 5 : 3;
        for (const [idx, n] of cand.slice(0, maxNew)) {
          const st = net.stations[idx]; const amt = n * fare; if (amt < 0.01) continue;
          this.floaters.push({ idx, x: st.x, y: st.y, t: 0, text: '+' + U.money(amt, amt < 1000), big: amt > 500 });
          this.pending.delete(idx);
        }
        if (cand.length) AU.tap();
        if (this.pending.size > 600) this.pending.clear();
      }
      this.floaters.forEach(f => f.t += dt); this.floaters = this.floaters.filter(f => f.t < 1.4);
      this.particles.forEach(p => { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; }); this.particles = this.particles.filter(p => p.t < p.life);
    }

    // ---------------- render ----------------
    render() {
      const ctx = this.ctx, W = this.W, H = this.H, dpr = this.dpr, z = this.zoom, t = this.time;
      const s = this.sim.state, k = this.sizeK();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // water
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, WATER); g.addColorStop(1, WATER_DARK);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2;
      const step = 52, off = (t * 12) % step; ctx.beginPath();
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
        this.drawLand(b, W, H, dpr, z); b.setTransform(dpr, 0, 0, dpr, 0, 0); this.drawLabels(b, k);
      }
      ctx.drawImage(this.base, 0, 0, W, H);
      this.drawLandmarks(ctx, k);
      this.drawRoutes(ctx, k);
      this.drawStations(ctx, k);
      this.drawTrains(ctx, k);
      this.drawIncidents(ctx, k);
      this.drawFloaters(ctx, k);
      this.drawNight(ctx, k);
    }

    drawLand(ctx, W, H, dpr, z) {
      ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - this.cx * z), dpr * (H / 2 - this.cy * z));
      const px = 1 / z;
      // neighbouring land (outside NYC)
      ctx.save(); ctx.clip(this.regionClip, 'evenodd'); ctx.fillStyle = '#e4ddc8'; ctx.fill(this.landPath, 'evenodd'); ctx.lineWidth = 1.2 * px; ctx.strokeStyle = '#a49b84'; ctx.stroke(this.landPath); ctx.restore();
      // borough drop shadow + fills
      ctx.save(); ctx.translate(4 * px, 5 * px); ctx.fillStyle = 'rgba(16,64,96,.35)'; ctx.fill(this.allBoros, 'evenodd'); ctx.restore();
      for (const bp of this.boroPaths) { ctx.fillStyle = BORO_FILL[bp.code] || '#eee'; ctx.fill(bp.path, 'evenodd'); }
      ctx.fillStyle = '#93d96f'; this.parkPaths.forEach(p => ctx.fill(p));
      ctx.lineWidth = 1.2 * px; ctx.strokeStyle = '#5a9e45'; this.parkPaths.forEach(p => ctx.stroke(p));
      ctx.fillStyle = '#cfd2db'; this.airportPaths.forEach(p => ctx.fill(p)); ctx.strokeStyle = '#8b8f9c'; this.airportPaths.forEach(p => ctx.stroke(p));
      ctx.lineJoin = 'round'; ctx.lineWidth = 2.4 * px; ctx.strokeStyle = INK;
      for (const bp of this.boroPaths) ctx.stroke(bp.path);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    drawLabels(ctx, k) {
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const L of net.labels) {
        const [x, y] = this.toScreen(L.x, L.y); if (x < -300 || x > this.W + 300 || y < -100 || y > this.H + 100) continue;
        const size = U.clamp(22 * L.size * Math.pow(this.zoom / this.homeZoom, 0.55), 9, 60);
        ctx.save(); ctx.translate(x, y); ctx.rotate(L.rot);
        if (L.kind === 'water') { ctx.font = `italic 600 ${size * 0.85}px Georgia, serif`; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText(L.text, 0, 0); }
        else {
          ctx.font = `900 ${size}px "Arial Black", Helvetica, Arial, sans-serif`;
          if ('letterSpacing' in ctx) ctx.letterSpacing = `${size * 0.12}px`;
          ctx.lineWidth = size * 0.22; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineJoin = 'round'; ctx.strokeText(L.text, 0, 0);
          ctx.fillStyle = L.kind === 'nj' ? 'rgba(90,82,66,.45)' : 'rgba(40,30,60,.28)'; ctx.fillText(L.text, 0, 0);
        }
        ctx.restore();
      }
      ctx.restore();
    }

    drawLandmarks(ctx, k) {
      const t = this.time; const size = 26 * k;
      for (const lm of net.landmarks) {
        const [x, y] = this.toScreen(lm.x, lm.y); if (x < -60 || x > this.W + 60 || y < -60 || y > this.H + 80) continue;
        ctx.save(); ctx.globalAlpha = 0.95; ICON.draw(ctx, lm.kind, x, y, size, t); ctx.restore();
        if (this.zoom > this.homeZoom * 2.2) { ctx.font = `600 ${10 * Math.min(k, 1.5)}px Helvetica, Arial`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(30,30,40,.8)'; ctx.fillText(lm.name, x, y + 11 * k); }
      }
      // Staten Island Ferry shuttling across the harbor
      const f = net.ferry; const ph = (t / 40) % 2; const u = ph < 1 ? U.smooth(ph) : 1 - U.smooth(ph - 1);
      const [fx, fy] = this.toScreen(U.lerp(f.x0, f.x1, u), U.lerp(f.y0, f.y1, u));
      ICON.draw(ctx, 'ferry', fx, fy + Math.sin(t * 2) * 1.5, 18 * k, t, ph >= 1);
    }

    drawRoutes(ctx, k) {
      const s = this.sim.state; const wAct = U.clamp(4.2 * k, 3, 9), off = wAct * 0.95;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const pathFor = (r) => {
        const L = r.line; const o = r.offset * off; ctx.beginPath();
        for (let i = 0; i < L.x.length; i++) { const [x, y] = this.toScreen(L.x[i], L.y[i]); const X = x + r.nx[i] * o, Y = y + r.ny[i] * o; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      };
      // inactive lines: faded "planned" look
      for (const r of net.routes) {
        if (s.routes[r.id].active) continue; pathFor(r);
        ctx.setLineDash([wAct * 1.6, wAct * 1.2]); ctx.lineWidth = wAct * 0.75; ctx.strokeStyle = U.rgba(r.rgb, this.highlightRoute === r.id ? 0.9 : 0.38); ctx.stroke(); ctx.setLineDash([]);
      }
      // active lines: ink casing then colour
      const act = net.routes.filter(r => s.routes[r.id].active);
      for (const r of act) { pathFor(r); ctx.lineWidth = wAct + 3.2; ctx.strokeStyle = INK; ctx.stroke(); }
      for (const r of act) { pathFor(r); ctx.lineWidth = wAct; ctx.strokeStyle = r.color; ctx.stroke(); }
      const hl = this.highlightRoute || (this.selected && this.selected.type === 'route' ? this.selected.id : null);
      if (hl) { const r = net.routeById[hl]; pathFor(r); ctx.lineWidth = wAct + 8; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.stroke(); ctx.lineWidth = wAct + 1; ctx.strokeStyle = r.color; ctx.stroke(); }
    }

    drawStations(ctx, k) {
      const s = this.sim.state; const showNames = this.zoom > this.homeZoom * 2.6; const sel = this.selected;
      const occupied = []; const r0 = U.clamp(3.2 * k, 2.5, 7);
      ctx.font = `700 ${U.clamp(10.5 * k, 9, 15)}px Helvetica, Arial, sans-serif`; ctx.textBaseline = 'middle';
      for (const st of net.stations) {
        const [x, y] = this.toScreen(st.x, st.y); if (x < -20 || y < -20 || x > this.W + 20 || y > this.H + 20) continue;
        const active = st.routes.some(ri => s.routes[net.routes[ri].id].active);
        const closed = this.sim.stationClosed(st.idx);
        if (!active) { if (this.zoom > this.homeZoom * 1.6) { ctx.fillStyle = 'rgba(40,40,50,.35)'; ctx.beginPath(); ctx.arc(x, y, r0 * 0.55, 0, 7); ctx.fill(); } continue; }
        const transfer = st.complexRoutes.length > 1;
        ctx.beginPath(); ctx.arc(x, y, transfer ? r0 * 1.35 : r0, 0, 7); ctx.fillStyle = closed ? '#ff5d5d' : '#fff'; ctx.fill(); ctx.lineWidth = U.clamp(1.6 * k, 1.2, 3); ctx.strokeStyle = INK; ctx.stroke();
        // waiting crowd: little heads, red when the platform is jammed
        const w = this.sim.stationWaiting(st.idx);
        if (w > 25) {
          const full = w / this.sim.platformCap(st); const n = Math.min(6, Math.ceil(w / 60));
          for (let i = 0; i < n; i++) { const a = i * 1.2 + st.idx; const bob = Math.sin(this.time * 6 + i + st.idx) * 1.2; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r0 * 2.1, y - r0 * 2.2 - (i % 2) * r0 * 0.9 + bob, r0 * 0.62, 0, 7); ctx.fillStyle = full > 0.85 ? '#ff4d4d' : full > 0.5 ? '#ffb02e' : '#7a5cff'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = INK; ctx.stroke(); }
          if (showNames || w > 300) { const txt = U.num(w); ctx.save(); ctx.font = `800 ${U.clamp(9.5 * k, 9, 13)}px Helvetica, Arial`; const tw = ctx.measureText(txt).width + 8; U.roundRect(ctx, x + r0 * 2.6, y - r0 * 3.6 - 7, tw, 14, 7); ctx.fillStyle = full > 0.85 ? '#ff4d4d' : '#fff'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke(); ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.fillText(txt, x + r0 * 2.6 + 4, y - r0 * 3.6); ctx.restore(); }
        }
        if (showNames || (sel && sel.type === 'station' && sel.idx === st.idx)) {
          const name = U.stationName(st.name); const tw = ctx.measureText(name).width;
          const bx = x + r0 * 1.8, by = y - 7;
          if (!occupied.some(o => bx < o.x1 && bx + tw > o.x0 && by < o.y1 && by + 14 > o.y0)) {
            occupied.push({ x0: bx, x1: bx + tw, y0: by, y1: by + 14 });
            ctx.textAlign = 'left'; ctx.lineWidth = 3.2; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.strokeText(name, bx, y); ctx.fillStyle = INK; ctx.fillText(name, bx, y);
          }
        }
      }
      if (sel && sel.type === 'station') { const st = net.stations[sel.idx]; const [x, y] = this.toScreen(st.x, st.y); ctx.beginPath(); ctx.arc(x, y, r0 * 3 + Math.sin(this.time * 5) * 2, 0, 7); ctx.strokeStyle = '#ff2d7a'; ctx.lineWidth = 3; ctx.stroke(); }
    }

    drawTrains(ctx, k) {
      const s = this.sim.state; const L = U.clamp(17 * k, 12, 38), Wd = L * 0.42; const night = this.nightLevel();
      for (const t of s.trains) {
        const r = net.routeById[t.route]; const p = this.sim.trainPos(t); let [x, y] = this.toScreen(p.x, p.y);
        if (x < -40 || y < -40 || x > this.W + 40 || y > this.H + 40) continue;
        const o = r.offset * U.clamp(4.2 * k, 3, 9) * 0.95; const i = r.line.seg(t.d); x += r.nx[i] * o; y += r.ny[i] * o;
        const m = C.MODEL[t.model]; const ang = p.a + (t.dir < 0 ? Math.PI : 0);
        const moving = t.state === 'run' && t.v > 0.5; const bob = moving ? Math.sin(this.time * 18 + t.id) * 0.8 : 0;
        ctx.save(); ctx.translate(x, y + bob); ctx.rotate(ang);
        if (night > 0.2 && moving) { const g = ctx.createRadialGradient(L * 0.6, 0, 0, L * 0.6, 0, L * 1.6); g.addColorStop(0, `rgba(255,240,170,${0.55 * night})`); g.addColorStop(1, 'rgba(255,240,170,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(L * 0.5, 0); ctx.arc(L * 0.5, 0, L * 1.6, -0.45, 0.45); ctx.fill(); }
        U.roundRect(ctx, -L / 2, -Wd / 2, L, Wd, Wd * 0.45); ctx.fillStyle = m.body; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = INK; ctx.stroke();
        ctx.fillStyle = r.color; ctx.fillRect(-L / 2 + 2, Wd * 0.12, L - 4, Wd * 0.18);
        ctx.fillStyle = night > 0.3 ? '#fff6c8' : '#29405f'; for (let j = 0; j < 3; j++) ctx.fillRect(-L / 2 + 3 + j * (L - 6) / 3, -Wd * 0.3, (L - 6) / 3 - 2, Wd * 0.3);
        ctx.fillStyle = '#fff59a'; ctx.beginPath(); ctx.arc(L / 2 - 1.5, 0, Wd * 0.14, 0, 7); ctx.fill();
        if (t.state === 'broken') { ctx.strokeStyle = `rgba(255,40,40,${0.5 + 0.5 * Math.sin(this.time * 10)})`; ctx.lineWidth = 3; U.roundRect(ctx, -L / 2 - 3, -Wd / 2 - 3, L + 6, Wd + 6, Wd * 0.6); ctx.stroke(); }
        ctx.restore();
        // route bullet riding on top
        const br = U.clamp(6 * k, 5, 11); ctx.beginPath(); ctx.arc(x, y - Wd * 0.9 - br * 0.6, br, 0, 7); ctx.fillStyle = r.color; ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = INK; ctx.stroke();
        ctx.fillStyle = r.text; ctx.font = `900 ${br * (r.label.length > 1 ? 0.85 : 1.25)}px Helvetica, Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(r.label, x, y - Wd * 0.9 - br * 0.55);
        if (t.state === 'broken' && Math.random() < 0.25) this.particles.push({ x: p.x, y: p.y, vx: U.rand(-60, 60), vy: -U.rand(80, 160), t: 0, life: 1.2, kind: 'smoke' });
        if (t.held > 40 && t.state === 'run') { ctx.font = `800 ${11 * k}px Helvetica`; ctx.fillStyle = INK; ctx.fillText('💤', x + L * 0.7, y - Wd); }
        const sel = this.selected; if (sel && sel.type === 'train' && sel.id === t.id) { ctx.beginPath(); ctx.arc(x, y, L * 0.95 + Math.sin(this.time * 6) * 2, 0, 7); ctx.strokeStyle = '#ff2d7a'; ctx.lineWidth = 3; ctx.stroke(); }
      }
      for (const p of this.particles) { const [x, y] = this.toScreen(p.x, p.y); const a = 1 - p.t / p.life; ctx.beginPath(); ctx.arc(x, y - p.t * 20, 3 + p.t * 8, 0, 7); ctx.fillStyle = `rgba(90,90,100,${0.5 * a})`; ctx.fill(); }
    }

    drawIncidents(ctx, k) {
      const s = this.sim.state;
      for (const inc of s.incidents) {
        const p = this.incidentPos(inc); if (!p) continue; const [x, y0] = this.toScreen(p.x, p.y); const y = y0 - 18 * k;
        const pulse = 1 + Math.sin(this.time * 7 + inc.id) * 0.12; const R = 13 * k * pulse;
        ctx.beginPath(); ctx.moveTo(x, y - R); ctx.lineTo(x + R * 1.05, y + R * 0.8); ctx.lineTo(x - R * 1.05, y + R * 0.8); ctx.closePath();
        ctx.fillStyle = '#ffd400'; ctx.fill(); ctx.lineWidth = 2.4; ctx.strokeStyle = INK; ctx.stroke();
        ctx.font = `${R * 0.95}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(inc.icon, x, y + R * 0.2);
        const sel = this.selected; if (sel && sel.type === 'incident' && sel.id === inc.id) { ctx.beginPath(); ctx.arc(x, y, R * 1.8, 0, 7); ctx.strokeStyle = '#ff2d7a'; ctx.lineWidth = 3; ctx.stroke(); }
      }
    }

    drawFloaters(ctx, k) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const f of this.floaters) {
        const [x, y] = this.toScreen(f.x, f.y); const a = f.t < 1 ? 1 : 1 - (f.t - 1) / 0.4; const yy = y - 14 - f.t * 34 * k; const sc = f.t < 0.15 ? U.easeOutBack(f.t / 0.15) : 1;
        const size = (f.big ? 13 : 11) * U.clamp(k, 0.9, 1.4) * sc;
        ctx.globalAlpha = Math.max(0, a); ctx.font = `900 ${size}px "Arial Black", Helvetica, Arial`;
        ctx.lineWidth = 3.5; ctx.strokeStyle = '#13401f'; ctx.strokeText(f.text, x, yy); ctx.fillStyle = '#5dff7a'; ctx.fillText(f.text, x, yy);
        ctx.beginPath(); ctx.arc(x - ctx.measureText(f.text).width / 2 - size * 0.6, yy, size * 0.45, 0, 7); ctx.fillStyle = '#ffd23f'; ctx.fill(); ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    nightLevel() { const h = this.sim.hour(); if (h >= 6.5 && h <= 18.5) return 0; if (h > 18.5 && h < 20.5) return (h - 18.5) / 2; if (h > 4.5 && h < 6.5) return 1 - (h - 4.5) / 2; return 1; }
    drawNight(ctx, k) {
      const n = this.nightLevel(); if (n <= 0) return;
      ctx.fillStyle = `rgba(16,22,70,${0.38 * n})`; ctx.fillRect(0, 0, this.W, this.H);
      const s = this.sim.state; ctx.globalCompositeOperation = 'lighter';
      for (const st of net.stations) {
        if (!st.routes.some(ri => s.routes[net.routes[ri].id].active)) continue; const [x, y] = this.toScreen(st.x, st.y); if (x < 0 || y < 0 || x > this.W || y > this.H) continue;
        ctx.beginPath(); ctx.arc(x, y, 7 * k, 0, 7); ctx.fillStyle = `rgba(255,220,120,${0.25 * n})`; ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  SC.MapView = MapView;
})(window.SC);
