// Shared helpers: math, seeded randomness, colours, formatting, geometry, storage.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const U = {};

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.invLerp = (a, b, v) => (v - a) / (b - a);
  U.smooth = t => { t = U.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  U.easeOutBack = t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  U.wrapAngle = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  U.sign = v => (v < 0 ? -1 : 1);
  U.TAU = Math.PI * 2;

  // ---------- randomness ----------
  U.hash = (str) => { let h = 2166136261 >>> 0; str = String(str); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  U.rng = (seed) => { let a = (seed >>> 0) || 1; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  U.rand = (a, b) => a + Math.random() * (b - a);
  U.randInt = (a, b) => Math.floor(U.rand(a, b + 1));
  U.pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
  U.chance = p => Math.random() < p;
  U.noise1 = (x) => { const i = Math.floor(x), f = x - i; const h = n => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }; return U.lerp(h(i), h(i + 1), f * f * (3 - 2 * f)); };

  // ---------- colour ----------
  U.hexToRgb = (hex) => { hex = hex.replace('#', ''); if (hex.length === 3) hex = hex.split('').map(c => c + c).join(''); const n = parseInt(hex, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  U.rgb = (c, k = 1) => `rgb(${Math.round(U.clamp(c[0] * k, 0, 255))},${Math.round(U.clamp(c[1] * k, 0, 255))},${Math.round(U.clamp(c[2] * k, 0, 255))})`;
  U.rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  U.mix = (c1, c2, t) => [U.lerp(c1[0], c2[0], t), U.lerp(c1[1], c2[1], t), U.lerp(c1[2], c2[2], t)];
  // shade a colour by light level k and fade toward fog colour f by amount t
  U.shade = (c, k, fog, t) => { const r = c[0] * k, g = c[1] * k, b = c[2] * k; if (!fog || t <= 0) return `rgb(${r | 0},${g | 0},${b | 0})`; return `rgb(${(r + (fog[0] - r) * t) | 0},${(g + (fog[1] - g) * t) | 0},${(b + (fog[2] - b) * t) | 0})`; };

  // ---------- formatting ----------
  U.money = (n, exact) => {
    const s = n < 0 ? '-' : ''; n = Math.abs(n);
    if (exact || n < 10000) return s + '$' + n.toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 2 : 0, minimumFractionDigits: n < 100 && n % 1 ? 2 : 0 });
    if (n < 1e6) return s + '$' + (n / 1000).toFixed(n < 1e5 ? 1 : 0) + 'k';
    if (n < 1e9) return s + '$' + (n / 1e6).toFixed(2) + 'M';
    return s + '$' + (n / 1e9).toFixed(2) + 'B';
  };
  U.num = (n) => { n = Math.round(n); if (n < 10000) return n.toLocaleString('en-US'); if (n < 1e6) return (n / 1000).toFixed(1) + 'k'; return (n / 1e6).toFixed(2) + 'M'; };
  U.clock = (secOfDay) => { const m = Math.floor(secOfDay / 60) % 1440; let h = Math.floor(m / 60); const mm = m % 60; const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return `${h}:${String(mm).padStart(2, '0')} ${ap}`; };
  U.duration = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`; };
  U.mph = (ms) => ms * 2.23694;
  U.esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // "Times Sq-42 St" -> "Times Sq–42 St" ; nicer dashes for display
  U.stationName = (s) => s.replace(/-/g, '–');

  // ---------- geometry ----------
  U.pointInRing = (x, y, r) => { let inside = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; };
  U.ringBBox = (r) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < r.length; i += 2) { if (r[i] < x0) x0 = r[i]; if (r[i] > x1) x1 = r[i]; if (r[i + 1] < y0) y0 = r[i + 1]; if (r[i + 1] > y1) y1 = r[i + 1]; } return { x0, y0, x1, y1 }; };

  // Polyline with cumulative distance lookup. pts = flat [x0,y0,x1,y1...]
  U.Polyline = class {
    constructor(flat) {
      this.x = []; this.y = []; this.cum = [0];
      for (let i = 0; i < flat.length; i += 2) { this.x.push(flat[i]); this.y.push(flat[i + 1]); }
      for (let i = 1; i < this.x.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.x[i] - this.x[i - 1], this.y[i] - this.y[i - 1]));
      this.len = this.cum[this.cum.length - 1];
    }
    seg(d) { let lo = 0, hi = this.cum.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.cum[m] <= d) lo = m; else hi = m - 1; } return lo; }
    at(d) {
      d = U.clamp(d, 0, this.len); const i = this.seg(d); const L = this.cum[i + 1] - this.cum[i] || 1; const t = (d - this.cum[i]) / L;
      return { x: this.x[i] + (this.x[i + 1] - this.x[i]) * t, y: this.y[i] + (this.y[i + 1] - this.y[i]) * t, a: Math.atan2(this.y[i + 1] - this.y[i], this.x[i + 1] - this.x[i]) };
    }
  };

  // ---------- storage (never throws) ----------
  U.load = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } };
  U.save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  U.remove = (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };

  // ---------- tiny event emitter ----------
  U.Emitter = class {
    constructor() { this._h = {}; }
    on(t, f) { (this._h[t] = this._h[t] || []).push(f); return this; }
    off(t, f) { if (this._h[t]) this._h[t] = this._h[t].filter(x => x !== f); }
    emit(t, ...a) { (this._h[t] || []).forEach(f => f(...a)); }
  };

  // ---------- canvas helpers ----------
  // appends a rounded rectangle sub-path (no beginPath) so it can be combined with other shapes
  U.roundRectPath = (ctx, x, y, w, h, r) => { r = Math.min(r, w / 2, h / 2); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  U.roundRect = (ctx, x, y, w, h, r) => { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  U.fitCanvas = (canvas, maxDpr = 2) => {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr); const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w: r.width, h: r.height, dpr };
  };

  SC.util = U;
})(window.SC);
