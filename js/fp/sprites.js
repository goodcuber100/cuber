// Cartoon sprites for the first-person view: commuters, signage, signals, station furniture.
// All draw functions take a base point (x,y) on screen and s = pixels per metre at that depth.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const U = SC.util;
  const INK = '#15151c';
  const SP = {};

  // ---------- people ----------
  const SKIN = ['#f6d3b3', '#e8b48f', '#c98d63', '#a4693f', '#7a4a2a', '#5a3620', '#f1c9a5', '#d9a07a'];
  const HAIR = ['#1b1b1b', '#3b2416', '#6b4423', '#c49a5a', '#e6d27a', '#9a9a9a', '#b8322a', '#2c1d4f'];
  const SHIRT = ['#e94b3c', '#2f7de1', '#2fbf71', '#f5b82e', '#9b59b6', '#ff7f50', '#1abc9c', '#34495e', '#ecf0f1', '#e84393', '#fdcb6e', '#6c5ce7', '#d35400', '#222'];
  const PANTS = ['#2d3a5a', '#1b1b1b', '#5a4632', '#3d5a80', '#6b6b6b', '#8e6c4a', '#283655'];
  SP.makePerson = (rand) => {
    const r = rand || Math.random;
    const special = r();
    return {
      skin: SKIN[(r() * SKIN.length) | 0], hair: HAIR[(r() * HAIR.length) | 0], shirt: SHIRT[(r() * SHIRT.length) | 0], pants: PANTS[(r() * PANTS.length) | 0],
      h: 1.55 + r() * 0.35, w: 0.85 + r() * 0.4, hairStyle: (r() * 5) | 0,
      hat: r() < 0.18 ? ((r() * 3) | 0) : -1, bag: r() < 0.35 ? ((r() * 3) | 0) : -1, phone: r() < 0.4, headphones: r() < 0.2,
      phase: r() * 10, kind: special < 0.012 ? 'liberty' : special < 0.022 ? 'mariachi' : special < 0.04 ? 'tourist' : 'normal',
    };
  };
  // walk: 0..1 walking intensity, face: -1/1 facing direction (for side views)
  SP.person = (ctx, x, y, s, p, t, walk = 0, light = 1, alpha = 1) => {
    const H = p.h * s; if (H < 2) return;
    const lw = Math.max(0.8, s * 0.035);
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y);
    const bob = walk ? Math.abs(Math.sin(t * 9 + p.phase)) * 0.04 * s : Math.sin(t * 2 + p.phase) * 0.01 * s;
    const sw = walk ? Math.sin(t * 9 + p.phase) * 0.12 * s : 0;
    const bw = 0.42 * s * p.w, legH = H * 0.42, bodyH = H * 0.36, headR = H * 0.11;
    ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.7, bw * 0.18, 0, 0, 7); ctx.fill();
    // legs
    ctx.fillStyle = p.kind === 'liberty' ? '#7fc4a6' : p.pants;
    U.roundRect(ctx, -bw * 0.38 + sw * 0.3, -legH - bob, bw * 0.34, legH, bw * 0.12); ctx.fill(); ctx.stroke();
    U.roundRect(ctx, bw * 0.04 - sw * 0.3, -legH - bob, bw * 0.34, legH, bw * 0.12); ctx.fill(); ctx.stroke();
    // body
    const by = -legH - bodyH - bob;
    ctx.fillStyle = p.kind === 'liberty' ? '#7fc4a6' : p.kind === 'mariachi' ? '#1b1b1b' : p.kind === 'tourist' ? '#ffffff' : p.shirt;
    U.roundRect(ctx, -bw / 2, by, bw, bodyH + bw * 0.1, bw * 0.3); ctx.fill(); ctx.stroke();
    if (p.kind === 'tourist') { ctx.fillStyle = '#e8343a'; ctx.font = `900 ${bodyH * 0.32}px Helvetica`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('I♥NY', 0, by + bodyH * 0.45); }
    if (p.kind === 'mariachi') { ctx.strokeStyle = '#e6c35c'; ctx.beginPath(); ctx.moveTo(-bw / 2 + lw, by + bodyH * 0.2); ctx.lineTo(bw / 2 - lw, by + bodyH * 0.2); ctx.stroke(); ctx.strokeStyle = INK; }
    // bag
    if (p.bag === 0) { ctx.fillStyle = '#5b3a29'; U.roundRect(ctx, bw * 0.35, by + bodyH * 0.45, bw * 0.38, bodyH * 0.45, 3); ctx.fill(); ctx.stroke(); }
    else if (p.bag === 1) { ctx.fillStyle = '#2f80ed'; U.roundRect(ctx, -bw * 0.62, by + bodyH * 0.1, bw * 0.28, bodyH * 0.6, 3); ctx.fill(); ctx.stroke(); }
    else if (p.bag === 2) { ctx.fillStyle = '#f2f2f2'; U.roundRect(ctx, -bw * 0.75, by + bodyH * 0.55, bw * 0.4, bodyH * 0.45, 2); ctx.fill(); ctx.stroke(); }
    // head
    const hx = 0, hy = by - headR * 0.85;
    ctx.fillStyle = p.kind === 'liberty' ? '#8fd0b3' : p.skin; ctx.beginPath(); ctx.arc(hx, hy, headR, 0, 7); ctx.fill(); ctx.stroke();
    // hair / hats
    if (p.kind === 'liberty') {
      ctx.strokeStyle = '#4f9a7a'; for (let i = -2; i <= 2; i++) { const a = -Math.PI / 2 + i * 0.4; ctx.beginPath(); ctx.moveTo(hx + Math.cos(a) * headR, hy + Math.sin(a) * headR); ctx.lineTo(hx + Math.cos(a) * headR * 1.8, hy + Math.sin(a) * headR * 1.8); ctx.stroke(); }
      ctx.strokeStyle = INK; ctx.fillStyle = '#ffcf3a'; ctx.beginPath(); ctx.ellipse(bw * 0.6, by - headR * 1.6, headR * 0.35, headR * 0.6, 0, 0, 7); ctx.fill(); ctx.stroke();
    } else if (p.kind === 'mariachi') {
      ctx.fillStyle = '#1b1b1b'; ctx.beginPath(); ctx.ellipse(hx, hy - headR * 0.6, headR * 2.1, headR * 0.45, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(hx, hy - headR * 1.0, headR * 0.8, headR * 0.7, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
    } else if (p.hat === 0) { // Yankees-ish cap
      ctx.fillStyle = '#1c2a4a'; ctx.beginPath(); ctx.arc(hx, hy - headR * 0.15, headR * 1.02, Math.PI, 0); ctx.fill(); ctx.stroke(); ctx.fillRect(hx, hy - headR * 0.25, headR * 1.3, headR * 0.25);
      ctx.fillStyle = '#fff'; ctx.font = `900 ${headR * 0.8}px Georgia`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('NY', hx, hy - headR * 0.6);
    } else if (p.hat === 1) { ctx.fillStyle = '#d63031'; ctx.beginPath(); ctx.arc(hx, hy - headR * 0.2, headR * 1.02, Math.PI, 0); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(hx, hy - headR * 1.25, headR * 0.28, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }
    else if (p.hat === 2) { ctx.fillStyle = '#2d2d2d'; ctx.fillRect(hx - headR * 1.3, hy - headR * 0.75, headR * 2.6, headR * 0.25); ctx.fillRect(hx - headR * 0.8, hy - headR * 1.6, headR * 1.6, headR * 0.9); }
    else {
      ctx.fillStyle = p.hair; ctx.beginPath();
      if (p.hairStyle === 0) ctx.arc(hx, hy - headR * 0.25, headR * 1.0, Math.PI * 1.05, Math.PI * 1.95);
      else if (p.hairStyle === 1) { ctx.arc(hx, hy - headR * 0.3, headR * 1.15, Math.PI * 0.9, Math.PI * 2.1); ctx.lineTo(hx + headR * 1.1, hy + headR * 0.6); ctx.lineTo(hx - headR * 1.1, hy + headR * 0.6); }
      else if (p.hairStyle === 2) { ctx.arc(hx, hy - headR * 0.55, headR * 1.15, 0, 7); }
      else if (p.hairStyle === 3) { ctx.arc(hx, hy - headR * 0.2, headR * 1.05, Math.PI, 0); ctx.moveTo(hx + headR * 0.6, hy - headR); ctx.arc(hx + headR * 0.9, hy - headR * 0.9, headR * 0.45, 0, 7); }
      else { ctx.arc(hx, hy - headR * 0.15, headR * 1.02, Math.PI * 1.1, Math.PI * 1.9); }
      ctx.fill(); if (p.hairStyle !== 4) ctx.stroke();
    }
    if (p.headphones && p.kind === 'normal') { ctx.strokeStyle = '#ff3b6b'; ctx.lineWidth = lw * 2; ctx.beginPath(); ctx.arc(hx, hy, headR * 1.15, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); ctx.lineWidth = lw; ctx.strokeStyle = INK; }
    // face (only when big enough)
    if (headR > 3.5) { ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(hx - headR * 0.35, hy, headR * 0.12, 0, 7); ctx.arc(hx + headR * 0.35, hy, headR * 0.12, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(hx, hy + headR * 0.25, headR * 0.3, 0.2, Math.PI - 0.2); ctx.stroke(); }
    if (p.phone && !walk) { ctx.fillStyle = '#9fe3ff'; ctx.fillRect(bw * 0.15, by + bodyH * 0.05, headR * 0.6, headR * 0.9); ctx.strokeRect(bw * 0.15, by + bodyH * 0.05, headR * 0.6, headR * 0.9); }
    ctx.restore();
  };

  // ---------- signage & props ----------
  const txt = (ctx, s, x, y, size, color, weight = 800, font = 'Helvetica, Arial, sans-serif', align = 'center') => { ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); };
  SP.bulletAt = (ctx, route, x, y, r) => {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = route.color; ctx.fill();
    txt(ctx, route.label, x, y + r * 0.06, r * (route.label.length > 1 ? 0.9 : 1.35), route.text, 900);
  };

  SP.draw = (ctx, sp, x, y, s, env) => {
    const t = env.t, k = env.light;
    switch (sp.k) {
      case 'col': { const w = 0.28 * s, h = 4.4 * s; ctx.fillStyle = U.shade([46, 52, 66], k); ctx.fillRect(x - w / 2, y - h, w, h); ctx.fillStyle = U.shade([70, 78, 96], k); ctx.fillRect(x - w / 2, y - h, w * 0.3, h); if (w > 3) { ctx.fillStyle = U.shade([250, 250, 250], k); ctx.fillRect(x - w / 2, y - 1.6 * s, w, 0.25 * s); } break; }
      case 'bulb': { const r = Math.max(1, 0.12 * s); ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,240,180,.18)'; ctx.beginPath(); ctx.arc(x, y, r * 6, 0, 7); ctx.fill(); break; }
      case 'bluelight': { const r = Math.max(1.2, 0.15 * s); ctx.fillStyle = '#3d7bff'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(80,140,255,.25)'; ctx.beginPath(); ctx.arc(x, y, r * 5, 0, 7); ctx.fill(); break; }
      case 'exit': { const w = 0.7 * s, h = 0.3 * s; ctx.fillStyle = '#0c6b3a'; ctx.fillRect(x - w / 2, y - h, w, h); if (h > 6) txt(ctx, 'EXIT', x, y - h / 2, h * 0.7, '#e9ffe9', 900); break; }
      case 'graffiti': {
        if (s < 3) break; const r = U.rng(sp.seed); const w = (1.5 + r() * 2) * s, h = (0.6 + r() * 0.6) * s; const cols = ['#ff4fa3', '#3fd0ff', '#ffe14f', '#7dff6a', '#ff8a3d', '#b77dff'];
        ctx.save(); ctx.globalAlpha = 0.8 * k; ctx.fillStyle = cols[(r() * 6) | 0]; ctx.strokeStyle = cols[(r() * 6) | 0]; ctx.lineWidth = Math.max(1, s * 0.06);
        ctx.font = `900 italic ${h}px "Arial Black", Impact, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; const word = ['NYC', 'BX', 'QNS', 'WOW', 'YO!', 'BKLYN', 'RAT', '★'][(r() * 8) | 0];
        ctx.strokeText(word, x - w * 0.2, y); ctx.fillText(word, x - w * 0.2, y); ctx.restore(); break;
      }
      case 'rat': { if (s < 4) break; const ph = Math.sin(t * 20 + sp.seed) * 0.05 * s; ctx.fillStyle = U.shade([90, 80, 75], k); ctx.beginPath(); ctx.ellipse(x + ph, y - 0.06 * s, 0.14 * s, 0.07 * s, 0, 0, 7); ctx.fill(); ctx.strokeStyle = U.shade([190, 140, 140], k); ctx.lineWidth = Math.max(1, s * 0.01); ctx.beginPath(); ctx.moveTo(x + ph + 0.13 * s, y - 0.05 * s); ctx.quadraticCurveTo(x + 0.3 * s, y - 0.15 * s, x + 0.35 * s, y - 0.02 * s); ctx.stroke(); ctx.fillStyle = '#ff5050'; ctx.fillRect(x + ph - 0.12 * s, y - 0.09 * s, Math.max(1, 0.02 * s), Math.max(1, 0.02 * s)); break; }
      case 'marker': { const w = 0.35 * s; ctx.fillStyle = U.shade([240, 240, 240], k); ctx.fillRect(x - w / 2, y - w, w, w); if (w > 8) txt(ctx, String(sp.num % 1000), x, y - w / 2, w * 0.45, '#111', 900); break; }
      case 'speed': {
        const w = 0.55 * s, h = 0.7 * s; ctx.fillStyle = U.shade([255, 214, 10], k); ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.03);
        ctx.fillRect(x - w / 2, y - h, w, h); ctx.strokeRect(x - w / 2, y - h, w, h); if (h > 7) txt(ctx, String(sp.mph), x, y - h / 2, h * 0.55, '#111', 900);
        ctx.fillStyle = U.shade([70, 70, 70], k); ctx.fillRect(x - Math.max(1, 0.03 * s), y, Math.max(2, 0.06 * s), 0.8 * s); break;
      }
      case 'signal': {
        const sig = sp.sig; const w = 0.32 * s, h = 1.0 * s; ctx.fillStyle = '#111'; U.roundRect(ctx, x - w / 2, y - h, w, h, w * 0.3); ctx.fill();
        const on = sig.state; const lamp = (i, c, lit) => { ctx.beginPath(); ctx.arc(x, y - h + w * 0.55 + i * h * 0.31, w * 0.3, 0, 7); ctx.fillStyle = lit ? c : '#2a2a2a'; ctx.fill(); if (lit) { ctx.fillStyle = c.replace('rgb', 'rgba').replace(')', ',.25)'); ctx.beginPath(); ctx.arc(x, y - h + w * 0.55 + i * h * 0.31, w * 1.6, 0, 7); ctx.fill(); } };
        lamp(0, 'rgb(255,60,50)', on === 'R'); lamp(1, 'rgb(255,200,40)', on === 'Y'); lamp(2, 'rgb(60,255,120)', on === 'G');
        if (sig.gt && h > 10) { ctx.fillStyle = '#fff'; ctx.fillRect(x - w * 0.6, y + 0.05 * s, w * 1.2, w * 0.7); txt(ctx, 'GT', x, y + 0.05 * s + w * 0.35, w * 0.5, '#111', 900); }
        if (h > 6) { ctx.fillStyle = '#222'; ctx.fillRect(x - w * 0.08, y, w * 0.16, 1.0 * s); } break;
      }
      case 'pcol': { const w = 0.3 * s, h = 3.45 * s; ctx.fillStyle = U.shade(env.station.mosaic, k * 1.1); ctx.fillRect(x - w / 2, y - h, w, h); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(x - w / 2, y - h, w * 0.25, h); ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.8, s * 0.02); ctx.strokeRect(x - w / 2, y - h, w, h); if (w > 7) { ctx.fillStyle = '#111'; ctx.fillRect(x - w / 2, y - 2.0 * s, w, 0.45 * s); } break; }
      case 'tube': { const w = 0.5 * s, h = Math.max(1, 0.08 * s); ctx.fillStyle = '#fffbe8'; ctx.fillRect(x - w / 2, y - h, w, h); break; }
      case 'tablet': {
        const st = sp.st; const w = 2.6 * s, h = 0.75 * s; if (w < 6) break; const m = st.mosaic;
        ctx.fillStyle = U.shade(m, k); ctx.fillRect(x - w / 2, y - h, w, h); ctx.fillStyle = U.shade([246, 238, 220], k); ctx.fillRect(x - w / 2 + 0.08 * s, y - h + 0.08 * s, w - 0.16 * s, h - 0.16 * s);
        if (h > 9) { ctx.save(); ctx.beginPath(); ctx.rect(x - w / 2, y - h, w, h); ctx.clip(); txt(ctx, st.name.toUpperCase().replace(/-/g, ' '), x, y - h / 2, Math.min(h * 0.42, w / Math.max(6, st.name.length) * 1.5), U.shade(m, k * 0.8), 900, '"Times New Roman", Georgia, serif'); ctx.restore(); }
        break;
      }
      case 'hsign': {
        const st = sp.st; const w = 2.4 * s, h = 0.55 * s; if (w < 8) break; ctx.fillStyle = '#121212'; ctx.fillRect(x - w / 2, y - h, w, h); ctx.fillStyle = '#ddd'; ctx.fillRect(x - w / 2, y - h, w, Math.max(1, 0.03 * s));
        ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - w * 0.3, y - h); ctx.lineTo(x - w * 0.3, y - h - 0.6 * s); ctx.moveTo(x + w * 0.3, y - h); ctx.lineTo(x + w * 0.3, y - h - 0.6 * s); ctx.stroke();
        if (h > 9) { const rs = [env.route, ...st.transfers.slice(0, 3)]; rs.forEach((r, i) => SP.bulletAt(ctx, r, x - w / 2 + h * 0.5 + i * h * 0.85, y - h / 2, h * 0.36)); txt(ctx, st.bound, x - w / 2 + h * 0.5 + rs.length * h * 0.85, y - h / 2, h * 0.36, '#fff', 700, 'Helvetica, Arial, sans-serif', 'left'); }
        break;
      }
      case 'clock': {
        const w = 1.8 * s, h = 0.45 * s; if (w < 10) break; ctx.fillStyle = '#0b0b0b'; ctx.fillRect(x - w / 2, y - h, w, h);
        if (h > 8) { const txt2 = `${env.route.label} ${env.route.label.length > 1 ? '' : ''}${U.stationName(SC.net.terminal(env.route, env.dir).name).slice(0, 18)}  ${Math.max(0, Math.round((sp.st.zMarker - env.z) / 300))} min`; txt(ctx, txt2, x, y - h / 2, h * 0.5, '#ffb000', 700, '"Courier New", monospace'); }
        break;
      }
      case 'carstop': {
        const w = (sp.main ? 0.62 : 0.5) * s, h = w; if (w < 2) break; ctx.fillStyle = '#0c0c0c'; ctx.fillRect(x - w / 2, y - h, w, h); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, w * 0.06); ctx.strokeRect(x - w / 2 + w * 0.08, y - h + w * 0.08, w * 0.84, h * 0.84);
        if (w > 6) txt(ctx, String(sp.n), x, y - h / 2, h * 0.55, '#fff', 900);
        ctx.fillStyle = '#666'; ctx.fillRect(x - Math.max(1, 0.02 * s), y - h - 1.4 * s, Math.max(2, 0.04 * s), 1.4 * s); break;
      }
      case 'zebra': {
        const w = 0.5 * s, h = 1.0 * s; if (w < 2) break; ctx.fillStyle = '#fff'; ctx.fillRect(x - w / 2, y - h, w, h); ctx.fillStyle = '#111';
        for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x - w / 2, y - h + i * h / 5 + h * 0.1); ctx.lineTo(x + w / 2, y - h + i * h / 5 - h * 0.02); ctx.lineTo(x + w / 2, y - h + i * h / 5 + h * 0.08); ctx.lineTo(x - w / 2, y - h + i * h / 5 + h * 0.2); ctx.fill(); }
        ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.02); ctx.strokeRect(x - w / 2, y - h, w, h); break;
      }
      case 'bench': { const w = 1.6 * s, h = 0.45 * s; ctx.fillStyle = U.shade([150, 98, 54], k); ctx.fillRect(x - w / 2, y - h, w, h * 0.3); ctx.fillRect(x - w / 2, y - h * 1.6, w, h * 0.3); ctx.fillStyle = U.shade([60, 60, 60], k); ctx.fillRect(x - w / 2 + w * 0.08, y - h * 0.7, w * 0.06, h * 0.7); ctx.fillRect(x + w / 2 - w * 0.14, y - h * 0.7, w * 0.06, h * 0.7); break; }
      case 'trash': { const w = 0.5 * s, h = 0.8 * s; ctx.fillStyle = U.shade([40, 90, 60], k); U.roundRect(ctx, x - w / 2, y - h, w, h, w * 0.15); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.02); ctx.stroke(); break; }
      case 'post': { const w = Math.max(1, 0.16 * s), h = 2.9 * s; ctx.fillStyle = U.shade([62, 104, 80], k); ctx.fillRect(x - w / 2, y - h, w, h); ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.6, s * 0.015); ctx.strokeRect(x - w / 2, y - h, w, h); break; }
      case 'lamp': { const r = Math.max(1, 0.18 * s); ctx.fillStyle = env.night > 0.3 ? '#fff4c0' : '#ddd'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); if (env.night > 0.3) { ctx.fillStyle = 'rgba(255,240,170,.22)'; ctx.beginPath(); ctx.arc(x, y + r * 3, r * 7, 0, 7); ctx.fill(); } break; }
      case 'namesign': {
        const st = sp.st; const w = 2.6 * s, h = 0.55 * s; if (w < 8) break; ctx.fillStyle = '#111'; ctx.fillRect(x - w / 2, y - h, w, h); ctx.fillStyle = '#eee'; ctx.fillRect(x - w / 2, y - h, w, Math.max(1, 0.03 * s));
        if (h > 8) { ctx.save(); ctx.beginPath(); ctx.rect(x - w / 2, y - h, w, h); ctx.clip(); txt(ctx, U.stationName(st.name), x - w / 2 + h * 0.3, y - h / 2, h * 0.45, '#fff', 800, 'Helvetica, Arial, sans-serif', 'left'); ctx.restore(); }
        break;
      }
      case 'elcol': { const w = Math.max(1.5, 0.45 * s), h = env.drop * s; ctx.fillStyle = U.shade([70, 110, 92], k); ctx.fillRect(x - w / 2, y, w, h); ctx.strokeStyle = U.shade([40, 70, 58], k); ctx.lineWidth = Math.max(0.6, s * 0.03); for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(x - w / 2, y + i * h / 6); ctx.lineTo(x + w / 2, y + (i + 1) * h / 6); ctx.stroke(); } ctx.strokeStyle = INK; ctx.strokeRect(x - w / 2, y, w, h); break; }
      case 'pole': { const w = Math.max(1, 0.2 * s), h = 9 * s; ctx.fillStyle = U.shade([110, 80, 50], k); ctx.fillRect(x - w / 2, y - h, w, h); ctx.fillRect(x - 1.2 * s, y - h * 0.92, 2.4 * s, Math.max(1, 0.12 * s)); break; }
      case 'tree': { const r = U.rng(sp.seed); const R = (1.6 + r() * 1.4) * s; ctx.fillStyle = U.shade([110, 76, 40], k); ctx.fillRect(x - 0.12 * s, y - 2.2 * s, 0.24 * s, 2.2 * s); ctx.fillStyle = U.shade([70 + r() * 40, 150 + r() * 40, 60], k); ctx.beginPath(); ctx.arc(x, y - 2.2 * s - R * 0.6, R, 0, 7); ctx.arc(x - R * 0.6, y - 2.2 * s - R * 0.2, R * 0.7, 0, 7); ctx.arc(x + R * 0.6, y - 2.2 * s - R * 0.2, R * 0.7, 0, 7); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.6, s * 0.04); ctx.stroke(); break; }
      case 'bumper': { const w = 3.0 * s, h = 1.2 * s; ctx.fillStyle = '#d63031'; ctx.fillRect(x - w / 2, y - h, w, h * 0.5); ctx.fillStyle = '#ffd400'; for (let i = 0; i < 6; i++) ctx.fillRect(x - w / 2 + i * w / 6, y - h, w / 12, h * 0.5); ctx.fillStyle = '#ff2a2a'; ctx.beginPath(); ctx.arc(x - w * 0.3, y - h * 1.1, 0.12 * s, 0, 7); ctx.arc(x + w * 0.3, y - h * 1.1, 0.12 * s, 0, 7); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.03); ctx.strokeRect(x - w / 2, y - h, w, h * 0.5); break; }
      case 'drip': { const ph = ((t * 0.8 + sp.seed * 0.001) % 1); ctx.fillStyle = 'rgba(140,200,255,.8)'; ctx.beginPath(); ctx.arc(x, y + ph * 4.3 * s, Math.max(1, 0.05 * s), 0, 7); ctx.fill(); break; }
      case 'flagger': { // track worker in an orange vest with a lantern
        if (s < 1.5) break; const p = sp.p || (sp.p = { ...SP.makePerson(U.rng(sp.seed || 7)), shirt: '#ff7a00', hat: 2, bag: -1, phone: false, kind: 'normal' });
        SP.person(ctx, x, y, s, p, t, 0, 1, 1);
        const lx = x - 0.35 * s, ly = y - 1.05 * s + Math.sin(t * 4 + (sp.seed || 0)) * 0.08 * s; const col = sp.lamp === 'G' ? '60,255,120' : sp.lamp === 'R' ? '255,60,50' : '255,200,40';
        ctx.fillStyle = `rgba(${col},.3)`; ctx.beginPath(); ctx.arc(lx, ly, 0.6 * s, 0, 7); ctx.fill(); ctx.fillStyle = `rgb(${col})`; ctx.beginPath(); ctx.arc(lx, ly, Math.max(1.5, 0.12 * s), 0, 7); ctx.fill();
        ctx.strokeStyle = '#ddd'; ctx.lineWidth = Math.max(1, s * 0.04); ctx.beginPath(); ctx.moveTo(x - 0.45 * p.w * s * 0.42, y - 0.75 * s); ctx.lineTo(x + 0.45 * p.w * s * 0.42, y - 0.75 * s); ctx.stroke();
        break;
      }
      case 'lantern': { const col = sp.lamp === 'G' ? '60,255,120' : '255,200,40'; const r = Math.max(1.5, 0.14 * s); ctx.fillStyle = `rgba(${col},.28)`; ctx.beginPath(); ctx.arc(x, y, r * 5, 0, 7); ctx.fill(); ctx.fillStyle = `rgb(${col})`; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); break; }
      default: break;
    }
  };

  SC.sprites = SP;
})(window.SC);
