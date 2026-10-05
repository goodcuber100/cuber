// Builds a drivable first-person track from a real MTA route: real station order and
// structure (tunnel / elevated / open cut), curves from the real GTFS geometry, river tubes
// and bridges detected from the real shoreline. Distances are compressed for gameplay.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const U = SC.util, net = SC.net;

  const SEG = 2;                 // metres per track segment
  const TRAIN_LEN = 183;         // a 10-car train (~600 ft)
  const PLAT_BEFORE = 191.5;     // platform starts this far before the stop marker
  const PLAT_AFTER = 8.5;        // ...and ends this far after it
  const LEAD = 250, TAIL = 340;
  const ENV = { TUNNEL: 0, TUBE: 1, EL: 2, BRIDGE: 3, OPEN: 4 };
  const LEVEL = { S: -9, E: 8, V: 11, C: -5, G: 0, B: 4 };
  const MOSAIC = [[150, 40, 50], [30, 80, 150], [40, 120, 70], [190, 140, 40], [120, 50, 120], [180, 80, 40], [40, 130, 140], [110, 110, 40]];
  const [MBX, MBY] = net.toXY(40.7075, -73.9903); // Manhattan Bridge midspan
  const [WBX, WBY] = net.toXY(40.7134, -73.9724); // Williamsburg Bridge midspan
  const SHOPS = ['PIZZA', 'DELI', 'BODEGA', 'LAUNDROMAT', '99¢ STORE', 'BAGELS', 'HARDWARE', 'NAILS', 'PHARMACY', 'CHECKS CASHED', 'DINER', 'TACOS', 'DUMPLINGS', 'BARBER', 'HALAL', 'COFFEE', 'GROCERY', 'PAWN', 'TAILOR', 'DONUTS'];
  const BRICK = [[166, 74, 54], [140, 62, 50], [196, 140, 98], [214, 196, 160], [170, 160, 150], [120, 86, 70], [200, 110, 80], [226, 210, 180], [150, 150, 165], [184, 92, 70]];

  function buildTrack(opts) {
    const r = net.routeById[opts.routeId];
    const dir = opts.dir >= 0 ? 1 : -1;
    const last = r.stops.length - 1;
    const rand = U.rng(U.hash(`${r.id}:${opts.from}:${dir}:${opts.seed || 1}`));
    // stops in travel order
    const ks = []; for (let k = opts.from; k >= 0 && k <= last && ks.length < (opts.count || 999); k += dir) ks.push(k);
    if (ks.length < 2) ks.push(U.clamp(opts.from + dir, 0, last));

    // ---------- station markers along compressed z ----------
    const marker = [LEAD]; const realD = [];
    for (let i = 1; i < ks.length; i++) {
      const D = Math.abs(r.stopD[ks[i]] - r.stopD[ks[i - 1]]); realD.push(D);
      marker.push(marker[i - 1] + U.clamp(D * 0.42, 470, 1500));
    }
    const length = marker[marker.length - 1] + TAIL;
    const N = Math.ceil(length / SEG) + 2;

    // map game z -> real distance along the route (s) for curves & landmarks
    const sAt = (z) => {
      let i = 0; while (i < marker.length - 2 && z > marker[i + 1]) i++;
      const z0 = marker[i], z1 = marker[i + 1] ?? marker[i] + 1, s0 = r.stopD[ks[i]], s1 = r.stopD[ks[i + 1] ?? ks[i]];
      if (z < z0) return U.clamp(s0 - dir * (z0 - z), 0, r.len);
      if (z > z1) return U.clamp(s1 + dir * (z - z1), 0, r.len);
      return s0 + (s1 - s0) * (z - z0) / (z1 - z0);
    };
    const headingAt = (s) => { const a = r.line.at(s - 40), b = r.line.at(s + 40); let h = Math.atan2(b.y - a.y, b.x - a.x); if (dir < 0) h += Math.PI; return h; };
    const posAt = (z) => { const s = sAt(z); const p = r.line.at(s); return { x: p.x, y: p.y, heading: headingAt(s) }; };

    // ---------- stations ----------
    const stations = ks.map((k, i) => {
      const st = net.stations[r.stops[k]];
      const lvl = LEVEL[st.struct] ?? -9;
      const routes = st.transfers.map(ri => net.routes[ri]).filter(x => x.id !== r.id);
      return {
        i, k, st, name: st.name, struct: st.struct, level: lvl, under: lvl < -3,
        zMarker: marker[i], zStart: marker[i] - PLAT_BEFORE, zEnd: marker[i] + PLAT_AFTER, zZebra: marker[i] - TRAIN_LEN / 2,
        mosaic: MOSAIC[U.hash(st.name) % MOSAIC.length], terminal: (k === 0 || k === last), transfers: routes,
        bound: net.boundLabel(r, dir, k),
      };
    });

    // ---------- elevation control points ----------
    const ctrl = [[0, stations[0].level]];
    const water = [];
    for (let i = 0; i < stations.length; i++) {
      const s = stations[i];
      ctrl.push([s.zStart - 25, s.level], [s.zEnd + 25, s.level]);
      if (i === stations.length - 1) break;
      const n = stations[i + 1];
      // find the longest over-water run between these two stops on the real geometry
      const sa = r.stopD[s.k], sb = r.stopD[n.k], steps = Math.max(4, Math.ceil(Math.abs(sb - sa) / 40));
      let best = null, cur = null;
      for (let j = 0; j <= steps; j++) {
        const sd = sa + (sb - sa) * j / steps; const p = r.line.at(sd); const wet = !net.isLand(p.x, p.y);
        if (wet) { if (!cur) cur = { a: j, b: j, x: p.x, y: p.y }; cur.b = j; } else if (cur) { if (!best || cur.b - cur.a > best.b - best.a) best = cur; cur = null; }
      }
      if (cur && (!best || cur.b - cur.a > best.b - best.a)) best = cur;
      const span0 = s.zEnd + 40, span1 = n.zStart - 40;
      if (best && (best.b - best.a) * Math.abs(sb - sa) / steps > 140 && span1 - span0 > 250) {
        const mid = r.line.at(sa + (sb - sa) * (best.a + best.b) / 2 / steps);
        const famous = Math.hypot(mid.x - MBX, mid.y - MBY) < 900 || Math.hypot(mid.x - WBX, mid.y - WBY) < 900;
        const bridge = famous || !(s.under && n.under);
        const za = U.lerp(s.zMarker, n.zMarker, best.a / steps), zb = U.lerp(s.zMarker, n.zMarker, best.b / steps);
        const ramp = 110;
        const wa = U.clamp(za, span0 + ramp, span1 - ramp - 60), wb = U.clamp(zb, wa + 60, span1 - ramp);
        const lvl = bridge ? Math.max(s.level, n.level, 6) + (famous ? 26 : 8) : -24;
        ctrl.push([wa, lvl], [wb, lvl]);
        water.push({ z0: wa - (bridge ? 0 : ramp * 0.6), z1: wb + (bridge ? 0 : ramp * 0.6), bridge, famous, wa, wb });
      }
    }
    ctrl.push([length + 50, stations[stations.length - 1].level]);
    ctrl.sort((a, b) => a[0] - b[0]);
    const yAtZ = (z) => {
      let i = 0; while (i < ctrl.length - 2 && z > ctrl[i + 1][0]) i++;
      const [z0, y0] = ctrl[i], [z1, y1] = ctrl[i + 1] || ctrl[i];
      if (z <= z0) return y0; if (z >= z1) return y1;
      return U.lerp(y0, y1, U.smooth((z - z0) / (z1 - z0)));
    };

    // ---------- per-segment arrays ----------
    const curve = new Float32Array(N), y = new Float32Array(N + 1), env = new Uint8Array(N), stn = new Int16Array(N).fill(-1), limit = new Float32Array(N);
    const sprites = new Array(N);
    const add = (i, sp) => { if (i < 0 || i >= N) return; (sprites[i] = sprites[i] || []).push(sp); };
    for (let i = 0; i <= N; i++) y[i] = yAtZ(i * SEG);
    // curvature from real heading changes (preserves the real total turn)
    const raw = new Float32Array(N);
    let hPrev = headingAt(sAt(0));
    for (let i = 0; i < N; i++) { const h = headingAt(sAt((i + 1) * SEG)); raw[i] = U.wrapAngle(h - hPrev); hPrev = h; }
    for (const s of stations) for (let i = Math.floor((s.zStart - 30) / SEG); i <= Math.ceil((s.zEnd + 15) / SEG); i++) if (i >= 0 && i < N) { raw[i] = 0; stn[i] = s.i; }
    const W = 12; let acc = 0;
    for (let i = 0; i < N; i++) { acc += raw[i]; if (i >= W) acc -= raw[i - W]; const dth = U.clamp(acc / Math.min(i + 1, W), -SEG / 85, SEG / 85); curve[i] = dth * SEG; }
    for (const s of stations) for (let i = Math.floor((s.zStart - 10) / SEG); i <= Math.ceil((s.zEnd + 5) / SEG); i++) if (i >= 0 && i < N) curve[i] = 0;

    // environment
    for (let i = 0; i < N; i++) {
      const z = i * SEG, yy = (y[i] + y[i + 1]) / 2; const w = water.find(o => z >= o.z0 && z <= o.z1);
      if (w && !w.bridge && yy < -4) env[i] = ENV.TUBE;
      else if (yy <= -5.5) env[i] = ENV.TUNNEL;
      else if (w && w.bridge && z >= w.wa - 20 && z <= w.wb + 20) env[i] = ENV.BRIDGE;
      else if (yy >= 4.5) env[i] = ENV.EL;
      else env[i] = ENV.OPEN;
    }
    const outdoor = (e) => e === ENV.EL || e === ENV.BRIDGE || e === ENV.OPEN;

    // ---------- speed limits ----------
    const BASE = [17.9, 17.9, 20.1, 13.4, 22.4];
    for (let i = 0; i < N; i++) {
      let k = 0; for (let j = Math.max(0, i - 20); j < Math.min(N, i + 20); j++) k = Math.max(k, Math.abs(curve[j]) / (SEG * SEG));
      let v = BASE[env[i]]; if (k > 1e-6) v = Math.min(v, Math.sqrt(0.8 / k));
      const mph = Math.max(15, Math.floor(U.mph(v) / 5) * 5); limit[i] = mph / 2.23694;
    }
    // merge tiny limit zones, then place signs where the limit changes
    for (let pass = 0; pass < 2; pass++) for (let i = 1; i < N; i++) if (limit[i] !== limit[i - 1]) { let j = i; while (j < N && limit[j] === limit[i]) j++; if (j - i < 30) for (let q = i; q < j; q++) limit[q] = Math.min(limit[i - 1], limit[q]); }
    const signals = []; const limitSigns = [];
    for (let i = 1; i < N; i++) if (limit[i] !== limit[i - 1] && stn[i] < 0) {
      const gt = limit[i] < limit[i - 1] && rand() < 0.45;
      const sp = { k: 'speed', L: outdoor(env[i]) ? -2.3 : 2.25, h: 2.4, mph: Math.round(U.mph(limit[i])) };
      add(i, sp); limitSigns.push({ z: i * SEG, mph: sp.mph });
      if (gt) { const z = i * SEG - 50; const sig = { id: signals.length, z, state: 'G', gt: true, limit: limit[i], timer: 0 }; signals.push(sig); add(Math.floor(z / SEG), { k: 'signal', sig, L: outdoor(env[i]) ? -2.4 : 2.2, h: 2.0 }); }
    }

    // ---------- signals (automatic block) ----------
    for (let i = 0; i < stations.length - 1; i++) {
      const a = stations[i].zEnd + 45, b = stations[i + 1].zStart - 60;
      for (let z = a; z < b; z += 260 + rand() * 80) {
        const seg = Math.floor(z / SEG); const sig = { id: signals.length, z, state: 'G', gt: false, timer: 0, span: i };
        signals.push(sig); add(seg, { k: 'signal', sig, L: outdoor(env[seg]) ? -2.4 : 2.2, h: 2.0 });
      }
    }
    signals.sort((p, q) => p.z - q.z);

    // ---------- scenery sprites ----------
    for (let i = 0; i < N; i++) {
      const e = env[i], z = i * SEG, st = stn[i] >= 0 ? stations[stn[i]] : null;
      const onPlat = st && z >= st.zStart - 1 && z <= st.zEnd + 1;
      if (e === ENV.TUNNEL) {
        if (i % 2 === 0) add(i, { k: 'col', L: -2.55, h: 0 });
        if (!onPlat && i % 10 === 3) add(i, { k: 'bulb', L: 2.35, h: 3.5 });
        if (!onPlat && i % 90 === 45) add(i, { k: 'bluelight', L: 2.35, h: 2.6 });
        if (!onPlat && i % 75 === 20) add(i, { k: 'exit', L: 2.35, h: 3.0 });
        if (!onPlat && rand() < 0.012) add(i, { k: 'graffiti', L: 2.38, h: 1.2, seed: (rand() * 1e6) | 0 });
        if (!onPlat && rand() < 0.006) add(i, { k: 'rat', L: U.pick([-1.25, 1.2], rand), h: 0, seed: (rand() * 1e6) | 0 });
      } else if (e === ENV.TUBE) {
        if (i % 2 === 0) add(i, { k: 'rib', L: 0, h: 0 });
        if (i % 9 === 4) add(i, { k: 'bulb', L: 2.1, h: 3.1 });
        if (rand() < 0.02) add(i, { k: 'drip', L: -1.5 + 3 * rand(), h: 4.5, seed: (rand() * 1e6) | 0 });
      } else if (e === ENV.EL || e === ENV.OPEN) {
        if (e === ENV.EL && i % 8 === 0 && !onPlat) { add(i, { k: 'elcol', L: 2.1, h: 0 }); add(i, { k: 'elcol', L: -5.6, h: 0 }); }
        if (e === ENV.OPEN && i % 25 === 0 && y[i] > -1) add(i, { k: 'pole', L: 4.6, h: 0 });
        if (e === ENV.OPEN && y[i] > -1 && rand() < 0.05) add(i, { k: 'tree', L: U.pick([-7, -9, 7.5, 10], rand), h: 0, seed: (rand() * 1e6) | 0 });
      } else if (e === ENV.BRIDGE) {
        if (i % 5 === 0) { add(i, { k: 'suspender', L: 3.6 }); add(i, { k: 'suspender', L: -6.6 }); }
      }
      if (e === ENV.TUNNEL && !onPlat && i % 140 === 70) add(i, { k: 'marker', L: 2.3, h: 1.6, num: Math.round(z / 3) });
    }
    // bridge towers
    for (const w of water) if (w.bridge && w.famous) { const span = w.wb - w.wa; add(Math.floor((w.wa + span * 0.18) / SEG), { k: 'tower' }); add(Math.floor((w.wb - span * 0.18) / SEG), { k: 'tower' }); w.t0 = w.wa + span * 0.18; w.t1 = w.wb - span * 0.18; }

    // station furniture
    for (const s of stations) {
      const seg = (z) => Math.floor(z / SEG);
      const under = s.under;
      for (let z = s.zStart + 3; z < s.zEnd - 2; z += 2) {
        const i = seg(z);
        if (under) {
          if (i % 3 === 0) add(i, { k: 'pcol', L: 3.6, h: 1.15 });
          if (i % 2 === 0) add(i, { k: 'tube', L: 2.6, h: 4.5 });
          if (i % 9 === 4) add(i, { k: 'tablet', L: 7.95, h: 2.4, st: s });
          if (i % 16 === 8) add(i, { k: 'hsign', L: 4.6, h: 3.6, st: s });
          if (i % 13 === 6) add(i, { k: 'bench', L: 7.2, h: 1.15 });
          if (i % 29 === 14) add(i, { k: 'trash', L: 7.4, h: 1.15 });
        } else {
          if (i % 4 === 0) add(i, { k: 'post', L: 5.6, h: 1.15 });
          if (i % 12 === 6) add(i, { k: 'namesign', L: 5.6, h: 3.2, st: s });
          if (i % 14 === 3) add(i, { k: 'bench', L: 4.9, h: 1.15 });
          if (i % 16 === 9) add(i, { k: 'lamp', L: 5.6, h: 3.9 });
        }
      }
      add(seg(s.zStart + 40), { k: 'clock', L: under ? 4.6 : 4.2, h: under ? 3.4 : 3.1, st: s });
      add(seg(s.zMarker - 30), { k: 'carstop', L: 1.95, h: 2.3, n: 8 });
      add(seg(s.zMarker), { k: 'carstop', L: 1.95, h: 2.3, n: 10, main: true });
      add(seg(s.zZebra), { k: 'zebra', L: 1.95, h: 2.0 });
      if (s.terminal && s.i === stations.length - 1) add(seg(s.zMarker + 24), { k: 'bumper', L: 0, h: 0 });
      if (under) add(Math.ceil((s.zEnd + 0.5) / SEG), { k: 'endwall', st: s });
    }
    // portals where a tunnel begins ahead of an outdoor section
    for (let i = 1; i < N; i++) {
      const tin = env[i] === ENV.TUNNEL || env[i] === ENV.TUBE, tprev = env[i - 1] === ENV.TUNNEL || env[i - 1] === ENV.TUBE;
      if (tin && !tprev) add(i - 1, { k: 'portal', far: true });
      if (env[i] === ENV.TUBE && env[i - 1] === ENV.TUNNEL) add(i, { k: 'tubeface' });
    }

    // ---------- buildings beside outdoor track ----------
    const buildings = { left: [], right: [] };
    for (const side of ['left', 'right']) {
      let z = 0;
      while (z < length) {
        const w = U.lerp(8, 26, rand()); const gap = rand() < 0.15 ? U.lerp(3, 10, rand()) : 0;
        buildings[side].push({ z0: z, z1: z + w, h: U.lerp(7, 26, Math.pow(rand(), 1.3)), col: BRICK[(rand() * BRICK.length) | 0], L: side === 'left' ? -U.lerp(13, 17, rand()) : U.lerp(11, 15, rand()),
          tower: rand() < 0.32, board: rand() < 0.08, shop: rand() < 0.7 ? SHOPS[(rand() * SHOPS.length) | 0] : null, awning: [[220, 60, 60], [40, 120, 200], [40, 160, 90], [240, 180, 40], [130, 70, 160]][(rand() * 5) | 0], seed: (rand() * 1e6) | 0, win: rand() < 0.5 ? 2 : 3 });
        z += w + gap;
      }
    }

    const track = {
      SEG, N, length, curve, y, env, stn, limit, sprites, stations, signals, buildings, water, limitSigns, route: r, dir, ENV, TRAIN_LEN, PLAT_BEFORE, PLAT_AFTER,
      yAt(z) { const f = z / SEG; const i = U.clamp(Math.floor(f), 0, N - 1); return U.lerp(y[i], y[i + 1], f - i); },
      slopeAt(z) { return (this.yAt(z + 6) - this.yAt(z - 6)) / 12; },
      envAt(z) { return env[U.clamp(Math.floor(z / SEG), 0, N - 1)]; },
      limitAt(z) { return limit[U.clamp(Math.floor(z / SEG), 0, N - 1)]; },
      posAt, sAt, outdoor, realD,
    };
    return track;
  }

  SC.buildTrack = buildTrack;
  SC.TRACK = { SEG, ENV, TRAIN_LEN, PLAT_BEFORE, PLAT_AFTER };
})(window.SC);
