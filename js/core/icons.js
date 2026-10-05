// Cartoon vector icons for NYC landmarks (drawn with canvas paths, no images).
// Every icon is drawn with its base centred at (0,0), growing upward, s = size in px.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const INK = '#1d1d24';
  const I = {};
  const outline = (ctx, s, fill) => { ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = Math.max(1, s * 0.06); ctx.strokeStyle = INK; ctx.stroke(); };
  const rect = (ctx, x, y, w, h) => { ctx.beginPath(); ctx.rect(x, y, w, h); };

  I.liberty = (ctx, s, t) => {
    // pedestal
    ctx.beginPath(); ctx.moveTo(-0.32 * s, 0); ctx.lineTo(0.32 * s, 0); ctx.lineTo(0.24 * s, -0.36 * s); ctx.lineTo(-0.24 * s, -0.36 * s); ctx.closePath(); outline(ctx, s, '#d8c7a0');
    // robe
    ctx.beginPath(); ctx.moveTo(-0.2 * s, -0.36 * s); ctx.lineTo(0.2 * s, -0.36 * s); ctx.lineTo(0.1 * s, -0.86 * s); ctx.lineTo(-0.1 * s, -0.86 * s); ctx.closePath(); outline(ctx, s, '#7fc4a6');
    // arm + torch
    ctx.beginPath(); ctx.moveTo(0.06 * s, -0.8 * s); ctx.lineTo(0.2 * s, -1.12 * s); ctx.lineTo(0.27 * s, -1.1 * s); ctx.lineTo(0.13 * s, -0.78 * s); ctx.closePath(); outline(ctx, s, '#7fc4a6');
    const fl = 1 + Math.sin((t || 0) * 8) * 0.12;
    ctx.beginPath(); ctx.ellipse(0.24 * s, -1.2 * s, 0.06 * s, 0.1 * s * fl, 0.3, 0, 7); outline(ctx, s, '#ffcf3a');
    // head + crown
    ctx.beginPath(); ctx.arc(0, -0.95 * s, 0.1 * s, 0, 7); outline(ctx, s, '#8fd0b3');
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.045);
    for (let i = -2; i <= 2; i++) { const a = -Math.PI / 2 + i * 0.38; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 0.1 * s, -0.95 * s + Math.sin(a) * 0.1 * s); ctx.lineTo(Math.cos(a) * 0.2 * s, -0.95 * s + Math.sin(a) * 0.2 * s); ctx.stroke(); }
    // tablet
    rect(ctx, -0.17 * s, -0.7 * s, 0.09 * s, 0.14 * s); outline(ctx, s, '#6fb596');
  };

  I.esb = (ctx, s) => {
    const tiers = [[0.36, 0.28], [0.26, 0.5], [0.18, 0.28], [0.1, 0.14]]; let y = 0;
    for (const [w, h] of tiers) { rect(ctx, -w / 2 * s, (y - h) * s, w * s, h * s); outline(ctx, s, '#e7d9b4'); y -= h; }
    ctx.beginPath(); ctx.moveTo(0, y * s); ctx.lineTo(0, (y - 0.32) * s); ctx.lineWidth = Math.max(1, s * 0.05); ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = 'rgba(40,60,110,.35)'; for (let i = 0; i < 6; i++) ctx.fillRect((-0.11 + i * 0.045) * s, -0.75 * s, 0.018 * s, 0.45 * s);
  };

  I.chrysler = (ctx, s) => {
    rect(ctx, -0.17 * s, -0.75 * s, 0.34 * s, 0.75 * s); outline(ctx, s, '#d9dde3');
    for (let i = 0; i < 4; i++) { const w = 0.15 - i * 0.035; ctx.beginPath(); ctx.ellipse(0, (-0.75 - i * 0.1) * s, w * s, 0.16 * s, 0, Math.PI, 0); outline(ctx, s, i % 2 ? '#c7ccd4' : '#eef1f5'); }
    ctx.beginPath(); ctx.moveTo(-0.025 * s, -1.12 * s); ctx.lineTo(0, -1.42 * s); ctx.lineTo(0.025 * s, -1.12 * s); outline(ctx, s, '#eef1f5');
    ctx.fillStyle = '#2b3d66'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo((-0.09 + i * 0.06) * s, -0.82 * s); ctx.lineTo((-0.07 + i * 0.06) * s, -0.9 * s); ctx.lineTo((-0.05 + i * 0.06) * s, -0.82 * s); ctx.fill(); }
  };

  I.wtc = (ctx, s) => {
    ctx.beginPath(); ctx.moveTo(-0.2 * s, 0); ctx.lineTo(0.2 * s, 0); ctx.lineTo(0.1 * s, -1.05 * s); ctx.lineTo(-0.1 * s, -1.05 * s); ctx.closePath(); outline(ctx, s, '#9ec9ea');
    ctx.beginPath(); ctx.moveTo(-0.2 * s, 0); ctx.lineTo(0.1 * s, -1.05 * s); ctx.lineTo(-0.1 * s, -1.05 * s); ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -1.05 * s); ctx.lineTo(0, -1.4 * s); ctx.lineWidth = Math.max(1, s * 0.04); ctx.strokeStyle = INK; ctx.stroke();
  };

  I.bridge = (ctx, s) => {
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.beginPath(); ctx.moveTo(-0.9 * s, -0.25 * s); ctx.quadraticCurveTo(-0.6 * s, -0.25 * s, -0.42 * s, -0.95 * s); ctx.quadraticCurveTo(0, -0.2 * s, 0.42 * s, -0.95 * s); ctx.quadraticCurveTo(0.6 * s, -0.25 * s, 0.9 * s, -0.25 * s); ctx.stroke();
    rect(ctx, -0.95 * s, -0.3 * s, 1.9 * s, 0.09 * s); outline(ctx, s, '#b98d5a');
    for (const x of [-0.42, 0.42]) {
      ctx.beginPath(); ctx.moveTo((x - 0.1) * s, 0); ctx.lineTo((x - 0.1) * s, -1.0 * s); ctx.lineTo((x + 0.1) * s, -1.0 * s); ctx.lineTo((x + 0.1) * s, 0); ctx.closePath(); outline(ctx, s, '#c9a777');
      ctx.fillStyle = '#5a7fa3'; ctx.beginPath(); ctx.moveTo((x - 0.05) * s, -0.4 * s); ctx.lineTo((x - 0.05) * s, -0.7 * s); ctx.quadraticCurveTo(x * s, -0.82 * s, (x + 0.05) * s, -0.7 * s); ctx.lineTo((x + 0.05) * s, -0.4 * s); ctx.fill();
    }
  };

  I.timessq = (ctx, s, t) => {
    const cols = ['#ff3d6e', '#3dd6ff', '#ffd93d', '#8cff5a', '#c77dff'];
    rect(ctx, -0.3 * s, -0.9 * s, 0.6 * s, 0.9 * s); outline(ctx, s, '#3a3a48');
    for (let i = 0; i < 6; i++) { const c = cols[(i + Math.floor((t || 0) * 2)) % cols.length]; ctx.fillStyle = c; ctx.fillRect((-0.25 + (i % 2) * 0.27) * s, (-0.85 + Math.floor(i / 2) * 0.27) * s, 0.23 * s, 0.2 * s); }
  };

  I.stadium = (ctx, s) => {
    ctx.beginPath(); ctx.ellipse(0, -0.25 * s, 0.6 * s, 0.3 * s, 0, 0, 7); outline(ctx, s, '#e9edf2');
    ctx.beginPath(); ctx.ellipse(0, -0.25 * s, 0.4 * s, 0.17 * s, 0, 0, 7); outline(ctx, s, '#55c157');
    ctx.beginPath(); ctx.moveTo(0, -0.12 * s); ctx.lineTo(0.12 * s, -0.25 * s); ctx.lineTo(0, -0.38 * s); ctx.lineTo(-0.12 * s, -0.25 * s); ctx.closePath(); ctx.fillStyle = '#d9a35b'; ctx.fill();
    for (const x of [-0.5, 0.5]) { ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.04); ctx.beginPath(); ctx.moveTo(x * s, -0.3 * s); ctx.lineTo(x * s, -0.75 * s); ctx.stroke(); rect(ctx, (x - 0.08) * s, -0.82 * s, 0.16 * s, 0.08 * s); outline(ctx, s, '#fff7b0'); }
  };

  I.unisphere = (ctx, s, t) => {
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.beginPath(); ctx.moveTo(-0.15 * s, 0); ctx.lineTo(0, -0.3 * s); ctx.lineTo(0.15 * s, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -0.65 * s, 0.38 * s, 0, 7); ctx.fillStyle = 'rgba(160,190,210,.35)'; ctx.fill(); ctx.stroke();
    ctx.lineWidth = Math.max(1, s * 0.025);
    const rot = (t || 0) * 0.6;
    for (let i = 0; i < 4; i++) { const w = Math.abs(Math.cos(rot + i * 0.8)) * 0.38; ctx.beginPath(); ctx.ellipse(0, -0.65 * s, w * s, 0.38 * s, 0, 0, 7); ctx.stroke(); }
    for (const y of [-0.2, 0, 0.2]) { const w = Math.sqrt(0.38 * 0.38 - y * y); ctx.beginPath(); ctx.moveTo(-w * s, (-0.65 + y) * s); ctx.lineTo(w * s, (-0.65 + y) * s); ctx.stroke(); }
    ctx.fillStyle = '#5cb85c'; ctx.beginPath(); ctx.ellipse(-0.1 * s, -0.72 * s, 0.12 * s, 0.08 * s, 0.5, 0, 7); ctx.fill();
  };

  I.wheel = (ctx, s, t) => {
    const cy = -0.62 * s, R = 0.5 * s; const rot = (t || 0) * 0.5;
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.beginPath(); ctx.moveTo(-0.3 * s, 0); ctx.lineTo(0, cy); ctx.lineTo(0.3 * s, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, cy, R, 0, 7); ctx.strokeStyle = '#e8453c'; ctx.lineWidth = Math.max(1.5, s * 0.07); ctx.stroke();
    ctx.lineWidth = Math.max(1, s * 0.025); ctx.strokeStyle = INK;
    const cols = ['#ff5a5a', '#ffd23f', '#3fa9ff', '#7ae05a'];
    for (let i = 0; i < 8; i++) { const a = rot + i * Math.PI / 4; const x = Math.cos(a) * R, y = cy + Math.sin(a) * R; ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(x, y); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y + 0.06 * s, 0.065 * s, 0, 7); outline(ctx, s * 0.6, cols[i % 4]); }
    ctx.beginPath(); ctx.arc(0, cy, 0.06 * s, 0, 7); outline(ctx, s, '#fff');
  };

  I.plane = (ctx, s, t) => {
    ctx.save(); ctx.translate(0, -0.45 * s); ctx.rotate(-0.5 + Math.sin((t || 0) * 1.5) * 0.05);
    ctx.beginPath(); ctx.ellipse(0, 0, 0.55 * s, 0.1 * s, 0, 0, 7); outline(ctx, s, '#f4f6fa');
    ctx.beginPath(); ctx.moveTo(-0.05 * s, 0); ctx.lineTo(-0.25 * s, -0.42 * s); ctx.lineTo(-0.12 * s, -0.42 * s); ctx.lineTo(0.18 * s, 0); ctx.closePath(); outline(ctx, s, '#3d7bd8');
    ctx.beginPath(); ctx.moveTo(-0.05 * s, 0); ctx.lineTo(-0.25 * s, 0.42 * s); ctx.lineTo(-0.12 * s, 0.42 * s); ctx.lineTo(0.18 * s, 0); ctx.closePath(); outline(ctx, s, '#3d7bd8');
    ctx.beginPath(); ctx.moveTo(-0.42 * s, 0); ctx.lineTo(-0.55 * s, -0.22 * s); ctx.lineTo(-0.47 * s, -0.22 * s); ctx.lineTo(-0.32 * s, 0); ctx.closePath(); outline(ctx, s, '#3d7bd8');
    ctx.restore();
  };

  I.zoo = (ctx, s) => { // a giraffe
    ctx.beginPath(); ctx.ellipse(0, -0.35 * s, 0.25 * s, 0.13 * s, 0, 0, 7); outline(ctx, s, '#f2c14e');
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.05);
    for (const x of [-0.17, -0.07, 0.08, 0.18]) { ctx.beginPath(); ctx.moveTo(x * s, -0.28 * s); ctx.lineTo(x * s, 0); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0.12 * s, -0.42 * s); ctx.lineTo(0.28 * s, -0.95 * s); ctx.lineTo(0.38 * s, -0.95 * s); ctx.lineTo(0.24 * s, -0.4 * s); ctx.closePath(); outline(ctx, s, '#f2c14e');
    ctx.beginPath(); ctx.ellipse(0.38 * s, -0.98 * s, 0.13 * s, 0.07 * s, 0.2, 0, 7); outline(ctx, s, '#f2c14e');
    ctx.fillStyle = '#b5782b'; for (const [x, y] of [[-0.12, -0.38], [0.05, -0.33], [0.15, -0.4], [0.27, -0.7]]) { ctx.beginPath(); ctx.arc(x * s, y * s, 0.035 * s, 0, 7); ctx.fill(); }
  };

  I.arena = (ctx, s) => {
    ctx.beginPath(); ctx.moveTo(-0.6 * s, 0); ctx.lineTo(-0.5 * s, -0.35 * s); ctx.quadraticCurveTo(0, -0.62 * s, 0.6 * s, -0.4 * s); ctx.lineTo(0.6 * s, 0); ctx.closePath(); outline(ctx, s, '#a8552b');
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = Math.max(1, s * 0.025); for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-0.6 * s, -i * 0.09 * s); ctx.lineTo(0.6 * s, -i * 0.09 * s - 0.04 * s); ctx.stroke(); }
  };

  I.gct = (ctx, s) => {
    rect(ctx, -0.5 * s, -0.5 * s, 1.0 * s, 0.5 * s); outline(ctx, s, '#efe3c2');
    for (const x of [-0.3, 0, 0.3]) { ctx.beginPath(); ctx.moveTo((x - 0.1) * s, 0); ctx.lineTo((x - 0.1) * s, -0.3 * s); ctx.arc(x * s, -0.3 * s, 0.1 * s, Math.PI, 0); ctx.lineTo((x + 0.1) * s, 0); ctx.fillStyle = '#6fa3c9'; ctx.fill(); }
    ctx.beginPath(); ctx.arc(0, -0.62 * s, 0.13 * s, 0, 7); outline(ctx, s, '#fffbe6');
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.03); ctx.beginPath(); ctx.moveTo(0, -0.62 * s); ctx.lineTo(0, -0.71 * s); ctx.moveTo(0, -0.62 * s); ctx.lineTo(0.06 * s, -0.62 * s); ctx.stroke();
  };

  I.tree = (ctx, s) => {
    rect(ctx, -0.05 * s, -0.3 * s, 0.1 * s, 0.3 * s); outline(ctx, s, '#8a5a2b');
    ctx.beginPath(); ctx.arc(0, -0.5 * s, 0.26 * s, 0, 7); ctx.arc(-0.17 * s, -0.4 * s, 0.17 * s, 0, 7); ctx.arc(0.17 * s, -0.4 * s, 0.17 * s, 0, 7); outline(ctx, s, '#4fb043');
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.arc(-0.07 * s, -0.6 * s, 0.07 * s, 0, 7); ctx.fill();
  };

  I.coaster = (ctx, s) => {
    ctx.strokeStyle = '#b7413a'; ctx.lineWidth = Math.max(1.5, s * 0.06);
    ctx.beginPath(); ctx.moveTo(-0.6 * s, -0.1 * s); ctx.lineTo(-0.3 * s, -0.8 * s); ctx.quadraticCurveTo(-0.15 * s, -0.95 * s, 0, -0.3 * s); ctx.quadraticCurveTo(0.15 * s, -0.05 * s, 0.3 * s, -0.55 * s); ctx.quadraticCurveTo(0.45 * s, -0.75 * s, 0.6 * s, -0.1 * s); ctx.stroke();
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, s * 0.025);
    for (let x = -0.5; x <= 0.5; x += 0.2) { ctx.beginPath(); ctx.moveTo(x * s, 0); ctx.lineTo(x * s, -0.35 * s); ctx.stroke(); }
  };

  I.apollo = (ctx, s) => {
    rect(ctx, -0.45 * s, -0.6 * s, 0.9 * s, 0.6 * s); outline(ctx, s, '#7a2f2f');
    rect(ctx, -0.4 * s, -0.5 * s, 0.8 * s, 0.22 * s); outline(ctx, s, '#e8343a');
    ctx.fillStyle = '#ffe9a8'; ctx.font = `bold ${Math.max(6, s * 0.17)}px Helvetica, Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('APOLLO', 0, -0.39 * s);
  };

  I.ferry = (ctx, s, t, flip) => {
    ctx.save(); if (flip) ctx.scale(-1, 1);
    ctx.beginPath(); ctx.moveTo(-0.6 * s, -0.2 * s); ctx.lineTo(0.6 * s, -0.2 * s); ctx.lineTo(0.45 * s, 0); ctx.lineTo(-0.45 * s, 0); ctx.closePath(); outline(ctx, s, '#f28c28');
    rect(ctx, -0.4 * s, -0.42 * s, 0.8 * s, 0.22 * s); outline(ctx, s, '#f7a54a');
    ctx.fillStyle = '#2f3d55'; for (let i = 0; i < 5; i++) ctx.fillRect((-0.33 + i * 0.14) * s, -0.37 * s, 0.08 * s, 0.1 * s);
    rect(ctx, -0.12 * s, -0.56 * s, 0.24 * s, 0.14 * s); outline(ctx, s, '#f28c28');
    ctx.restore();
  };

  I.draw = (ctx, kind, x, y, s, t, extra) => { const f = I[kind]; if (!f) return; ctx.save(); ctx.translate(x, y); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; f(ctx, s, t, extra); ctx.restore(); };
  SC.icons = I;
})(window.SC);
