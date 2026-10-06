// Pseudo-3D first-person renderer (classic segment projection, painter's algorithm far -> near).
// Draws tunnels, river tubes, elevated structures with rowhouses & water towers, bridges,
// stations with mosaic tiles, the real skyline placed by real bearing, and the cab interior.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const U = SC.util, SP = SC.sprites, ICON = SC.icons, net = SC.net;
  const INK = '#15151c';
  const MAXN = 300, NEAR = 0.6, EYE = 2.55;
  const SKY_KEYS = [
    [0, [10, 14, 40], [38, 36, 78], 0.42], [5, [18, 22, 60], [80, 64, 104], 0.48], [6.5, [100, 140, 215], [255, 178, 140], 0.8],
    [9, [72, 152, 238], [190, 225, 250], 1], [16, [66, 146, 232], [200, 226, 250], 1], [18.5, [86, 84, 176], [255, 146, 92], 0.82],
    [20, [28, 28, 78], [118, 68, 108], 0.52], [24, [10, 14, 40], [38, 36, 78], 0.42],
  ];
  const skyAt = (h) => {
    let i = 0; while (i < SKY_KEYS.length - 2 && h > SKY_KEYS[i + 1][0]) i++;
    const a = SKY_KEYS[i], b = SKY_KEYS[i + 1]; const t = U.clamp((h - a[0]) / (b[0] - a[0]), 0, 1);
    const night = h < 5.5 || h > 20 ? 1 : h < 7 ? 1 - (h - 5.5) / 1.5 : h > 18.5 ? (h - 18.5) / 1.5 : 0;
    return { top: U.mix(a[1], b[1], t), hor: U.mix(a[2], b[2], t), k: U.lerp(a[3], b[3], t), night: U.clamp(night, 0, 1) };
  };

  class FPRenderer {
    constructor(canvas) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.bx = new Float32Array(MAXN + 2); this.by = new Float32Array(MAXN + 2); this.bs = new Float32Array(MAXN + 2); this.bdz = new Float32Array(MAXN + 2); this.ty = new Float32Array(MAXN + 2);
      const r = U.rng(99); this.stars = Array.from({ length: 140 }, () => [r() * U.TAU, r() * 0.6, r() * 1.5 + 0.5, r() * 6]);
      this.clouds = Array.from({ length: 14 }, () => ({ b: r() * U.TAU, e: 0.06 + r() * 0.2, s: 0.5 + r() * 1.1, seed: r() }));
      this.resize();
    }
    resize() { const r = U.fitCanvas(this.canvas, 1.5); this.W = r.w; this.H = r.h; this.dpr = r.dpr; }

    render(g) {
      const ctx = this.ctx, W = this.W, H = this.H, T = g.track, SEG = T.SEG;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const F = Math.max(W, H * 1.25) * 0.6;
      const viewH = H - (g.dashH || 0) * 0.55;
      const shakeY = g.v > 0.3 ? Math.sin(g.t * 13) * Math.min(1.5, g.v * 0.08) + (Math.random() - 0.5) * Math.min(1, g.v * 0.03) : 0;
      const camZ = g.z - 0.8; const base = Math.floor(camZ / SEG); const frac = camZ / SEG - base;
      const camY = T.yAt(camZ) + EYE; const slope = T.slopeAt(camZ + 8);
      const hy = viewH * 0.47 + slope * F + shakeY;
      const sway = Math.sin(g.t * 0.9) * Math.min(0.05, g.v * 0.004);
      // ---- project boundaries ----
      const bx = this.bx, by = this.by, bs = this.bs, bdz = this.bdz, ty = this.ty;
      const n = Math.min(MAXN, T.N - base - 2);
      bdz[0] = NEAR; bs[0] = F / NEAR; ty[0] = T.yAt(camZ + NEAR); bx[0] = W / 2 - sway * bs[0]; by[0] = hy - (ty[0] - camY) * bs[0];
      let X = 0.5 * T.curve[base] * (1 - frac) * (1 - frac), dx = T.curve[base] * (1 - frac);
      let count = 1;
      const jOf = this.jOf || (this.jOf = new Int32Array(MAXN + 3)); jOf.fill(-1); jOf[0] = 0;
      for (let j = 1; j <= n; j++) {
        const i = base + j; const dz = i * SEG - camZ; if (dz < NEAR + 0.05) { X += dx + 0.5 * T.curve[i]; dx += T.curve[i]; continue; }
        jOf[j] = count;
        const s = F / dz; bdz[count] = dz; bs[count] = s; ty[count] = T.y[i]; bx[count] = W / 2 + (X - sway) * s; by[count] = hy - (T.y[i] - camY) * s;
        this.segOf = this.segOf || new Int32Array(MAXN + 2); this.segOf[count] = i;
        X += dx + 0.5 * T.curve[i]; dx += T.curve[i]; count++;
      }
      this.segOf = this.segOf || new Int32Array(MAXN + 2); this.segOf[0] = base;
      const segOf = this.segOf;
      const sky = skyAt(g.hour);
      // ---- background ----
      let outdoorVisible = false; for (let j = 0; j < Math.min(count, 230); j++) if (T.outdoor(T.env[segOf[j]])) { outdoorVisible = true; break; }
      const cam = T.posAt(g.z);
      if (outdoorVisible) this.drawSky(ctx, W, viewH, F, hy, sky, cam, g, camY);
      else { ctx.fillStyle = '#050507'; ctx.fillRect(0, 0, W, H); }
      // ---- world, far to near ----
      const PX = (j, L) => bx[j] + L * bs[j], PY = (j, h) => by[j] - h * bs[j];
      const env = { t: g.t, light: 1, route: T.route, dir: T.dir, z: g.z, night: sky.night, station: null, drop: 8 };
      const peopleBySeg = new Map(); for (const p of (g.people || [])) { const i = Math.floor(p.z / SEG); if (!peopleBySeg.has(i)) peopleBySeg.set(i, []); peopleBySeg.get(i).push(p); }
      const quad = (x1, y1, x2, y2, x3, y3, x4, y4, c, seam = false) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fillStyle = c; ctx.fill(); if (seam) { ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.stroke(); } };
      const strip = (a, b, L0, h0, L1, h1, c, seam) => quad(PX(a, L0), PY(a, h0), PX(a, L1), PY(a, h1), PX(b, L1), PY(b, h1), PX(b, L0), PY(b, h0), c, seam);
      const stripG = (a, b, L0, L1, hA, hB, c, seam) => quad(PX(a, L0), PY(a, hA), PX(a, L1), PY(a, hA), PX(b, L1), PY(b, hB), PX(b, L0), PY(b, hB), c, seam);
      const line = (a, b, L, h, w, c) => { ctx.beginPath(); ctx.moveTo(PX(a, L), PY(a, h)); ctx.lineTo(PX(b, L), PY(b, h)); ctx.lineWidth = Math.max(0.6, w * (bs[a] + bs[b]) * 0.5); ctx.strokeStyle = c; ctx.stroke(); };
      const projZ = (z, L, h) => {
        const f = z / SEG, si = Math.floor(f), u = f - si; let j0 = jOf[si - base], j1 = jOf[si - base + 1];
        if (j1 == null || j1 < 0) return null; if (j0 == null || j0 < 0) j0 = 0;
        const s0 = bs[j0], s1 = bs[j1]; const sc = s0 + (s1 - s0) * u;
        return [PX(j0, L) + (PX(j1, L) - PX(j0, L)) * u, PY(j0, h) + (PY(j1, h) - PY(j0, h)) * u, sc];
      };
      ctx.lineJoin = 'round';
      // spans with level of detail
      const spans = []; for (let j = 0; j < count - 1;) { const step = j < 90 ? 1 : j < 170 ? 2 : 3; const j1 = Math.min(count - 1, j + step); spans.push([j, j1]); j = j1; }
      for (let q = spans.length - 1; q >= 0; q--) {
        const [a, b] = spans[q]; const i = segOf[a]; const e = T.env[i]; const dzA = bdz[a], dzB = bdz[b];
        const stIdx = T.stn[i]; const st = stIdx >= 0 ? T.stations[stIdx] : null; const z = i * SEG;
        const onPlat = st && z >= st.zStart - 0.5 && z < st.zEnd + 0.5;
        env.station = st;
        if (e === 0 || e === 1) this.drawTunnelSpan(ctx, a, b, i, e, z, dzB, onPlat, st, strip, line, stripG, PX, PY, bs, g);
        else this.drawOutdoorSpan(ctx, a, b, i, e, z, dzB, onPlat, st, sky, strip, stripG, line, quad, PX, PY, bs, ty, T, g);
        // sprites & people for every segment inside this span (far to near)
        for (let si = segOf[b] - 1; si >= i; si--) {
          if (si <= base) continue;
          const list = T.sprites[si]; const ppl = peopleBySeg.get(si);
          if (!list && !ppl && !g.opp) continue;
          const j = jOf[si - base]; if (j == null || j < 1) continue;
          const dz = bdz[j]; const isOut = T.outdoor(T.env[si]);
          env.light = isOut ? sky.k : (st && onPlat) ? 1 : U.clamp(Math.pow(Math.max(0, 1 - dz / 150), 1.3), 0.05, 1);
          env.drop = ty[j];
          const haze = isOut ? U.clamp(dz / 700, 0, 0.8) : 0;
          if (list) for (const sp of list) this.drawSprite(ctx, sp, j, si, PX, PY, bs, ty, env, T, g, haze, sky);
          if (g.opp) this.drawOpp(ctx, g.opp, si, j, jOf[si - base + 1], PX, PY, bs, T, env.light);
          if (ppl) {
            ppl.sort((p1, p2) => p2.z - p1.z || p2.L - p1.L);
            for (const p of ppl) { const pr = projZ(p.z, p.L, p.h ?? 1.15); if (!pr) continue; SP.person(ctx, pr[0], pr[1], pr[2], p.p, g.t, p.walk, env.light, p.alpha ?? 1); if (p.bubble && pr[2] > 5) this.bubble(ctx, pr[0], pr[1] - (p.p.h + 0.35) * pr[2], p.bubble, pr[2]); }
          }
        }
      }
      // headlight glow in tunnels
      if (!T.outdoor(T.env[base])) { const gr = ctx.createRadialGradient(W / 2, viewH * 0.82, 10, W / 2, viewH * 0.8, W * 0.5); gr.addColorStop(0, 'rgba(255,240,200,0.10)'); gr.addColorStop(1, 'rgba(255,240,200,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); }
      if (g.rain && outdoorVisible) this.drawRain(ctx, W, H, g);
      if (g.flash) { ctx.fillStyle = g.flash; ctx.fillRect(0, 0, W, H); }
      if (g.showCab !== false) this.drawCab(ctx, W, H, g);
    }

    // ---------------- sky & skyline ----------------
    drawSky(ctx, W, H, F, hy, sky, cam, g, camY) {
      const gr = ctx.createLinearGradient(0, 0, 0, hy); gr.addColorStop(0, U.rgb(sky.top)); gr.addColorStop(1, U.rgb(sky.hor));
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, hy + 2);
      ctx.fillStyle = U.rgb(U.mix(sky.hor, [90, 90, 96], 0.5)); ctx.fillRect(0, hy, W, this.H - hy);
      const rel = (bearing) => U.wrapAngle(bearing - cam.heading);
      const sx = (r) => W / 2 + Math.tan(r) * F;
      if (sky.night > 0.05) { ctx.fillStyle = `rgba(255,255,255,${0.8 * sky.night})`; for (const [b, e, s, ph] of this.stars) { const r = rel(b); if (Math.abs(r) > 1.1) continue; const y = hy - Math.tan(e + 0.05) * F; if (y < 0) continue; ctx.globalAlpha = sky.night * (0.5 + 0.5 * Math.sin(g.t * 2 + ph)); ctx.fillRect(sx(r), y, s, s); } ctx.globalAlpha = 1; }
      // sun / moon
      const h = g.hour; const day = h > 5.8 && h < 18.8;
      const az = day ? Math.PI * (h - 6) / 12 : Math.PI * ((h + 6) % 24 - 6) / 12 + Math.PI;
      const el = day ? Math.sin(Math.PI * (h - 6) / 12) * 0.75 + 0.03 : 0.45;
      const r1 = rel(az);
      if (Math.abs(r1) < 1.1) {
        const x = sx(r1), y = hy - Math.tan(el) * F;
        if (day) { const glow = ctx.createRadialGradient(x, y, 4, x, y, 90); glow.addColorStop(0, 'rgba(255,240,180,.75)'); glow.addColorStop(1, 'rgba(255,240,180,0)'); ctx.fillStyle = glow; ctx.fillRect(x - 90, y - 90, 180, 180); ctx.beginPath(); ctx.arc(x, y, 24, 0, 7); ctx.fillStyle = '#fff3b0'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#ffcc4d'; ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(x, y, 18, 0, 7); ctx.fillStyle = '#f5f3e1'; ctx.fill(); ctx.beginPath(); ctx.arc(x + 8, y - 4, 16, 0, 7); ctx.fillStyle = U.rgb(sky.top); ctx.fill(); }
      }
      // clouds
      for (const c of this.clouds) {
        const r = rel(c.b + g.t * 0.004); if (Math.abs(r) > 1.15) continue; const x = sx(r), y = hy - Math.tan(c.e) * F, s = c.s * 34;
        ctx.fillStyle = sky.night > 0.5 ? 'rgba(120,120,160,.45)' : 'rgba(255,255,255,.92)'; ctx.strokeStyle = 'rgba(30,30,50,.25)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, s * 0.6, 0, 7); ctx.arc(x - s * 0.7, y + s * 0.15, s * 0.45, 0, 7); ctx.arc(x + s * 0.7, y + s * 0.12, s * 0.5, 0, 7); ctx.arc(x + s * 0.2, y - s * 0.3, s * 0.45, 0, 7); ctx.fill();
      }
      // distant city band along the horizon
      const haze = U.mix(sky.hor, [120, 125, 140], 0.35);
      ctx.fillStyle = U.rgb(haze); ctx.beginPath(); ctx.moveTo(0, hy + 2);
      for (let x = 0; x <= W; x += 6) { const b = cam.heading + Math.atan((x - W / 2) / F); const hh = (U.noise1(b * 40) * 0.65 + U.noise1(b * 160) * 0.35) * 16 + 2; ctx.lineTo(x, hy - hh); }
      ctx.lineTo(W, hy + 2); ctx.closePath(); ctx.fill();
      // real skyline objects, far to near
      const alt = camY + 12; const items = [];
      for (const o of net.skyline) {
        const dx = o.x - cam.x, dy = o.y - cam.y; const d = Math.hypot(dx, dy); if (d < 700 || d > 26000) continue;
        const r = rel(Math.atan2(dy, dx)); if (Math.abs(r) > 1.0) continue; items.push([d, r, o]);
      }
      items.sort((p, q) => q[0] - p[0]);
      for (const [d, r, o] of items) {
        const x = sx(r), base = hy + Math.max(0, alt) / d * F; const hpx = o.h * 1.7 / d * F; if (hpx < 1.5) continue;
        const fade = U.clamp(d / 22000, 0, 0.85);
        if (o.kind === 'box') {
          const w = Math.max(2, o.w * 1.3 / d * F); const col = U.mix(U.mix([150, 160, 178], [110, 118, 140], (o.seed % 7) / 7), haze, fade);
          ctx.fillStyle = U.rgb(col); ctx.fillRect(x - w / 2, base - hpx, w, hpx);
          if (w > 4) { ctx.strokeStyle = `rgba(20,20,30,${0.5 * (1 - fade)})`; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2, base - hpx, w, hpx); }
          if (sky.night > 0.3 && w > 3) { ctx.fillStyle = `rgba(255,230,140,${0.7 * sky.night})`; const rr = U.rng(o.seed); for (let k = 0; k < Math.min(20, hpx / 4); k++) if (rr() < 0.5) ctx.fillRect(x - w / 2 + rr() * (w - 2), base - hpx + rr() * hpx, 1.5, 1.5); }
        } else {
          ctx.save(); ctx.globalAlpha = 1 - fade * 0.7; const size = hpx / (o.kind === 'esb' ? 1.32 : o.kind === 'wtc' ? 1.4 : o.kind === 'chrysler' ? 1.4 : o.kind === 'bridge' ? 1.0 : 1.05);
          if (o.kind === 'slim' || o.kind === 'tower' || o.kind === 'citi' || o.kind === 'woolworth') {
            const w = Math.max(2, (o.kind === 'slim' ? 20 : 45) * 1.3 / d * F); ctx.fillStyle = U.rgb(U.mix([170, 185, 205], haze, fade)); ctx.beginPath();
            if (o.kind === 'citi') { ctx.moveTo(x - w / 2, base); ctx.lineTo(x - w / 2, base - hpx * 0.85); ctx.lineTo(x + w / 2, base - hpx); ctx.lineTo(x + w / 2, base); }
            else if (o.kind === 'woolworth') { ctx.moveTo(x - w / 2, base); ctx.lineTo(x - w / 2, base - hpx * 0.7); ctx.lineTo(x - w / 4, base - hpx * 0.85); ctx.lineTo(x, base - hpx); ctx.lineTo(x + w / 4, base - hpx * 0.85); ctx.lineTo(x + w / 2, base - hpx * 0.7); ctx.lineTo(x + w / 2, base); }
            else ctx.rect(x - w / 2, base - hpx, w, hpx);
            ctx.fill(); ctx.strokeStyle = `rgba(20,20,30,${0.6 * (1 - fade)})`; ctx.lineWidth = 1; ctx.stroke();
          } else ICON.draw(ctx, o.kind, x, base, size, g.t);
          ctx.restore();
        }
      }
    }

    // ---------------- tunnel / tube / underground station ----------------
    drawTunnelSpan(ctx, a, b, i, e, z, dz, onPlat, st, strip, line, stripG, PX, PY, bs, g) {
      if (e === 1 && !onPlat) return this.drawTube(ctx, a, b, i, z, dz, strip, line, PX, PY, bs);
      const fog = Math.pow(Math.max(0, 1 - dz / 160), 1.25);
      const zm = z % 20; const pool = Math.exp(-((zm - 7) * (zm - 7)) / 20);
      let k = fog * (0.42 + 0.58 * pool); if (onPlat) k = U.clamp(1 - dz / 420, 0.35, 1);
      const S = (c, kk = k) => U.shade(c, kk);
      // adjacent track (left) behind the column line
      strip(a, b, -7.6, 0, -7.6, 4.6, S([34, 34, 40], k * 0.8), true);
      strip(a, b, -7.6, 0, -2.6, 0, S([52, 47, 44], k * 0.7), true);
      if (bs[a] > 2) { line(a, b, -5.82, 0.15, 0.07, S([150, 150, 156], k * 0.8)); line(a, b, -4.38, 0.15, 0.07, S([150, 150, 156], k * 0.8)); }
      const ceilH = onPlat ? 4.6 : 4.4;
      if (onPlat) {
        const m = st.mosaic;
        strip(a, b, -7.6, ceilH, 8.0, ceilH, S([196, 196, 190]), true);
        strip(a, b, 8.0, 1.15, 8.0, ceilH, S([236, 229, 206]), true);
        strip(a, b, 8.0, 1.15, 8.0, 1.7, S(m, k * 0.75));
        strip(a, b, 8.0, 3.5, 8.0, 3.9, S(m));
        if (bs[a] > 18) for (let h = 1.95; h < 3.5; h += 0.3) line(a, b, 8.0, h, 0.012, S([205, 198, 178]));
        strip(a, b, -2.6, 0, 1.55, 0, S([70, 63, 56]));
        strip(a, b, 1.55, 0, 1.55, 1.15, S([96, 94, 90]));
        strip(a, b, 1.55, 1.15, 8.0, 1.15, S([176, 172, 164]), true);
        strip(a, b, 1.55, 1.15, 2.1, 1.15, S([246, 205, 34]));
        line(a, b, 1.55, 1.15, 0.03, INK);
        line(a, b, 8.0, 1.15, 0.02, S([60, 60, 60]));
      } else {
        strip(a, b, -7.6, ceilH, 2.4, ceilH, S([86, 84, 82], k * 0.9), true);
        strip(a, b, 2.4, 0, 2.4, ceilH, S([124, 120, 112]), true);
        strip(a, b, 2.4, 2.9, 2.4, 3.15, S([62, 58, 54]));
        strip(a, b, -2.6, 0, 2.4, 0, S([72, 64, 56], k * 1.05), true);
        // third rail with its wooden cover board
        strip(a, b, 1.45, 0.36, 1.82, 0.36, S([176, 144, 82]));
        strip(a, b, 1.45, 0.36, 1.45, 0.18, S([120, 98, 58]));
      }
      this.ties(ctx, a, b, i, PX, PY, k, bs);
      if (bs[a] > 1) { line(a, b, -0.72, 0.15, 0.075, S([205, 205, 212], Math.min(1, k * 1.3))); line(a, b, 0.72, 0.15, 0.075, S([205, 205, 212], Math.min(1, k * 1.3))); }
    }
    ties(ctx, a, b, i, PX, PY, k, bs) {
      if (bs[a] < 1.2) return; const c = U.shade(i % 2 ? [96, 66, 44] : [82, 56, 38], k);
      const t0 = 0.0, t1 = 0.22; const lerp = (u) => [PX(a, -1.3) + (PX(b, -1.3) - PX(a, -1.3)) * u, PY(a, 0.02) + (PY(b, 0.02) - PY(a, 0.02)) * u, PX(a, 1.3) + (PX(b, 1.3) - PX(a, 1.3)) * u];
      const [x1, y1, x2] = lerp(t0), [x3, y3, x4] = lerp(t1);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y1); ctx.lineTo(x4, y3); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fillStyle = c; ctx.fill();
    }
    drawTube(ctx, a, b, i, z, dz, strip, line, PX, PY, bs) {
      // circular cast-iron river tunnel
      const fog = Math.pow(Math.max(0, 1 - dz / 150), 1.25); const zm = z % 18; const pool = Math.exp(-((zm - 8) * (zm - 8)) / 16); const k = fog * (0.4 + 0.6 * pool);
      const R = 3.0, cy = 2.0, NSEG = 12; const rib = i % 2 === 0; const th0 = -0.73, th1 = Math.PI + 0.73;
      for (let q = 0; q < NSEG; q++) {
        const t0 = th0 + (th1 - th0) * q / NSEG, t1 = th0 + (th1 - th0) * (q + 1) / NSEG;
        const shade = 0.72 + 0.28 * Math.sin(t0);
        strip(a, b, R * Math.cos(t0), cy + R * Math.sin(t0), R * Math.cos(t1), cy + R * Math.sin(t1), U.shade(rib ? [70, 68, 74] : [98, 94, 96], k * shade));
      }
      strip(a, b, -2.4, 0, 2.4, 0, U.shade([66, 60, 54], k));
      strip(a, b, 1.6, 0.9, 2.7, 0.9, U.shade([120, 116, 108], k)); strip(a, b, 1.6, 0, 1.6, 0.9, U.shade([90, 86, 80], k));
      this.ties(ctx, a, b, i, PX, PY, k, bs);
      if (bs[a] > 1) { line(a, b, -0.72, 0.15, 0.075, U.shade([205, 205, 212], Math.min(1, k * 1.3))); line(a, b, 0.72, 0.15, 0.075, U.shade([205, 205, 212], Math.min(1, k * 1.3))); }
    }

    // ---------------- outdoor: elevated, bridge, open cut / grade ----------------
    drawOutdoorSpan(ctx, a, b, i, e, z, dz, onPlat, st, sky, strip, stripG, line, quad, PX, PY, bs, ty, T, g) {
      const hz = U.clamp(dz / 650, 0, 0.85); const k = sky.k; const fog = sky.hor;
      const S = (c, kk = k) => U.shade(c, kk, fog, hz);
      const gA = -ty[a], gB = -ty[b]; // ground (street / water) height relative to track
      if (e === 3) { // bridge over water
        stripG(a, b, -400, 400, gA, gB, S([46, 118, 176]), false);
        if (bs[a] > 0.3 && (i * 7919) % 5 === 0) { const L = ((i * 31) % 120) - 60; stripG(a, b, L, L + 3, gA + 0.01, gB + 0.01, S([200, 235, 255]), false); }
      } else {
        const cut = e === 4 && ty[a] < -1; // in an open cut the street is above our heads, hidden by the walls
        if (!cut) stripG(a, b, -300, 300, gA, gB, S(e === 4 ? [116, 160, 92] : [118, 116, 112]), true);
        if (e === 2) { stripG(a, b, -9, 9, gA, gB, S([74, 74, 82])); if (i % 6 < 3) stripG(a, b, -0.15, 0.15, gA + 0.01, gB + 0.01, S([240, 210, 60]), false); stripG(a, b, 9, 12, gA, gB, S([176, 172, 164])); stripG(a, b, -12, -9, gA, gB, S([176, 172, 164])); }
        this.buildingsSpan(ctx, a, b, z, T, PX, PY, bs, gA, gB, S, sky, g, e);
      }
      if (e === 4) { // open cut / at grade / embankment
        if (ty[a] < -1) { // cut: concrete retaining walls up to street level
          quad(PX(a, 4.0), PY(a, 0), PX(a, 4.0), PY(a, gA + 0.8), PX(b, 4.0), PY(b, gB + 0.8), PX(b, 4.0), PY(b, 0), S([176, 168, 154]));
          quad(PX(a, -6.8), PY(a, 0), PX(a, -6.8), PY(a, gA + 0.8), PX(b, -6.8), PY(b, gB + 0.8), PX(b, -6.8), PY(b, 0), S([150, 144, 132]));
          line(a, b, 4.0, gA + 0.8, 0.05, INK); line(a, b, -6.8, gA + 0.8, 0.05, INK);
          if (bs[a] > 2) { line(a, b, 4.0, gA + 1.6, 0.03, S([90, 96, 104])); line(a, b, -6.8, gA + 1.6, 0.03, S([90, 96, 104])); }
        } else {
          stripG(a, b, -7, 4.2, 0, 0, S([128, 118, 106]));
          if (ty[a] > 1) stripG(a, b, 4.2, 9, 0, -ty[a] * 0.9, S([110, 160, 90]));
          if (bs[a] > 2) { line(a, b, 5.2, 1.8, 0.03, S([90, 96, 104])); strip(a, b, 5.2, 0, 5.2, 1.8, `rgba(170,180,190,${0.22 * (1 - hz)})`, false); }
        }
        strip(a, b, -1.8, 0, 1.8, 0, S([120, 108, 96]));
        if (bs[a] > 2) { line(a, b, -5.12, 0.15, 0.07, S([180, 180, 186])); line(a, b, -3.68, 0.15, 0.07, S([180, 180, 186])); }
      } else {
        // elevated / bridge deck
        strip(a, b, -1.9, 0, 1.9, 0, S([66, 62, 58]), true);
        strip(a, b, -5.6, 0, -2.3, 0, S([66, 62, 58]));
        strip(a, b, -2.3, 0, -2.3, -1.3, S(e === 3 ? [86, 112, 150] : [72, 112, 92]));
        if (bs[a] > 2) { line(a, b, -4.67, 0.15, 0.07, S([170, 170, 176])); line(a, b, -3.23, 0.15, 0.07, S([170, 170, 176])); }
        if (!onPlat) { strip(a, b, 2.0, 0, 2.8, 0, S([96, 96, 100])); line(a, b, 2.8, 1.0, 0.04, S([50, 80, 66])); line(a, b, 2.8, 0.5, 0.025, S([50, 80, 66])); if (i % 2 === 0 && bs[a] > 3) { ctx.beginPath(); ctx.moveTo(PX(a, 2.8), PY(a, 0)); ctx.lineTo(PX(a, 2.8), PY(a, 1.0)); ctx.lineWidth = Math.max(0.6, 0.04 * bs[a]); ctx.strokeStyle = S([50, 80, 66]); ctx.stroke(); } }
        if (e === 3) this.trussSpan(ctx, a, b, i, z, T, PX, PY, bs, S, line);
      }
      if (onPlat) {
        strip(a, b, 1.55, 0, 1.55, 1.15, S([110, 106, 100]));
        strip(a, b, 1.55, 1.15, 6.2, 1.15, S([168, 160, 150]), true);
        strip(a, b, 1.55, 1.15, 2.1, 1.15, S([246, 205, 34]));
        line(a, b, 1.55, 1.15, 0.03, INK);
        strip(a, b, 6.2, 1.15, 6.2, 2.3, `rgba(40,80,60,${0.55})`, false); line(a, b, 6.2, 2.3, 0.05, S([40, 80, 60]));
        strip(a, b, 2.0, 4.05, 6.4, 4.05, S([78, 120, 98], k * 0.8));
        strip(a, b, 2.0, 3.7, 2.0, 4.05, S([214, 214, 204]));
        line(a, b, 2.0, 3.7, 0.03, INK);
      }
      this.ties(ctx, a, b, i, PX, PY, k * (1 - hz * 0.5), bs);
      if (bs[a] > 1) { line(a, b, -0.72, 0.15, 0.075, S([215, 215, 222])); line(a, b, 0.72, 0.15, 0.075, S([215, 215, 222])); }
    }
    buildingsSpan(ctx, a, b, z, T, PX, PY, bs, gA, gB, S, sky, g, e) {
      if (bs[a] < 0.25) return;
      for (const side of ['left', 'right']) {
        const list = T.buildings[side]; let lo = 0, hi = list.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].z0 <= z) lo = m; else hi = m - 1; }
        const bld = list[lo]; if (!bld || z > bld.z1) continue;
        const L = e === 4 ? bld.L * 0.8 : bld.L; const hgt = e === 4 ? Math.min(bld.h, 11) : bld.h;
        const tA = gA + hgt, tB = gB + hgt;
        const c = S(bld.col);
        ctx.beginPath(); ctx.moveTo(PX(a, L), PY(a, gA)); ctx.lineTo(PX(a, L), PY(a, tA)); ctx.lineTo(PX(b, L), PY(b, tB)); ctx.lineTo(PX(b, L), PY(b, gB)); ctx.closePath(); ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(PX(a, L), PY(a, tA)); ctx.lineTo(PX(b, L), PY(b, tB)); ctx.lineWidth = Math.max(1, 0.06 * bs[a]); ctx.strokeStyle = INK; ctx.stroke();
        if (Math.abs(z - bld.z0) < 2.1 || Math.abs(z - bld.z1) < 2.1) { ctx.beginPath(); ctx.moveTo(PX(a, L), PY(a, gA)); ctx.lineTo(PX(a, L), PY(a, tA)); ctx.lineWidth = Math.max(1, 0.05 * bs[a]); ctx.strokeStyle = INK; ctx.stroke(); }
        // windows
        if (bs[a] > 5) {
          const floors = Math.floor(hgt / 3.1); const lit = sky.night > 0.3;
          for (let f = 1; f < floors; f++) {
            const h0 = gA + f * 3.1 + 0.9, h1 = h0 + 1.4; const u0 = 0.25, u1 = 0.75;
            const xa = PX(a, L) + (PX(b, L) - PX(a, L)) * u0, xb = PX(a, L) + (PX(b, L) - PX(a, L)) * u1;
            const ya0 = PY(a, h0) + (PY(b, h0) - PY(a, h0)) * u0, ya1 = PY(a, h1) + (PY(b, h1) - PY(a, h1)) * u0, yb0 = PY(a, h0) + (PY(b, h0) - PY(a, h0)) * u1, yb1 = PY(a, h1) + (PY(b, h1) - PY(a, h1)) * u1;
            const on = lit && ((bld.seed + f * 7 + Math.floor(z)) % 5 < 2);
            ctx.beginPath(); ctx.moveTo(xa, ya0); ctx.lineTo(xa, ya1); ctx.lineTo(xb, yb1); ctx.lineTo(xb, yb0); ctx.closePath(); ctx.fillStyle = on ? '#ffe28a' : S([58, 76, 104]); ctx.fill();
          }
          // shop awning at street level
          if (bld.shop) { const h0 = gA + 2.8, h1 = gA + 3.4; ctx.beginPath(); ctx.moveTo(PX(a, L), PY(a, h0)); ctx.lineTo(PX(a, L), PY(a, h1)); ctx.lineTo(PX(b, L), PY(b, h1)); ctx.lineTo(PX(b, L), PY(b, h0)); ctx.closePath(); ctx.fillStyle = S(bld.awning); ctx.fill(); }
        }
        // rooftop props at the building's middle
        const mid = (bld.z0 + bld.z1) / 2;
        if (mid >= z && mid < z + T.SEG * (b - a)) {
          const s = bs[a]; const x = PX(a, L), y = PY(a, tA);
          if (bld.tower && s > 0.6) this.waterTower(ctx, x, y, s, S);
          if (bld.board && s > 0.6) this.billboard(ctx, x, y, s, bld.seed, side);
          if (bld.shop && s > 6) { const y2 = PY(a, gA + 3.1); ctx.font = `900 ${Math.min(0.5 * s, 40)}px Helvetica, Arial`; ctx.textAlign = side === 'left' ? 'right' : 'left'; ctx.textBaseline = 'middle'; ctx.lineWidth = Math.max(1, s * 0.06); ctx.strokeStyle = INK; ctx.fillStyle = '#fff'; ctx.strokeText(bld.shop, x + (side === 'left' ? -4 : 4), y2); ctx.fillText(bld.shop, x + (side === 'left' ? -4 : 4), y2); }
        }
      }
    }
    waterTower(ctx, x, y, s, S) {
      const w = 3.2 * s, h = 3.4 * s, legs = 2.4 * s; ctx.lineWidth = Math.max(1, s * 0.08); ctx.strokeStyle = INK;
      ctx.beginPath(); ctx.moveTo(x - w * 0.4, y); ctx.lineTo(x - w * 0.35, y - legs); ctx.moveTo(x + w * 0.4, y); ctx.lineTo(x + w * 0.35, y - legs); ctx.moveTo(x - w * 0.38, y - legs * 0.4); ctx.lineTo(x + w * 0.38, y - legs * 0.8); ctx.stroke();
      ctx.fillStyle = S([140, 92, 56]); U.roundRect(ctx, x - w / 2, y - legs - h, w, h, w * 0.08); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = S([90, 58, 34]); for (let q = 1; q < 4; q++) { ctx.beginPath(); ctx.moveTo(x - w / 2, y - legs - h * q / 4); ctx.lineTo(x + w / 2, y - legs - h * q / 4); ctx.stroke(); }
      ctx.strokeStyle = INK; ctx.fillStyle = S([110, 72, 44]); ctx.beginPath(); ctx.moveTo(x - w * 0.56, y - legs - h); ctx.lineTo(x, y - legs - h - w * 0.45); ctx.lineTo(x + w * 0.56, y - legs - h); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    billboard(ctx, x, y, s, seed, side) {
      const ads = [['PIZZA $1', '#ffd23f', '#d63031'], ['SEE BROADWAY!', '#ff3d6e', '#fff'], ['BAGELS 24/7', '#3dd6ff', '#1b1b1b'], ['RIDE THE SUBWAY', '#0039a6', '#fff'], ['I ♥ NY', '#fff', '#e8343a'], ['CONEY ISLAND', '#7ae05a', '#1b1b1b']];
      const [t, bg, fg] = ads[seed % ads.length]; const w = 8 * s, h = 3 * s; const x0 = side === 'left' ? x - w * 0.8 : x - w * 0.2;
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.08); ctx.beginPath(); ctx.moveTo(x0 + w * 0.2, y); ctx.lineTo(x0 + w * 0.2, y - 1.5 * s); ctx.moveTo(x0 + w * 0.8, y); ctx.lineTo(x0 + w * 0.8, y - 1.5 * s); ctx.stroke();
      ctx.fillStyle = bg; ctx.fillRect(x0, y - 1.5 * s - h, w, h); ctx.strokeRect(x0, y - 1.5 * s - h, w, h);
      if (h > 8) { ctx.font = `900 ${h * 0.38}px "Arial Black", Helvetica`; ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x0 + w / 2, y - 1.5 * s - h / 2, w * 0.9); }
    }
    trussSpan(ctx, a, b, i, z, T, PX, PY, bs, S, line) {
      const c = S([86, 112, 150]);
      for (const L of [3.2, -6.9]) {
        line(a, b, L, 3.4, 0.12, c); line(a, b, L, 0.1, 0.12, c);
        if (bs[a] > 1.2) { ctx.beginPath(); if (i % 2) { ctx.moveTo(PX(a, L), PY(a, 0.1)); ctx.lineTo(PX(b, L), PY(b, 3.4)); } else { ctx.moveTo(PX(a, L), PY(a, 3.4)); ctx.lineTo(PX(b, L), PY(b, 0.1)); } ctx.lineWidth = Math.max(0.6, 0.07 * bs[a]); ctx.strokeStyle = c; ctx.stroke(); }
      }
      const w = T.water.find(o => o.bridge && o.famous && z >= o.wa - 30 && z <= o.wb + 30);
      if (w) for (const L of [3.6, -6.6]) { const ca = this.cableH(w, z), cb = this.cableH(w, z + T.SEG * (b - a)); ctx.beginPath(); ctx.moveTo(PX(a, L), PY(a, ca)); ctx.lineTo(PX(b, L), PY(b, cb)); ctx.lineWidth = Math.max(1, 0.35 * bs[a]); ctx.strokeStyle = S([70, 92, 126]); ctx.stroke(); }
    }
    cableH(w, z) {
      if (z < w.t0) return U.lerp(3.4, 55, U.clamp((z - w.wa) / (w.t0 - w.wa), 0, 1));
      if (z > w.t1) return U.lerp(55, 3.4, U.clamp((z - w.t1) / (w.wb - w.t1), 0, 1));
      const m = (w.t0 + w.t1) / 2, hw = (w.t1 - w.t0) / 2; const u = (z - m) / hw; return 6 + 49 * u * u;
    }

    // ---------------- sprites with special placement ----------------
    drawSprite(ctx, sp, j, si, PX, PY, bs, ty, env, T, g, haze, sky) {
      const s = bs[j];
      switch (sp.k) {
        case 'portal': { // tunnel mouth seen from outside
          const gtop = Math.max(5, -ty[j] + 1.5); const c = U.shade([150, 142, 130], sky.k, sky.hor, haze), x0 = PX(j, -2.9), x1 = PX(j, 2.7), yT = PY(j, 4.7), yB = PY(j, -0.5), yTop = PY(j, gtop);
          ctx.fillStyle = c; ctx.fillRect(PX(j, -30), yTop, x0 - PX(j, -30), yB - yTop); ctx.fillRect(x1, yTop, PX(j, 30) - x1, yB - yTop); ctx.fillRect(x0, yTop, x1 - x0, yT - yTop);
          ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1.5, s * 0.08); ctx.strokeRect(x0, yT, x1 - x0, yB - yT);
          ctx.fillStyle = U.shade([120, 112, 100], sky.k, sky.hor, haze); ctx.fillRect(x0 - s * 0.4, yT - s * 0.5, x1 - x0 + s * 0.8, s * 0.5);
          return;
        }
        case 'tower': { // suspension bridge tower
          const c = U.shade([96, 122, 160], sky.k, sky.hor, haze); ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1.5, s * 0.15);
          for (const L of [4.6, -8.2]) { const x = PX(j, L), w = 1.6 * s; ctx.fillStyle = c; ctx.fillRect(x - w / 2, PY(j, 60), w, PY(j, -ty[j]) - PY(j, 60)); ctx.strokeRect(x - w / 2, PY(j, 60), w, PY(j, -ty[j]) - PY(j, 60)); }
          ctx.fillStyle = c; const xa = PX(j, -9), xb = PX(j, 5.4); ctx.fillRect(xa, PY(j, 60), xb - xa, 2.4 * s); ctx.strokeRect(xa, PY(j, 60), xb - xa, 2.4 * s);
          ctx.beginPath(); ctx.moveTo(xa, PY(j, 46)); ctx.quadraticCurveTo((xa + xb) / 2, PY(j, 54), xb, PY(j, 46)); ctx.lineWidth = Math.max(2, s * 0.6); ctx.strokeStyle = c; ctx.stroke(); ctx.lineWidth = Math.max(1, s * 0.12); ctx.strokeStyle = INK; ctx.stroke();
          return;
        }
        case 'suspender': { const w = T.water.find(o => o.bridge && o.famous && si * T.SEG >= o.wa && si * T.SEG <= o.wb); if (!w) return; const h = this.cableH(w, si * T.SEG); ctx.beginPath(); ctx.moveTo(PX(j, sp.L), PY(j, 3.4)); ctx.lineTo(PX(j, sp.L), PY(j, h)); ctx.lineWidth = Math.max(0.5, 0.05 * s); ctx.strokeStyle = U.shade([70, 92, 126], sky.k, sky.hor, haze); ctx.stroke(); return; }
        case 'rib': { // cast iron ring
          const R = 3.0, cy = 2.0; ctx.beginPath(); ctx.arc(PX(j, 0), PY(j, cy), R * s, -(Math.PI + 0.73), 0.73); ctx.lineWidth = Math.max(1, 0.18 * s); ctx.strokeStyle = U.shade([50, 48, 54], env.light); ctx.stroke(); return;
        }
        case 'endwall': { // end of an underground station box, seen from the platform
          const m = sp.st.mosaic, k = env.light, x0 = PX(j, 2.4), x1 = PX(j, 8.0), y0 = PY(j, 0), y1 = PY(j, 4.6);
          ctx.fillStyle = U.shade([226, 219, 196], k); ctx.fillRect(x0, y1, x1 - x0, y0 - y1);
          ctx.fillStyle = U.shade(m, k); ctx.fillRect(x0, PY(j, 3.9), x1 - x0, PY(j, 3.5) - PY(j, 3.9)); ctx.fillRect(x0, PY(j, 1.7), x1 - x0, PY(j, 1.15) - PY(j, 1.7));
          ctx.fillStyle = U.shade([96, 94, 90], k); ctx.fillRect(x0, PY(j, 1.15), PX(j, 1.55) - x0 + (x1 - x0) * 0, y0 - PY(j, 1.15));
          ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.04); ctx.strokeRect(x0, y1, x1 - x0, y0 - y1);
          if (s > 6) { const ex = PX(j, 5.2), ey = PY(j, 3.0), w = 1.0 * s, h = 0.4 * s; ctx.fillStyle = '#0c6b3a'; ctx.fillRect(ex - w / 2, ey - h, w, h); ctx.font = `900 ${h * 0.7}px Helvetica`; ctx.fillStyle = '#eaffea'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('EXIT', ex, ey - h / 2); }
          return;
        }
        case 'tubeface': { // box tunnel narrowing into a round river tube
          const k = env.light; ctx.beginPath(); ctx.rect(PX(j, -7.6), PY(j, 4.4), PX(j, 2.4) - PX(j, -7.6), PY(j, 0) - PY(j, 4.4)); ctx.moveTo(PX(j, 0) + 3 * s, PY(j, 2)); ctx.arc(PX(j, 0), PY(j, 2), 3 * s, 0, U.TAU, true);
          ctx.fillStyle = U.shade([92, 88, 84], k); ctx.fill('evenodd'); ctx.beginPath(); ctx.arc(PX(j, 0), PY(j, 2), 3 * s, 0, U.TAU); ctx.lineWidth = Math.max(1, 0.25 * s); ctx.strokeStyle = U.shade([40, 38, 44], k); ctx.stroke();
          return;
        }
        case 'tree': case 'pole': { SP.draw(ctx, sp, PX(j, sp.L), PY(j, Math.max(0, -ty[j])), s, env); return; }
        case 'elcol': { SP.draw(ctx, sp, PX(j, sp.L), PY(j, -0.1), s, env); return; }
        default: SP.draw(ctx, sp, PX(j, sp.L), PY(j, sp.h || 0), s, env);
      }
    }

    drawOpp(ctx, o, si, j, j2, PX, PY, bs, T, light) {
      const z = si * T.SEG; if (z < o.z - T.SEG || z > o.z + o.len) return;
      const s = bs[j]; const k = Math.max(0.4, light); const body = U.shade([206, 210, 220], k);
      if (j2 != null && j2 > 0 && z >= o.z) {
        ctx.beginPath(); ctx.moveTo(PX(j, -3.75), PY(j, 0.9)); ctx.lineTo(PX(j, -3.75), PY(j, 3.9)); ctx.lineTo(PX(j2, -3.75), PY(j2, 3.9)); ctx.lineTo(PX(j2, -3.75), PY(j2, 0.9)); ctx.closePath(); ctx.fillStyle = body; ctx.fill();
        if (si % 9 < 5) { ctx.beginPath(); ctx.moveTo(PX(j, -3.75), PY(j, 2.0)); ctx.lineTo(PX(j, -3.75), PY(j, 3.1)); ctx.lineTo(PX(j2, -3.75), PY(j2, 3.1)); ctx.lineTo(PX(j2, -3.75), PY(j2, 2.0)); ctx.closePath(); ctx.fillStyle = '#ffe9a0'; ctx.fill(); }
        if (si % 9 === 0) { ctx.beginPath(); ctx.moveTo(PX(j, -3.75), PY(j, 0.9)); ctx.lineTo(PX(j, -3.75), PY(j, 3.9)); ctx.lineWidth = Math.max(1, s * 0.05); ctx.strokeStyle = INK; ctx.stroke(); }
      }
      if (Math.floor(o.z / T.SEG) === si) { // front face
        const xa = PX(j, -6.6), xb = PX(j, -3.75), yT = PY(j, 3.9), yB = PY(j, 0.9);
        ctx.fillStyle = body; ctx.fillRect(xa, yT, xb - xa, yB - yT); ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.06); ctx.strokeRect(xa, yT, xb - xa, yB - yT);
        ctx.fillStyle = '#1f2a3a'; ctx.fillRect(xa + (xb - xa) * 0.12, yT + (yB - yT) * 0.12, (xb - xa) * 0.76, (yB - yT) * 0.35);
        for (const u of [0.2, 0.8]) { ctx.beginPath(); ctx.arc(xa + (xb - xa) * u, yT + (yB - yT) * 0.8, Math.max(1.5, s * 0.12), 0, 7); ctx.fillStyle = '#fff8c0'; ctx.fill(); }
        if (s > 4) SP.bulletAt(ctx, o.route, (xa + xb) / 2, yT + (yB - yT) * 0.62, s * 0.22);
      }
    }

    bubble(ctx, x, y, text, s) {
      ctx.font = `800 ${U.clamp(s * 0.28, 10, 18)}px Helvetica, Arial`; const w = ctx.measureText(text).width + 14, h = U.clamp(s * 0.28, 10, 18) + 10;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = 2; U.roundRect(ctx, x - w / 2, y - h, w, h, 8); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x, y + 7); ctx.lineTo(x + 4, y); ctx.fill();
      ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y - h / 2);
    }

    drawRain(ctx, W, H, g) {
      ctx.strokeStyle = 'rgba(200,220,255,.45)'; ctx.lineWidth = 1.2; ctx.beginPath();
      for (let i = 0; i < 90; i++) { const x = (i * 97 + g.t * 300 * (1 + (i % 3))) % W, y = (i * 53 + g.t * 900) % H; ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 16); }
      ctx.stroke();
    }

    // ---------------- cab interior overlay ----------------
    drawCab(ctx, W, H, g) {
      const top = Math.max(26, H * 0.055), side = Math.max(18, W * 0.035), dashTop = H - (g.dashH || 0) - 18;
      const key = `${W}x${H}x${dashTop}x${this.dpr}x${g.route ? g.route.id : ''}`;
      if (this.cabKey !== key) { this.cabKey = key; this.cabCanvas = this.cabCanvas || document.createElement('canvas'); const c = this.cabCanvas; c.width = Math.round(W * this.dpr); c.height = Math.round(H * this.dpr); const cx = c.getContext('2d'); cx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); cx.clearRect(0, 0, W, H); this.drawCabStatic(cx, W, H, g, top, side, dashTop); }
      ctx.drawImage(this.cabCanvas, 0, 0, W, H);
      this.drawCabProps(ctx, W, H, g, dashTop);
    }
    drawCabStatic(ctx, W, H, g, top, side, dashTop) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, dashTop + 18); U.roundRectPath(ctx, side, top, W - side * 2, dashTop - top, 26);
      ctx.fillStyle = '#2b303b'; ctx.fill('evenodd');
      ctx.lineWidth = 5; ctx.strokeStyle = '#11141a'; U.roundRect(ctx, side, top, W - side * 2, dashTop - top, 26); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#4b5263'; U.roundRect(ctx, side - 5, top - 5, W - side * 2 + 10, dashTop - top + 10, 30); ctx.stroke();
      ctx.fillStyle = '#596173'; for (let x = side + 30; x < W - side - 20; x += 60) { ctx.beginPath(); ctx.arc(x, top * 0.5, 2.6, 0, 7); ctx.fill(); }
      for (let y = top + 30; y < dashTop - 10; y += 60) { ctx.beginPath(); ctx.arc(side * 0.5, y, 2.6, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(W - side * 0.5, y, 2.6, 0, 7); ctx.fill(); }
      // glare
      ctx.globalAlpha = 0.06; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(W * 0.62, top); ctx.lineTo(W * 0.7, top); ctx.lineTo(W * 0.45, dashTop); ctx.lineTo(W * 0.37, dashTop); ctx.fill(); ctx.globalAlpha = 1;
      // route sign in the corner of the window
      // dash ledge
      ctx.fillStyle = '#20242c'; ctx.beginPath(); ctx.moveTo(0, dashTop + 18); ctx.lineTo(W * 0.04, dashTop); ctx.lineTo(W * 0.96, dashTop); ctx.lineTo(W, dashTop + 18); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#383e4b'; ctx.fillRect(W * 0.04, dashTop, W * 0.92, 3);
      ctx.restore();
    }
    drawCabProps(ctx, W, H, g, dashTop) {
      ctx.save();
      // Statue of Liberty bobblehead
      const bx = W * 0.14, by = dashTop + 4, sc = U.clamp(H * 0.075, 34, 64);
      ctx.save(); ctx.translate(bx, by); ICON.liberty(ctx, sc * 0.55, g.t); ctx.restore();
      ctx.save(); ctx.translate(bx, by - sc * 0.55); ctx.rotate(g.bobble || 0); ctx.translate(0, -sc * 0.15);
      ctx.beginPath(); ctx.arc(0, -sc * 0.18, sc * 0.2, 0, 7); ctx.fillStyle = '#8fd0b3'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(-sc * 0.07, -sc * 0.2, 2, 0, 7); ctx.arc(sc * 0.07, -sc * 0.2, 2, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(0, -sc * 0.13, sc * 0.06, 0.2, Math.PI - 0.2); ctx.stroke();
      ctx.strokeStyle = '#4f9a7a'; ctx.lineWidth = 3; for (let q = -2; q <= 2; q++) { const an = -Math.PI / 2 + q * 0.42; ctx.beginPath(); ctx.moveTo(Math.cos(an) * sc * 0.2, -sc * 0.18 + Math.sin(an) * sc * 0.2); ctx.lineTo(Math.cos(an) * sc * 0.34, -sc * 0.18 + Math.sin(an) * sc * 0.34); ctx.stroke(); }
      ctx.restore();
      // coffee cup (comfort meter): liquid tilts with acceleration
      const cx = W * 0.86, cw = sc * 0.55, ch = sc * 0.7, cy = dashTop + 2;
      ctx.save(); ctx.translate(cx, cy);
      ctx.beginPath(); ctx.moveTo(-cw / 2, -ch); ctx.lineTo(cw / 2, -ch); ctx.lineTo(cw * 0.38, 0); ctx.lineTo(-cw * 0.38, 0); ctx.closePath(); ctx.fillStyle = '#f4f1ea'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.stroke();
      ctx.save(); ctx.clip(); const tilt = U.clamp(g.cupTilt || 0, -0.6, 0.6); const lvl = -ch * 0.82 * U.clamp(g.coffee ?? 1, 0.15, 1);
      ctx.beginPath(); ctx.moveTo(-cw, lvl - Math.tan(tilt) * -cw); ctx.lineTo(cw, lvl - Math.tan(tilt) * cw); ctx.lineTo(cw, 2); ctx.lineTo(-cw, 2); ctx.closePath(); ctx.fillStyle = '#6b3f1f'; ctx.fill(); ctx.restore();
      ctx.fillStyle = '#2f7de1'; ctx.fillRect(-cw * 0.45, -ch * 0.6, cw * 0.9, ch * 0.22); ctx.fillStyle = '#fff'; ctx.font = `900 ${ch * 0.15}px Georgia`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('WE ♥ NY', 0, -ch * 0.49);
      ctx.beginPath(); ctx.arc(cw * 0.5, -ch * 0.55, ch * 0.2, -1.2, 1.2); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
      if (g.spill > 0) { ctx.fillStyle = `rgba(107,63,31,${Math.min(1, g.spill)})`; for (let q = 0; q < 4; q++) { ctx.beginPath(); ctx.arc((q - 1.5) * cw * 0.35 + Math.sin(q * 3) * 4, -ch - 6 - q * 3 * g.spill, 3 + q, 0, 7); ctx.fill(); } }
      ctx.restore();
      ctx.restore();
    }

    // ---------------- conductor's side window (zebra board check) ----------------
    drawSideWindow(ctx, W, H, g) {
      const T = g.track; const st = g.sideStation; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      if (!st) return;
      const mid = g.z - T.TRAIN_LEN / 2; const PPM = W / 22; const X = (z) => W / 2 + (z - mid) * PPM; // forward = right
      const under = st.under; const floorY = H * 0.72;
      if (under) {
        ctx.fillStyle = '#ebe4cc'; ctx.fillRect(0, 0, W, floorY);
        ctx.fillStyle = U.rgb(st.mosaic); ctx.fillRect(0, H * 0.12, W, H * 0.07); ctx.fillRect(0, floorY - H * 0.1, W, H * 0.1);
        ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = 1; for (let y = H * 0.22; y < floorY - H * 0.1; y += 7) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        const off = ((mid * PPM) % 7 + 7) % 7; for (let x = -off; x < W; x += 7) { ctx.beginPath(); ctx.moveTo(x, H * 0.22); ctx.lineTo(x, floorY - H * 0.1); ctx.stroke(); }
        for (let z = Math.floor((mid - 14) / 16) * 16; z < mid + 14; z += 16) { const x = X(z + 8); ctx.fillStyle = U.rgb(st.mosaic); ctx.fillRect(x - 40, H * 0.3, 80, 26); ctx.fillStyle = '#f6eedc'; ctx.fillRect(x - 36, H * 0.3 + 4, 72, 18); ctx.fillStyle = U.rgb(st.mosaic); ctx.font = '900 10px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(st.name.toUpperCase().slice(0, 14), x, H * 0.3 + 13); }
      } else {
        const sky = skyAt(g.hour); const gr = ctx.createLinearGradient(0, 0, 0, floorY); gr.addColorStop(0, U.rgb(sky.top)); gr.addColorStop(1, U.rgb(sky.hor)); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, floorY);
        ctx.fillStyle = '#4e7a64'; ctx.fillRect(0, 0, W, H * 0.1);
        const off = ((mid * PPM) % 28 + 28) % 28; ctx.fillStyle = '#3b5f4d'; for (let x = -off; x < W; x += 28) ctx.fillRect(x, H * 0.1, 4, floorY - H * 0.1);
        ctx.strokeStyle = '#2f4d3e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, floorY - H * 0.25); ctx.lineTo(W, floorY - H * 0.25); ctx.stroke();
      }
      ctx.fillStyle = '#b4aea2'; ctx.fillRect(0, floorY, W, H - floorY); ctx.fillStyle = '#f4c51f'; ctx.fillRect(0, H - 10, W, 6);
      const platX0 = X(st.zStart), platX1 = X(st.zEnd);
      if (platX0 > 0) { ctx.fillStyle = '#121216'; ctx.fillRect(0, 0, platX0, H); }
      if (platX1 < W) { ctx.fillStyle = '#121216'; ctx.fillRect(platX1, 0, W - platX1, H); }
      // people on the platform
      for (const p of (g.people || [])) { const x = X(p.z); if (x < -20 || x > W + 20) continue; const sc = U.lerp(17, 10, U.clamp((p.L - 1.6) / 6, 0, 1)); SP.person(ctx, x, floorY + (8 - p.L) * 2.2 + 6, sc, p.p, g.t, p.walk, 1, p.alpha ?? 1); }
      // the zebra board
      const zx = X(st.zZebra); ctx.fillStyle = '#fff'; ctx.fillRect(zx - 12, H * 0.2, 24, 40); ctx.fillStyle = '#111'; for (let q = 0; q < 5; q++) ctx.fillRect(zx - 12, H * 0.2 + q * 8 + 2, 24, 4); ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.strokeRect(zx - 12, H * 0.2, 24, 40); ctx.fillStyle = '#555'; ctx.fillRect(zx - 1.5, H * 0.2 + 40, 3, floorY - H * 0.2 - 40);
      // window frame + centre reticle
      ctx.strokeStyle = 'rgba(255,45,122,.9)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(W / 2, 4); ctx.lineTo(W / 2, H - 4); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ff2d7a'; ctx.beginPath(); ctx.moveTo(W / 2 - 8, 0); ctx.lineTo(W / 2 + 8, 0); ctx.lineTo(W / 2, 10); ctx.fill();
      ctx.lineWidth = 10; ctx.strokeStyle = '#2b303b'; U.roundRect(ctx, 5, 5, W - 10, H - 10, 16); ctx.stroke();
    }
  }
  FPRenderer.skyAt = skyAt;
  SC.FPRenderer = FPRenderer;
})(window.SC);
