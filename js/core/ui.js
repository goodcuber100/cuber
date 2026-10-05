// DOM helpers: screens, toasts, A/B choice cards, route bullets.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const U = SC.util;
  const UI = {};
  const $ = (sel, root = document) => root.querySelector(sel);
  UI.$ = $;
  UI.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  UI.el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  UI.show = (id) => {
    UI.$$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    UI.current = id;
  };

  // MTA route bullet. Shuttles show "S", the Staten Island Railway "SIR".
  UI.bullet = (route, size = 'md', extraCls = '') => {
    if (!route) return '';
    const label = route.label || route.id;
    const small = label.length > 1 ? ' bullet-long' : '';
    return `<span class="bullet bullet-${size}${small} ${extraCls}" style="background:${route.color};color:${route.text}" title="${U.esc(route.name)}">${U.esc(label)}</span>`;
  };

  // ---------- toasts ----------
  UI.toast = (html, type = 'info', ms = 3200) => {
    const root = $('#toast-root'); if (!root) return;
    const t = UI.el('div', `toast toast-${type}`, html); root.appendChild(t);
    while (root.children.length > 4) root.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
  };

  // ---------- floating "+$2.90" style popups at a screen point ----------
  UI.floatText = (x, y, text, cls = '') => {
    const root = $('#float-root'); if (!root) return;
    const f = UI.el('div', 'float-text ' + cls, text); f.style.left = x + 'px'; f.style.top = y + 'px'; root.appendChild(f);
    setTimeout(() => f.remove(), 1300);
  };

  // ---------- A / B decision card ----------
  // opts: {icon, kicker, title, text, a:{label, hint}, b:{label, hint}}  -> Promise<'a'|'b'>
  UI.choice = (opts) => new Promise(resolve => {
    const root = $('#modal-root');
    const card = UI.el('div', 'modal-backdrop');
    const opt = (k, o) => `<button class="choice-btn choice-${k}" data-k="${k}"><span class="choice-key">${k.toUpperCase()}</span><span class="choice-body"><b>${U.esc(o.label)}</b>${o.hint ? `<small>${U.esc(o.hint)}</small>` : ''}</span></button>`;
    card.innerHTML = `<div class="modal choice-card pop-in">
        <div class="choice-icon">${opts.icon || '⚠️'}</div>
        ${opts.kicker ? `<div class="choice-kicker">${U.esc(opts.kicker)}</div>` : ''}
        <h2>${U.esc(opts.title)}</h2>
        <p>${opts.text}</p>
        <div class="choice-row">${opt('a', opts.a)}${opt('b', opts.b)}</div>
      </div>`;
    root.appendChild(card);
    SC.audio.stinger();
    const done = (k) => { SC.audio.click(); window.removeEventListener('keydown', onKey, true); card.querySelector('.modal').classList.add('pop-out'); setTimeout(() => card.remove(), 220); resolve(k); };
    const onKey = (e) => { const k = e.key.toLowerCase(); if (k === 'a' || k === '1') { e.preventDefault(); e.stopPropagation(); done('a'); } if (k === 'b' || k === '2') { e.preventDefault(); e.stopPropagation(); done('b'); } };
    window.addEventListener('keydown', onKey, true);
    card.querySelectorAll('.choice-btn').forEach(b => b.addEventListener('click', () => done(b.dataset.k)));
  });

  // Outcome / info popup with a single button. Returns a promise.
  UI.alert = ({ icon = 'ℹ️', title, html, button = 'OK', cls = '' }) => new Promise(resolve => {
    const root = $('#modal-root');
    const card = UI.el('div', 'modal-backdrop');
    card.innerHTML = `<div class="modal info-card pop-in ${cls}"><div class="choice-icon">${icon}</div><h2>${U.esc(title)}</h2><div class="info-body">${html}</div><button class="btn btn-primary info-ok">${U.esc(button)}</button></div>`;
    root.appendChild(card);
    const done = () => { window.removeEventListener('keydown', onKey, true); card.remove(); resolve(); };
    const onKey = (e) => { if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); done(); } };
    setTimeout(() => window.addEventListener('keydown', onKey, true), 250);
    card.querySelector('.info-ok').addEventListener('click', () => { SC.audio.click(); done(); });
  });

  UI.confirm = ({ icon = '❓', title, html, yes = 'Yes', no = 'Cancel' }) => new Promise(resolve => {
    const root = $('#modal-root');
    const card = UI.el('div', 'modal-backdrop');
    card.innerHTML = `<div class="modal info-card pop-in"><div class="choice-icon">${icon}</div><h2>${U.esc(title)}</h2><div class="info-body">${html}</div><div class="btn-row"><button class="btn" data-v="0">${U.esc(no)}</button><button class="btn btn-primary" data-v="1">${U.esc(yes)}</button></div></div>`;
    root.appendChild(card);
    card.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { SC.audio.click(); card.remove(); resolve(b.dataset.v === '1'); }));
  });

  UI.modalOpen = () => !!$('#modal-root').children.length;

  SC.ui = UI;
})(window.SC);
