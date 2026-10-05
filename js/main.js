// App bootstrap: title screen (with a live autopilot ride behind the menu), run picker,
// mode switching and the single requestAnimationFrame loop.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const U = SC.util, UI = SC.ui, AU = SC.audio, net = SC.net;
  const $ = UI.$;
  const FEATURED = [
    { label: '🌇 7 over Queens at sunset', route: '7', from: '61 St-Woodside', dir: -1, count: 6, hour: 18.6 },
    { label: '🌉 Q across the Manhattan Bridge', route: 'Q', from: 'DeKalb Av', dir: 1, count: 4, hour: 9.2 },
    { label: '🏖️ A to the Rockaways', route: 'A', from: 'Howard Beach-JFK Airport', dir: -1, count: 5, hour: 13 },
    { label: '🌆 1 down Broadway, rush hour', route: '1', from: '96 St', dir: -1, count: 6, hour: 8.3 },
    { label: '🌙 L to Brooklyn, late night', route: 'L', from: '8 Av', dir: -1, count: 6, hour: 1.2 },
    { label: '🎢 F to Coney Island', route: 'F', from: 'Smith-9 Sts', dir: -1, count: 6, hour: 15 },
    { label: '⚾ 4 to Yankee Stadium', route: '4', from: '125 St', dir: 1, count: 4, hour: 19 },
  ];
  const TIMES = [['🌅 Morning rush', 8.2], ['☀️ Midday', 12.5], ['🌇 Evening rush', 17.8], ['🌙 Late night', 1.2]];
  const COUNTS = [3, 5, 8, 12, 0];

  const findStop = (r, name) => { const k = r.stops.findIndex(si => net.stations[si].name === name); return k >= 0 ? k : r.stops.findIndex(si => net.stations[si].name.startsWith(name.split('-')[0])); };

  const app = {
    mgr: null, demo: null, setup: { route: '7', dir: -1, from: 0, count: 5, hour: 8.2 },

    init() {
      // title bullets
      $('#logo-bullets').innerHTML = ['1', '4', '7', 'A', 'B', 'G', 'J', 'L', 'N'].map(id => UI.bullet(net.routeById[id], 'md', 'bounce')).join('');
      UI.$$('#logo-bullets .bullet').forEach((b, i) => b.style.animationDelay = `${i * 0.12}s`);
      UI.$$('.logo-text span').forEach((s, i) => s.style.animationDelay = `${i * 0.06}s`);
      $('#btn-manager').addEventListener('click', () => { AU.unlock(); AU.click(); this.startManager(false); });
      $('#btn-conductor').addEventListener('click', () => { AU.unlock(); AU.click(); this.setupMode = 'drive'; this.showConductorSetup(); });
      $('#btn-ride').addEventListener('click', () => { AU.unlock(); AU.click(); this.setupMode = 'ride'; this.showConductorSetup(); });
      $('#tgl-sound').addEventListener('click', () => this.toggleSound());
      $('#tgl-voice').addEventListener('click', () => { AU.setVoice(!AU.voice); this.syncToggles(); AU.speak('Stand clear of the closing doors, please.'); });
      $('#btn-credits').addEventListener('click', () => this.credits());
      UI.$$('.sound-btn').forEach(b => b.addEventListener('click', () => this.toggleSound()));
      $('#setup-back').addEventListener('click', () => { AU.click(); this.showTitle(); });
      $('#run-drive').addEventListener('click', () => this.launchFromSetup('conductor'));
      $('#run-ride').addEventListener('click', () => this.launchFromSetup('ride'));
      $('#run-from').addEventListener('change', (e) => { this.setup.from = +e.target.value; this.renderSetup(); });
      SC.FP.init();
      this.titleRenderer = new SC.FPRenderer($('#title-canvas'));
      window.addEventListener('resize', () => { if (UI.current === 'screen-title') this.titleRenderer.resize(); });
      this.syncToggles();
      this.showTitle();
      let last = performance.now();
      const frame = (now) => {
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        try { this.frame(dt); } catch (err) { console.error(err); }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },

    frame(dt) {
      if (this.mgr) this.mgr.update(dt, UI.current === 'screen-manager');
      if (UI.current === 'screen-fp') SC.FP.frame(dt);
      if (UI.current === 'screen-title' && this.demo) { this.demo.update(dt); this.demo.render(); }
    },

    toggleSound() { AU.unlock(); AU.setEnabled(!AU.enabled); this.syncToggles(); AU.click(); },
    syncToggles() {
      $('#tgl-sound').textContent = AU.enabled ? '🔊 Sound on' : '🔇 Sound off'; $('#tgl-voice').textContent = AU.voice ? '🗣 Announcements on' : '🤐 Announcements off';
      UI.$$('.sound-btn').forEach(b => b.textContent = AU.enabled ? '🔊' : '🔇');
    },

    // ---------------- title ----------------
    showTitle() {
      SC.FP.stop(); if (this.mgr) { this.mgr.save(); this.mgr = null; }
      UI.show('screen-title');
      const saved = U.load(SC.ManagerMode.SAVE_KEY, null);
      $('#mgr-sub').textContent = saved ? `Continue Day ${saved.day} · ${U.money(saved.money)} in the bank` : 'Start with one train. Grow the whole system.';
      requestAnimationFrame(() => {
        this.titleRenderer.resize();
        const f = U.pick(FEATURED.slice(0, 4)); const r = net.routeById[f.route];
        this.demo = new SC.ConductorGame({ routeId: f.route, from: Math.max(0, findStop(r, f.from)), dir: f.dir, count: 8, hour: f.hour, autopilot: true, demo: true, renderer: this.titleRenderer, showCab: true, onEnd: () => this.showTitle() });
        this.demo.doors = 'closed'; this.demo.phase = 'ready'; this.demo.boarding = null;
      });
    },
    credits() {
      UI.alert({ icon: '🗽', title: 'Credits', html: `<p><b>Stand Clear!</b> is a fan-made cartoon simulator. It is not affiliated with or endorsed by the MTA.</p>
        <ul class="howto"><li>Routes, station order and track geometry: MTA subway GTFS static feed.</li><li>Station structure types (subway / elevated / open cut…): MTA Subway Stations open dataset.</li>
        <li>Borough shorelines: NYC Department of City Planning borough boundaries.</li><li>Neighboring coastline: © OpenStreetMap contributors (ODbL).</li>
        <li>All art, sound and voice are generated live in your browser — no image or audio files.</li></ul>` });
    },

    // ---------------- MTA Manager ----------------
    startManager(fresh) {
      SC.FP.stop(); this.demo = null;
      const saved = fresh ? null : U.load(SC.ManagerMode.SAVE_KEY, null);
      let sim; try { sim = new SC.ManagerSim(saved); } catch (e) { console.warn('bad save, starting fresh', e); sim = new SC.ManagerSim(); }
      UI.show('screen-manager');
      this.mgr = new SC.ManagerMode(sim);
      requestAnimationFrame(() => { this.mgr.map.resize(); this.mgr.map.fitAll(true); this.mgr.renderTab(true); });
      if (!saved) setTimeout(() => this.mgr.help(true), 250);
      else UI.toast(`Welcome back! Day ${sim.state.day}, ${U.money(sim.state.money)} in the bank.`, 'good');
    },
    backToManager() {
      if (!this.mgr) return this.showTitle();
      UI.show('screen-manager'); requestAnimationFrame(() => this.mgr.map.resize());
    },

    // ---------------- conductor / ride setup ----------------
    showConductorSetup() {
      SC.FP.stop(); this.demo = null; if (this.mgr) { this.mgr.save(); this.mgr = null; }
      UI.show('screen-setup');
      $('#setup-title').textContent = this.setupMode === 'ride' ? 'Ride Along — pick a line' : 'Conductor — pick your run';
      $('#run-drive').classList.toggle('btn-primary', this.setupMode !== 'ride'); $('#run-ride').classList.toggle('btn-primary', this.setupMode === 'ride');
      const c = SC.FP.career;
      $('#career').innerHTML = `<b>${SC.FP.rank()}</b><span>${c.runs} shifts · ${c.perfect} perfect stops · ${U.money(c.pay, true)} earned</span>`;
      $('#featured').innerHTML = FEATURED.map((f, i) => `<button class="chip feat" data-i="${i}">${UI.bullet(net.routeById[f.route], 'xs')} ${U.esc(f.label)}</button>`).join('');
      UI.$$('#featured .feat').forEach(b => b.addEventListener('click', () => {
        const f = FEATURED[+b.dataset.i]; const r = net.routeById[f.route];
        Object.assign(this.setup, { route: f.route, dir: f.dir, from: Math.max(0, findStop(r, f.from)), count: f.count, hour: f.hour }); AU.click(); this.renderSetup();
      }));
      const order = ['1', '2', '3', '4', '5', '6', '7', 'A', 'C', 'E', 'B', 'D', 'F', 'M', 'G', 'J', 'Z', 'L', 'N', 'Q', 'R', 'W', 'GS', 'FS', 'H', 'SI'];
      $('#line-grid').innerHTML = order.map(id => `<button class="line-pick-btn" data-id="${id}" title="${U.esc(net.routeById[id].name)}">${UI.bullet(net.routeById[id], 'lg')}</button>`).join('');
      UI.$$('#line-grid .line-pick-btn').forEach(b => b.addEventListener('click', () => {
        const r = net.routeById[b.dataset.id]; this.setup.route = r.id; this.setup.dir = 1; this.setup.from = 0; AU.click(); this.renderSetup();
      }));
      this.renderSetup();
    },
    renderSetup() {
      const S = this.setup, r = net.routeById[S.route]; const last = r.stops.length - 1;
      UI.$$('#line-grid .line-pick-btn').forEach(b => b.classList.toggle('on', b.dataset.id === S.route));
      $('#run-title').innerHTML = `${UI.bullet(r, 'lg')}<div><b>${U.esc(r.name)}</b><small>${r.stops.length} stations · ${(r.len / 1609).toFixed(1)} miles of real MTA track</small></div>`;
      const t0 = U.stationName(net.stations[r.stops[0]].name), t1 = U.stationName(net.stations[r.stops[last]].name);
      $('#run-dir').innerHTML = `<button data-d="1" class="${S.dir > 0 ? 'on' : ''}">→ ${U.esc(t1)}</button><button data-d="-1" class="${S.dir < 0 ? 'on' : ''}">→ ${U.esc(t0)}</button>`;
      UI.$$('#run-dir button').forEach(b => b.addEventListener('click', () => { S.dir = +b.dataset.d; if ((S.dir > 0 && S.from >= last) || (S.dir < 0 && S.from <= 0)) S.from = S.dir > 0 ? 0 : last; AU.click(); this.renderSetup(); }));
      // start options: every stop except the terminal you'd be heading into
      const ks = []; for (let k = 0; k <= last; k++) if ((S.dir > 0 && k < last) || (S.dir < 0 && k > 0)) ks.push(k);
      if (!ks.includes(S.from)) S.from = ks[S.dir > 0 ? 0 : ks.length - 1];
      const ordered = S.dir > 0 ? ks : ks.slice().reverse();
      $('#run-from').innerHTML = ordered.map(k => `<option value="${k}" ${k === S.from ? 'selected' : ''}>${U.esc(U.stationName(net.stations[r.stops[k]].name))}</option>`).join('');
      const remaining = S.dir > 0 ? last - S.from : S.from;
      $('#run-count').innerHTML = COUNTS.map(n => { const v = n || remaining; const dis = n && n > remaining; return `<button data-n="${n}" class="${(S.count === n || (!n && S.count >= remaining)) && !dis ? 'on' : ''}" ${dis ? 'disabled' : ''}>${n ? n + ' stops' : `To the end (${remaining})`}</button>`; }).join('');
      UI.$$('#run-count button').forEach(b => b.addEventListener('click', () => { S.count = +b.dataset.n || 999; AU.click(); this.renderSetup(); }));
      $('#run-time').innerHTML = TIMES.map(([l, h]) => `<button data-h="${h}" class="${Math.abs(S.hour - h) < 1.5 ? 'on' : ''}">${l}</button>`).join('');
      UI.$$('#run-time button').forEach(b => b.addEventListener('click', () => { S.hour = +b.dataset.h; AU.click(); this.renderSetup(); }));
      const n = Math.min(S.count || 999, remaining);
      const stops = []; for (let i = 0, k = S.from; i <= n; i++, k += S.dir) stops.push(net.stations[r.stops[k]]);
      const ICON = { S: '🕳️', E: '🏗️', V: '🌉', C: '🌳', G: '🌳', B: '🌳' };
      $('#run-preview').innerHTML = `<div class="pv-line" style="--c:${r.color}">${stops.map((st, i) => `<div class="pv-stop ${i === 0 ? 'first' : ''}"><i></i><span>${U.esc(U.stationName(st.name))}</span><small>${ICON[st.struct] || ''} ${net.STRUCT_NAME[st.struct]}</small></div>`).join('')}</div>`;
    },
    launchFromSetup(kind) {
      AU.unlock(); AU.click(); const S = this.setup;
      SC.FP.start(kind, { routeId: S.route, from: S.from, dir: S.dir, count: (S.count || 999) + 1, hour: S.hour });
    },
  };
  SC.app = app;
  window.addEventListener('DOMContentLoaded', () => app.init());
})(window.SC);
