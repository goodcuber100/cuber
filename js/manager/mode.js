// MTA Manager screen: top bar (funds, clock, satisfaction, time slider), side panels
// (Lines, Fleet, Upgrades, Stats), selection cards, news ticker, decisions & watch-from-cab.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const U = SC.util, UI = SC.ui, AU = SC.audio, net = SC.net, C = SC.content;
  const $ = UI.$, $$ = UI.$$;
  const SAVE_KEY = 'standclear.manager.v1';
  const SPEEDS = [0, 15, 30, 60, 120, 240, 480];
  const SPEED_LABEL = ['Paused', '½×', '1×', '2×', '4×', '8×', '16×'];
  const ORDER = ['1', '2', '3', '4', '5', '6', '7', 'A', 'C', 'E', 'B', 'D', 'F', 'M', 'G', 'J', 'Z', 'L', 'N', 'Q', 'R', 'W', 'GS', 'FS', 'H', 'SI'];
  const FLAVOR = ['Bodega cat named Employee of the Month', 'Man eats entire pizza between two stops, riders applaud', 'Pigeon spotted riding the Q to Coney Island', 'Survey: 9 in 10 New Yorkers have strong opinions about the G',
    'Rats reportedly forming a union', 'Tourist asks for "the subway to Brooklyn Bridge" — gets three different answers', 'Local man still waiting for the Second Avenue Subway Phase 2', 'Hot dog vendor reports record sales outside Yankee Stadium',
    '"Showtime" dancer lands quadruple backflip, tips quadruple', 'Your MetroCard nostalgia is valid, says expert', 'Mystery puddle on the 6 platform remains unexplained', 'Busker plays "New York, New York" for the 10,000th time'];

  // "Broadway - 7 Avenue Local" -> "Broadway–7 Av Local"
  const lineName = (r) => r.name.replace(/\s*-\s*/g, '–').replace(/\bAvenue\b/g, 'Av').replace(/\bStreet\b/g, 'St');

  class ManagerMode {
    constructor(sim) {
      this.sim = sim; this.speedIdx = 3; this.prevSpeedIdx = 3; this.tab = 'lines'; this.blocked = false;
      this.map = new SC.MapView($('#mgr-canvas'), sim);
      this.map.on('select', (hit) => this.onSelect(hit));
      this.headlines = []; this.rateHist = [];
      this.bindSim(); this.bindUI(); this.renderTab(true); this.updateTop(true);
      this.news('Welcome to the MTA, Commissioner! New Yorkers are counting on you.');
      // a decision that was still open when the game was saved
      const pend = sim.state.pending; if (pend) { const ev = C.EVENTS.find(e => e.id === pend.id); if (ev) setTimeout(() => this.showDecision(ev, pend.ctx), 600); else sim.state.pending = null; }
    }

    // ---------------- wiring ----------------
    bindSim() {
      const s = this.sim;
      s.on('decision', (ev, ctx) => this.showDecision(ev, ctx));
      s.on('incident', (inc) => { this.news(`🚨 ${inc.label}. Expect delays on the ${net.routeById[inc.route].shortName}.`); UI.toast(`${inc.icon} <b>${U.esc(inc.label)}</b>. Click the ⚠ on the map to send a crew.`, 'bad'); AU.alarm(); });
      s.on('incidentEnd', (inc) => this.news(`✅ ${inc.label} has been cleared.`));
      s.on('achievement', (a) => {
        // several achievements can unlock in the same tick: announce them together
        this.news(`🏅 Achievement: ${a.title}`); (this.achQ = this.achQ || []).push(a);
        if (this.achQ.length === 1) setTimeout(() => { const q = this.achQ; this.achQ = []; AU.success(); UI.toast(q.length === 1 ? `🏅 <b>${U.esc(q[0].title)}</b> · ${U.esc(q[0].desc)}` : `🏅 <b>${q.length} achievements:</b> ${q.map(x => U.esc(x.title)).join(', ')}`, 'good', 4500); }, 50);
      });
      s.on('day', (rep) => { UI.toast(`📅 <b>Day ${rep.day} wrap-up</b><br>${U.num(rep.riders)} riders · ${U.money(rep.revenue)} fares · ${rep.profit >= 0 ? 'profit' : 'loss'} ${U.money(Math.abs(rep.profit))} · ${Math.round(rep.sat)}% happy`, rep.profit >= 0 ? 'good' : 'bad', 6500); this.save(); });
      s.on('hour', (h) => { if (h % 3 === 0) this.save(); if (h === 7) this.news('🌅 Morning rush begins — platforms are filling up.'); if (h === 17) this.news('🌇 Evening rush is here. Brace for crowds.'); if (h === 23) this.news('🌙 Late-night service. Quiet trains, sleepy riders.'); if (Math.random() < 0.3) this.news('📰 ' + U.pick(FLAVOR)); });
      s.on('gameover', (rep) => this.gameOver(rep));
      s.on('line', (id) => { this.renderTab(true); this.news(`🎉 The ${net.routeById[id].shortName} is open for business!`); });
      s.on('train', () => this.renderTab());
      s.on('unlock', (id) => { this.renderTab(true); this.news(`🆕 The ${C.MODEL[id].name} has entered the fleet catalog.`); });
      s.on('upgrade', () => this.renderTab(true));
    }

    bindUI() {
      $$('.mgr-tab').forEach(b => b.addEventListener('click', () => { this.tab = b.dataset.tab; $$('.mgr-tab').forEach(x => x.classList.toggle('active', x === b)); this.renderTab(true); AU.click(); }));
      const sl = $('#mgr-speed'); sl.value = this.speedIdx;
      sl.addEventListener('input', () => { this.setSpeed(+sl.value); });
      $('#mgr-pause').addEventListener('click', () => { this.setSpeed(this.speedIdx === 0 ? (this.prevSpeedIdx || 3) : 0); AU.click(); });
      $('#mgr-menu').addEventListener('click', () => this.menu());
      $('#mgr-side-toggle').addEventListener('click', () => { $('#screen-manager').classList.toggle('side-open'); AU.click(); });
      $('#mgr-fit').addEventListener('click', () => { this.map.fitAll(false); AU.click(); });
      $('#mgr-home').addEventListener('click', () => { this.map.fitHome(false); AU.click(); });
      $('#mgr-zoom-in').addEventListener('click', () => { this.map.zoomBy(1.6); AU.click(); });
      $('#mgr-zoom-out').addEventListener('click', () => { this.map.zoomBy(1 / 1.6); AU.click(); });
      $('#mgr-info-close').addEventListener('click', () => { this.map.select(null); });
      $('#mgr-info').addEventListener('pointerenter', () => { this.infoHover = true; }); $('#mgr-info').addEventListener('pointerleave', () => { this.infoHover = false; });
      window.addEventListener('resize', () => this.map.resize());
      window.addEventListener('keydown', (e) => {
        if (UI.current !== 'screen-manager' || UI.modalOpen()) return;
        if (e.key === ' ') { e.preventDefault(); $('#mgr-pause').click(); }
        if (e.key >= '0' && e.key <= '6') this.setSpeed(+e.key);
        if (e.key === 'Escape') this.map.select(null);
        if (e.key === '+' || e.key === '=') this.map.zoomBy(1.4);
        if (e.key === '-' || e.key === '_') this.map.zoomBy(1 / 1.4);
      });
    }
    setSpeed(i) { if (this.speedIdx > 0) this.prevSpeedIdx = this.speedIdx; this.speedIdx = U.clamp(i, 0, SPEEDS.length - 1); $('#mgr-speed').value = this.speedIdx; this.updateTop(true); }

    // ---------------- loop ----------------
    update(dt, mapVisible) {
      const s = this.sim;
      if (!this.blocked && !UI.modalOpen() && !s.state.over) s.advance(SPEEDS[this.speedIdx] * dt);
      if (mapVisible) { this.map.update(dt); this.map.render(); }
      this.topT = (this.topT || 0) - dt; if (this.topT <= 0) { this.topT = 0.25; this.updateTop(); if (mapVisible) { this.refreshTab(); this.refreshInfo(); } }
      // income rate (per game hour), measured on revenue only
      const r = s.state.stats.revenue; this.rateHist.push([s.state.time, r]); while (this.rateHist.length > 2 && s.state.time - this.rateHist[0][0] > 3600) this.rateHist.shift();
    }
    incomeRate() { const h = this.rateHist; if (h.length < 2) return 0; const dt = h[h.length - 1][0] - h[0][0]; return dt > 60 ? (h[h.length - 1][1] - h[0][1]) / dt * 3600 : 0; }

    updateTop(force) {
      const st = this.sim.state;
      $('#mgr-money').textContent = U.money(st.money); $('#mgr-money').classList.toggle('neg', st.money < 0);
      const rate = this.incomeRate(); $('#mgr-rate').textContent = rate > 0 ? `+${U.money(rate)}/hr fares` : '';
      $('#mgr-day').textContent = `Day ${st.day}`; $('#mgr-time').textContent = U.clock(st.time % 86400);
      $('#mgr-rush').textContent = this.sim.isRush() ? '🔥 RUSH HOUR' : '';
      const sat = st.sat; $('#mgr-sat-val').textContent = `${Math.round(sat)}%`;
      $('#mgr-sat-fill').style.width = `${sat}%`; $('#mgr-sat-fill').style.background = sat > 70 ? 'linear-gradient(90deg,#3ad46b,#8cf06a)' : sat > 45 ? 'linear-gradient(90deg,#ffb02e,#ffd23f)' : 'linear-gradient(90deg,#ff3b3b,#ff7a59)';
      $('#mgr-sat-target').style.left = `${st.satTarget}%`;
      $('#mgr-sat-face').textContent = sat > 85 ? '😍' : sat > 70 ? '😀' : sat > 55 ? '🙂' : sat > 40 ? '😐' : sat > 25 ? '😠' : '🤬';
      $('#mgr-sat-trend').textContent = st.satTarget > sat + 2 ? '▲' : st.satTarget < sat - 2 ? '▼' : '';
      $('#mgr-sat-trend').className = st.satTarget > sat + 2 ? 'up' : 'down';
      $('#mgr-speed-label').textContent = SPEED_LABEL[this.speedIdx]; $('#mgr-pause').textContent = this.speedIdx === 0 ? '▶' : '⏸';
      $('#screen-manager').classList.toggle('paused', this.speedIdx === 0);
      const t = $('#mgr-ticker-inner'); if (force || !t.dataset.n || +t.dataset.n !== this.headlines.length) { t.dataset.n = this.headlines.length; t.innerHTML = this.headlines.slice(-8).reverse().map(h => `<span>${h}</span>`).join(''); }
    }
    updateMiniBar() { const st = this.sim.state; $('#fp-mgr-money').textContent = U.money(st.money); $('#fp-mgr-sat').style.width = `${st.sat}%`; $('#fp-mgr-satv').textContent = `${Math.round(st.sat)}%`; $('#fp-mgr-time').textContent = `Day ${st.day} · ${U.clock(st.time % 86400)}`; }
    news(text) { this.headlines.push(U.esc(text)); if (this.headlines.length > 40) this.headlines.shift(); this.updateTop(true); }

    // ---------------- side panel ----------------
    renderTab(force) {
      const el = $('#mgr-panel'); const scroll = el.scrollTop;
      if (this.tab === 'lines') el.innerHTML = this.linesHTML();
      if (this.tab === 'fleet') el.innerHTML = this.fleetHTML();
      if (this.tab === 'upgrades') el.innerHTML = this.upgradesHTML();
      if (this.tab === 'stats') el.innerHTML = this.statsHTML();
      el.scrollTop = scroll;
      el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this.act(b.dataset.act, b.dataset.arg); }));
      el.querySelectorAll('.line-row').forEach(row => {
        row.addEventListener('click', () => { this.map.focusRoute(row.dataset.id); this.map.select({ type: 'route', id: row.dataset.id }); });
        row.addEventListener('mouseenter', () => this.map.highlightRoute = row.dataset.id); row.addEventListener('mouseleave', () => this.map.highlightRoute = null);
      });
      el.querySelectorAll('.fleet-art').forEach(cv => this.drawTrainArt(cv, C.MODEL[cv.dataset.model]));
      this.refreshTab();
    }
    refreshTab() {
      const s = this.sim, st = s.state;
      if (this.tab === 'lines') {
        const price = C.MODEL[st.model].price;
        for (const r of net.routes) {
          const row = $(`.line-row[data-id="${r.id}"]`); if (!row) continue; const ls = s.lineStats(r.id);
          const info = row.querySelector('.line-info');
          if (info) {
            const hw = ls.trains ? Math.max(1, Math.round(ls.headway / 60)) : 0; const sev = !ls.trains || hw > 20 ? 'bad' : hw > 10 ? 'warn' : 'ok';
            const html = `<span class="chip-s">${ls.trains} train${ls.trains === 1 ? '' : 's'}</span><span class="chip-s ${sev}">${ls.trains ? 'every ' + hw + ' min' : 'no trains'}</span><span class="chip-s">${U.num(ls.waiting)} waiting</span>${ls.incidents ? '<span class="chip-s bad">⚠ delays</span>' : ''}`;
            if (info.innerHTML !== html) info.innerHTML = html;
          }
          const buy = row.querySelector('[data-act="buy"]'); if (buy) buy.disabled = st.money < (ls.active ? price : s.lineActivationCost(r) + price);
          const sell = row.querySelector('[data-act="sell"]'); if (sell) sell.disabled = ls.trains === 0;
        }
      }
      if (this.tab === 'upgrades') $$('#mgr-panel [data-act="upgrade"]').forEach(b => { const u = C.UPGRADE[b.dataset.arg]; const lvl = st.upgrades[u.key]; b.disabled = lvl >= u.max || st.money < C.upgradeCost(u, lvl); });
      if (this.tab === 'fleet') $$('#mgr-panel [data-act="unlock"]').forEach(b => { b.disabled = st.money < C.MODEL[b.dataset.arg].unlock; });
      if (this.tab === 'stats') { const live = $('#mgr-stats-live'); if (live) live.innerHTML = this.statsLive(); this.drawChart(); }
    }
    linesHTML() {
      const s = this.sim, st = s.state; const m = C.MODEL[st.model];
      const routes = ORDER.map(id => net.routeById[id]).filter(Boolean);
      const act = routes.filter(r => st.routes[r.id].active), idle = routes.filter(r => !st.routes[r.id].active);
      const activeRow = (r) => `<div class="line-row active" data-id="${r.id}">
          ${UI.bullet(r, 'md')}
          <div class="line-main"><div class="line-name">${U.esc(lineName(r))}</div><div class="line-info"></div></div>
          <div class="line-btns"><button class="btn btn-sm" data-act="buy" data-arg="${r.id}" title="Buy a ${U.esc(m.name)} for ${U.money(m.price)}">+ Train</button><button class="btn btn-sm btn-ghost sell" data-act="sell" data-arg="${r.id}" title="Retire a train (35% refund)" aria-label="Retire a train">−</button></div>
        </div>`;
      const idleRow = (r) => { const cost = s.lineActivationCost(r) + m.price; return `<div class="line-row idle" data-id="${r.id}">
          ${UI.bullet(r, 'sm')}
          <div class="line-main"><div class="line-name">${U.esc(lineName(r))}</div><div class="line-sub">${r.stops.length} stations</div></div>
          <button class="btn btn-sm btn-go" data-act="buy" data-arg="${r.id}" title="Opens the line and buys its first train">Open · ${U.money(cost)}</button>
        </div>`; };
      return `<div class="buying"><span class="lbl">New trains</span><b>${U.esc(m.name)}</b><small>${m.cap} riders · ${U.money(m.price)}</small><button class="link-btn" data-act="tab" data-arg="fleet">Change</button></div>
        ${act.length ? `<h4 class="sec">In service <span>${act.length}</span></h4>${act.map(activeRow).join('')}` : ''}
        <h4 class="sec">Not running yet <span>${idle.length}</span></h4>
        ${st.freeLine ? '<p class="panel-hint">Your first line opens free. You only pay for its first train.</p>' : ''}
        ${idle.map(idleRow).join('')}`;
    }
    fleetHTML() {
      const st = this.sim.state; const counts = {}; st.trains.forEach(t => counts[t.model] = (counts[t.model] || 0) + 1);
      const maxCap = C.MODELS[C.MODELS.length - 1].cap;
      const bar = (l, v) => `<div class="statbar"><span>${l}</span><i><b style="width:${Math.round(v * 100)}%"></b></i></div>`;
      return `<p class="panel-note">Newer cars carry more riders, run faster, keep riders happier and break down less.</p>` + C.MODELS.map((m, i) => {
        const unlocked = st.unlocked.includes(m.id); const prevOk = i === 0 || st.unlocked.includes(C.MODELS[i - 1].id);
        const older = st.trains.filter(t => C.MODELS.findIndex(x => x.id === t.model) < i).length;
        return `<div class="fleet-card ${unlocked ? '' : 'locked'} ${st.model === m.id ? 'selected' : ''}">
          <canvas class="fleet-art" data-model="${m.id}" width="280" height="64"></canvas>
          <div class="fleet-head"><b>${U.esc(m.name)}</b><span>${m.year}${counts[m.id] ? ` · ${counts[m.id]} in service` : ''}</span></div>
          <div class="fleet-blurb">${U.esc(m.blurb)}</div>
          ${bar('Capacity', m.cap / maxCap)}${bar('Speed', (m.speed - 0.9) / 0.35)}${bar('Comfort', (m.comfort + 2) / 20)}${bar('Reliability', (m.rel - 0.6) / 0.39)}
          <div class="fleet-meta">${m.cap} riders · ${U.money(m.price)} per train · ${U.money(m.op)}/hr to run</div>
          <div class="fleet-btns">${unlocked
            ? (st.model === m.id ? '<span class="pill">✓ Buying this model</span>' : `<button class="btn btn-sm" data-act="model" data-arg="${m.id}">Buy this model</button>`) + (older ? `<button class="btn btn-sm btn-go" data-act="replace" data-arg="${m.id}">Replace oldest (${older})</button>` : '')
            : `<button class="btn btn-sm btn-go" data-act="unlock" data-arg="${m.id}" ${prevOk ? '' : 'disabled'}>🔓 Unlock ${U.money(m.unlock)}</button>`}</div>
        </div>`;
      }).join('');
    }
    upgradesHTML() {
      const st = this.sim.state;
      return `<p class="panel-note">Each upgrade applies to every line and station you run.</p>` + C.UPGRADES.map(u => {
        const lvl = st.upgrades[u.key]; const cost = C.upgradeCost(u, lvl);
        return `<div class="upg-row"><div class="upg-icon">${u.icon}</div><div class="upg-main"><div class="upg-head"><b>${U.esc(u.name)}</b><span class="lvl">Lv ${lvl}/${u.max}</span></div><div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div><small>${U.esc(u.desc)}</small></div>
          <button class="btn btn-sm ${lvl >= u.max ? '' : 'btn-go'}" data-act="upgrade" data-arg="${u.key}">${lvl >= u.max ? 'Maxed' : U.money(cost)}</button></div>`;
      }).join('');
    }
    statsLive() {
      const s = this.sim, st = s.state, d = st.stats.today, p = st.satParts || {};
      const row = (l, v, cls = '') => `<div class="kv"><span>${l}</span><b class="${cls}">${v}</b></div>`;
      const part = (l, v) => Math.abs(v || 0) >= 0.05 ? `<div class="satpart ${v > 0 ? 'pos' : 'neg'}"><span>${l}</span><b>${v > 0 ? '+' : ''}${v.toFixed(1)}</b></div>` : '';
      const mods = st.mods.map(m => `<div class="mod">${U.esc(m.label)} <small>${m.kind} ${m.value > 0 ? '+' : ''}${m.kind === 'sat' ? m.value : Math.round(m.value * 100) + '%'} · ${U.duration(m.until - st.time)}</small></div>`).join('');
      const profit = d.revenue - d.costs;
      return `<div class="kv-group"><h4 class="sec">Today</h4>
          ${row('Riders', U.num(d.riders))}${row('Fares collected', U.money(d.revenue))}${row('Operating costs', U.money(d.costs))}${row('Operating profit', U.money(profit), profit >= 0 ? 'good' : 'bad')}${row('Invested in trains & upgrades', U.money(d.capex || 0))}</div>
        <div class="kv-group"><h4 class="sec">Service</h4>
          ${row('Average wait', `${(st.avgWait / 60).toFixed(1)} min`, st.avgWait > 900 ? 'bad' : '')}${row('Train load', `${Math.round(st.avgLoad * 100)}%`, st.avgLoad > 0.9 ? 'bad' : '')}${row('Trains in service', st.trains.length)}${row('Fare', U.money(st.fare, true))}${row('Fare evasion', `${Math.round(s.evasion() * 100)}%`)}</div>
        <div class="kv-group"><h4 class="sec">All time</h4>${row('Riders', U.num(st.stats.riders))}${row('Fares collected', U.money(st.stats.revenue))}</div>
        <h4 class="sec">Why riders feel this way</h4>
        <div class="satparts">${part('Base mood', 64)}${part('Train comfort', p.comfort)}${part('Upgrades', p.upg)}${part('Events', p.mod)}${part('Long waits', -p.waitPen)}${part('Crowding', -p.crowdPen)}${part('Incidents', -p.incPen)}${part('Delayed trains', -p.heldPen)}${part('Gave up waiting', -p.walkPen)}${part('Turned away at gates', -p.rejPen)}</div>
        ${mods ? `<h4 class="sec">Active effects</h4>${mods}` : ''}`;
    }
    statsHTML() {
      const st = this.sim.state;
      const ach = C.ACHIEVEMENTS.map(a => `<div class="ach ${st.achievements[a.id] ? 'got' : ''}" title="${U.esc(a.desc)}"><span>${a.icon}</span><small>${U.esc(a.title)}</small></div>`).join('');
      return `<div id="mgr-stats-live"></div><h4 class="sec">Last 48 hours</h4><canvas id="mgr-chart" width="300" height="130"></canvas><div class="chart-legend"><span class="lg-money">Funds</span><span class="lg-sat">Satisfaction</span></div><h4 class="sec">Achievements</h4><div class="ach-grid">${ach}</div>`;
    }
    drawChart() {
      const cv = $('#mgr-chart'); if (!cv) return; const ctx = cv.getContext('2d'); const W = cv.width, H = cv.height; ctx.clearRect(0, 0, W, H);
      const h = this.sim.state.stats.hourly.slice(-48); if (h.length < 2) { ctx.fillStyle = '#777'; ctx.font = '12px Helvetica'; ctx.fillText('Data appears after a few game hours…', 10, H / 2); return; }
      const mx = Math.max(1, ...h.map(p => p.money)), mn = Math.min(0, ...h.map(p => p.money));
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1; for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, i * H / 4); ctx.lineTo(W, i * H / 4); ctx.stroke(); }
      const plot = (f, col) => { ctx.beginPath(); h.forEach((p, i) => { const x = i / (h.length - 1) * (W - 4) + 2, y = H - 4 - f(p) * (H - 8); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke(); };
      plot(p => (p.money - mn) / (mx - mn || 1), '#1f9d55'); plot(p => p.sat / 100, '#e8343a');
    }
    drawTrainArt(cv, m) {
      const ctx = cv.getContext('2d'); const W = cv.width, H = cv.height; ctx.clearRect(0, 0, W, H);
      const cars = 3, cw = (W - 20) / cars;
      for (let c = 0; c < cars; c++) {
        const x = 10 + c * cw, y = 10, w = cw - 6, h = H - 22;
        U.roundRect(ctx, x, y, w, h, m.future ? 16 : 6); ctx.fillStyle = m.body; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#1d1d24'; ctx.stroke();
        if (m.fluted) { ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1; for (let yy = y + h * 0.62; yy < y + h - 3; yy += 4) { ctx.beginPath(); ctx.moveTo(x + 3, yy); ctx.lineTo(x + w - 3, yy); ctx.stroke(); } }
        ctx.fillStyle = m.stripe; if (m.stripe !== m.body) ctx.fillRect(x + 2, y + h * 0.55, w - 4, h * 0.1);
        if (m.gold) { ctx.fillStyle = '#f2b81b'; ctx.fillRect(x + 2, y + h * 0.66, w - 4, h * 0.05); }
        ctx.fillStyle = '#2b3d5c'; for (let wi = 0; wi < 4; wi++) ctx.fillRect(x + 8 + wi * (w - 16) / 4, y + h * 0.18, (w - 16) / 4 - 6, h * 0.28);
        ctx.fillStyle = '#9aa3ad'; ctx.fillRect(x + w * 0.47, y + h * 0.15, w * 0.06, h * 0.8);
        ctx.fillStyle = '#1d1d24'; ctx.beginPath(); ctx.arc(x + w * 0.2, y + h + 4, 5, 0, 7); ctx.arc(x + w * 0.8, y + h + 4, 5, 0, 7); ctx.fill();
        if (m.gangway && c < cars - 1) { ctx.fillStyle = '#555'; ctx.fillRect(x + w - 2, y + 8, 10, h - 16); }
        if (m.led && c === 0) { ctx.fillStyle = '#ff9a00'; ctx.fillRect(x + 6, y + 3, w * 0.3, 4); }
      }
      if (!this.sim.state.unlocked.includes(m.id)) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(0, 0, W, H); ctx.font = '28px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🔒', W / 2, H / 2); }
    }

    // ---------------- actions ----------------
    act(a, arg) {
      const s = this.sim; let res = { ok: true };
      if (a === 'buy') { const wasActive = s.state.routes[arg].active; res = s.buyTrain(arg); if (res.ok) { AU.cash(); UI.toast(`${UI.bullet(net.routeById[arg], 'xs')} ${wasActive ? 'New train in service!' : `<b>${U.esc(net.routeById[arg].shortName)} is open!</b> First riders are tapping in…`}`, 'good'); this.map.focusRoute(arg); } }
      if (a === 'sell') { const t = s.routeTrains(arg).sort((x, y) => C.MODEL[x.model].rel - C.MODEL[y.model].rel)[0]; if (t) { res = s.retireTrain(t.id); if (res.ok) UI.toast(`Train retired. Refund ${U.money(res.refund)}`, 'info'); } }
      if (a === 'unlock') { res = s.unlockModel(arg); if (res.ok) { AU.success(); UI.toast(`🔓 <b>${U.esc(C.MODEL[arg].name)}</b> unlocked! New trains will be this model.`, 'good'); } }
      if (a === 'model') { s.state.model = arg; AU.click(); this.renderTab(true); }
      if (a === 'replace') { const idx = C.MODELS.findIndex(m => m.id === arg); const t = s.state.trains.filter(x => C.MODELS.findIndex(m => m.id === x.model) < idx).sort((x, y) => C.MODELS.findIndex(m => m.id === x.model) - C.MODELS.findIndex(m => m.id === y.model))[0]; if (t) { res = s.replaceTrain(t.id, arg); if (res.ok) { AU.cash(); UI.toast(`Train #${t.id} on the ${net.routeById[t.route].shortName} is now a ${C.MODEL[arg].name}`, 'good'); } } }
      if (a === 'upgrade') { res = s.buyUpgrade(arg); if (res.ok) { AU.success(); UI.toast(`${C.UPGRADE[arg].icon} <b>${U.esc(C.UPGRADE[arg].name)}</b> → level ${s.state.upgrades[arg]}`, 'good'); } }
      if (a === 'rush') { res = s.rushIncident(+arg); if (res.ok) { AU.cash(); UI.toast('🚨 Emergency crew dispatched — problem solved!', 'good'); this.map.select(null); } }
      if (a === 'watch') this.watchTrain(+arg);
      if (a === 'tab') { const b = $(`.mgr-tab[data-tab="${arg}"]`); if (b) b.click(); return; }
      if (a === 'retire') { res = s.retireTrain(+arg); if (res.ok) { UI.toast(`Train retired. Refund ${U.money(res.refund)}`, 'info'); this.map.select(null); } }
      if (a === 'upgradeTrain') { res = s.replaceTrain(+arg); if (res.ok) AU.cash(); }
      if (a === 'route') { this.map.focusRoute(arg); this.map.select({ type: 'route', id: arg }); }
      if (!res.ok && res.msg) { UI.toast(`💸 ${U.esc(res.msg)}`, 'bad'); AU.fail(); }
      this.renderTab(); this.refreshInfo(true); this.updateTop(true);
    }

    // ---------------- selection card ----------------
    onSelect(hit) { this.sel = hit; this.refreshInfo(true); if (hit && hit.type === 'route' && this.tab !== 'lines') { /* keep tab */ } }
    refreshInfo(force) {
      const box = $('#mgr-info'); const hit = this.sel; const s = this.sim, st = s.state;
      if (!hit) { box.classList.add('hidden'); return; }
      let html = '';
      if (hit.type === 'station') {
        const stn = net.stations[hit.idx]; const w = s.stationWaiting(stn.idx); const cap = s.platformCap(stn);
        const routes = stn.complexRoutes.map(ri => net.routes[ri]);
        html = `<div class="info-title">🚉 ${U.esc(U.stationName(stn.name))}</div><div class="info-sub">${net.BORO_NAME[stn.boro]} · ${net.STRUCT_NAME[stn.struct]}${s.stationClosed(stn.idx) ? ' · <span class="bad">CLOSED</span>' : ''}</div>
          <div class="info-bullets">${routes.map(r => `<span class="${st.routes[r.id].active ? '' : 'faded'}" data-act="route" data-arg="${r.id}">${UI.bullet(r, 'sm')}</span>`).join('')}</div>
          <div class="info-line">👥 ${U.num(w)} waiting <div class="minibar"><b style="width:${Math.min(100, w / cap * 100)}%;background:${w / cap > 0.85 ? '#ff4d4d' : '#7a5cff'}"></b></div></div>
          ${routes.some(r => !st.routes[r.id].active) ? `<div class="btn-row tight">${routes.filter(r => !st.routes[r.id].active).slice(0, 4).map(r => `<button class="btn btn-sm btn-go" data-act="buy" data-arg="${r.id}" title="Open this line and buy its first train">Open ${UI.bullet(r, 'xs')} ${U.money(s.lineActivationCost(r) + C.MODEL[st.model].price)}</button>`).join('')}</div>` : ''}`;
      } else if (hit.type === 'train') {
        const t = st.trains.find(x => x.id === hit.id); if (!t) { this.sel = null; box.classList.add('hidden'); return; }
        const r = net.routeById[t.route], m = C.MODEL[t.model]; const next = net.stations[r.stops[U.clamp(t.next, 0, r.stops.length - 1)]];
        const stateTxt = { run: t.held > 30 ? '🛑 Held by train ahead' : `🚄 ${Math.round(U.mph(t.v))} mph`, dwell: '🚪 Doors open', turn: '🔄 Turning at terminal', layover: '⏳ Waiting to depart', broken: '🔧 BROKEN DOWN' }[t.state] || t.state;
        const better = st.model !== t.model && C.MODELS.findIndex(x => x.id === st.model) > C.MODELS.findIndex(x => x.id === t.model);
        html = `<div class="info-title">${UI.bullet(r, 'sm')} Train #${t.id} · ${U.esc(m.name)}</div><div class="info-sub">${stateTxt} · toward ${U.esc(U.stationName(net.terminal(r, t.dir).name))}</div>
          <div class="info-line">Next: <b>${U.esc(U.stationName(next.name))}</b></div>
          <div class="info-line">Load ${Math.round(t.load)}/${m.cap} <div class="minibar"><b style="width:${Math.min(100, t.load / m.cap * 100)}%;background:${t.load / m.cap > 0.9 ? '#ff4d4d' : '#2fbf71'}"></b></div></div>
          <div class="btn-row"><button class="btn btn-sm btn-go" data-act="watch" data-arg="${t.id}">👁 Watch from cab</button>${better ? `<button class="btn btn-sm" data-act="upgradeTrain" data-arg="${t.id}">⬆ ${U.esc(C.MODEL[st.model].name)}</button>` : ''}<button class="btn btn-sm btn-ghost" data-act="retire" data-arg="${t.id}">Retire</button></div>`;
      } else if (hit.type === 'incident') {
        const inc = st.incidents.find(i => i.id === hit.id); if (!inc) { this.sel = null; box.classList.add('hidden'); return; }
        html = `<div class="info-title">${inc.icon} ${U.esc(inc.label)}</div><div class="info-sub">${UI.bullet(net.routeById[inc.route], 'xs')} Clears in about ${U.duration(inc.end - st.time)} (game time)</div>
          <div class="info-line">Riders are getting angry. Send an emergency crew to fix it right now?</div>
          <button class="btn btn-sm btn-go" data-act="rush" data-arg="${inc.id}">🚨 Send crew — ${U.money(inc.fix)}</button>`;
      } else if (hit.type === 'route') {
        const r = net.routeById[hit.id]; const ls = s.lineStats(r.id);
        html = `<div class="info-title">${UI.bullet(r, 'sm')} ${U.esc(r.name)}</div><div class="info-sub">${U.esc(U.stationName(net.stations[r.stops[0]].name))} ↔ ${U.esc(U.stationName(net.stations[r.stops[r.stops.length - 1]].name))} · ${r.stops.length} stations · ${(r.len / 1609).toFixed(1)} mi</div>
          <div class="info-line">${ls.active ? `🚆 ${ls.trains} trains · 👥 ${U.num(ls.waiting)} waiting · 🧍 ${U.num(ls.load)} riding` : 'Not in service yet.'}</div>
          <button class="btn btn-sm btn-go" data-act="buy" data-arg="${r.id}">${ls.active ? '+ Train' : 'Open line + train'} ${U.money((ls.active ? 0 : s.lineActivationCost(r)) + C.MODEL[st.model].price)}</button>`;
      }
      if (force || (box.dataset.html !== html && !this.infoHover)) {
        box.querySelector('.info-content').innerHTML = html; box.dataset.html = html;
        box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this.act(b.dataset.act, b.dataset.arg); }));
      }
      box.classList.remove('hidden');
    }

    // ---------------- decisions ----------------
    showDecision(ev, ctx) {
      this.blocked = true;
      const R = (v) => C.resolveText(v, ctx);
      UI.choice({ icon: ev.icon, kicker: ev.kicker, title: ev.title, text: U.esc(R(ev.text)), a: { label: R(ev.a.label), hint: R(ev.a.hint) }, b: { label: R(ev.b.label), hint: R(ev.b.hint) } }).then(k => {
        const fx = this.sim.resolveEvent(k); this.blocked = false;
        const bits = []; if (fx.money) bits.push(`${fx.money > 0 ? '+' : '−'}${U.money(Math.abs(fx.money))}`); if (fx.sat) bits.push(`${fx.sat > 0 ? '+' : ''}${fx.sat} satisfaction`); if (fx.upgrade) bits.push(`+1 ${C.UPGRADE[fx.upgrade.key].name}`); if (fx.fare) bits.push(`fare now ${U.money(this.sim.state.fare, true)}`);
        UI.toast(`${ev.icon} <b>${U.esc(R(ev[k].label))}</b>${bits.length ? '<br>' + bits.join(' · ') : ''}`, (fx.money || 0) >= 0 && (fx.sat || 0) >= 0 ? 'good' : 'info', 4500);
        this.news(`${ev.icon} ${ev.title}: the MTA chose to "${R(ev[k].label)}"`);
        this.updateTop(true); this.renderTab();
      });
    }

    // ---------------- watch from cab ----------------
    watchTrain(id) {
      const t = this.sim.state.trains.find(x => x.id === id); if (!t) return;
      const r = net.routeById[t.route]; const last = r.stops.length - 1;
      let from = t.state === 'run' ? U.clamp(t.next - t.dir, 0, last) : U.clamp(t.next - t.dir, 0, last);
      if ((t.dir > 0 && from >= last) || (t.dir < 0 && from <= 0)) from = U.clamp(from - t.dir, 0, last);
      this.watching = id; AU.click();
      SC.FP.start('watch', { routeId: r.id, from, dir: t.dir, count: 14, hour: this.sim.hour(), trainId: id });
    }

    // ---------------- menu / save / game over ----------------
    save() { if (!this.sim.state.over) U.save(SAVE_KEY, this.sim.serialize()); }
    menu() {
      const prev = this.speedIdx; this.blocked = true;
      const root = $('#modal-root'); const card = UI.el('div', 'modal-backdrop');
      card.innerHTML = `<div class="modal info-card pop-in"><div class="choice-icon">🗽</div><h2>MTA Headquarters</h2><div class="btn-col">
        <button class="btn btn-primary" data-a="resume">Back to work</button><button class="btn" data-a="save">💾 Save game</button>
        <button class="btn" data-a="help">❓ How to play</button><button class="btn" data-a="quit">🏠 Main menu (auto-saves)</button><button class="btn btn-ghost" data-a="reset">🗑 Start over</button></div></div>`;
      root.appendChild(card);
      card.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
        AU.click(); card.remove(); this.blocked = false;
        if (b.dataset.a === 'save') { this.save(); UI.toast('💾 Saved!', 'good'); }
        if (b.dataset.a === 'help') this.help();
        if (b.dataset.a === 'quit') { this.save(); SC.app.showTitle(); }
        if (b.dataset.a === 'reset') { const ok = await UI.confirm({ icon: '🗑', title: 'Start a new MTA?', html: 'Your current system and savings will be lost.', yes: 'Start over' }); if (ok) { U.remove(SAVE_KEY); SC.app.startManager(true); } }
      }));
      this.speedIdx = prev;
    }
    help(first) {
      this.blocked = true;
      return UI.alert({ icon: '🚇', title: first ? 'Welcome, Commissioner!' : 'How to run the MTA', html: `
        ${first ? `<p>Albany just injected <b>${U.money(this.sim.state.money, true)}</b> into the MTA. Your first line opening is on the house — pick a line and put your <b>first train</b> in service.</p>` : ''}
        <ul class="howto">
          <li>💳 Every rider pays the <b>${U.money(this.sim.state.fare, true)}</b> fare when they tap through the gate — watch the cash pop out of stations.</li>
          <li>🚆 Riders only come to stations on lines you operate. More trains = shorter waits = happier riders = more riders.</li>
          <li>😀 The <b>satisfaction bar</b> drops with long waits, crowding, delays and incidents. Happy riders ride more.</li>
          <li>🔓 Unlock newer car classes in <b>Fleet</b> for bigger, faster, comfier trains. Buy <b>Upgrades</b> for system-wide boosts.</li>
          <li>⚠️ Click incidents on the map to send a crew. Every so often you'll face a tough <b>A-or-B decision</b>.</li>
          <li>⏩ Use the time slider (or keys 0–6, Space to pause). Click any train and hit <b>👁 Watch from cab</b>.</li>
          <li>💸 Stay out of the red: three days in debt and Albany takes over.</li>
        </ul>`, button: first ? "Let's build a subway" : 'Got it' }).then(() => { this.blocked = false; });
    }
    gameOver(rep) {
      U.remove(SAVE_KEY); this.blocked = true; AU.fail();
      UI.alert({ icon: '🏛️', title: 'Albany Takes Over', html: `<p>After days in the red, the State has stepped in and replaced you.</p><p>You moved <b>${U.num(this.sim.state.stats.riders)}</b> riders and collected <b>${U.money(this.sim.state.stats.revenue)}</b> in fares across ${this.sim.state.day} days.</p>`, button: 'Try again' }).then(() => SC.app.startManager(true));
    }
  }
  ManagerMode.SAVE_KEY = SAVE_KEY;
  SC.ManagerMode = ManagerMode;
})(window.SC);
