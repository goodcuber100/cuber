// Screen controller for first-person play: Conductor (you drive), Ride Along (autopilot),
// and Watch-from-cab launched from MTA Manager. Owns the HUD, dashboard and keyboard input.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const U = SC.util, UI = SC.ui, AU = SC.audio, net = SC.net;
  const $ = UI.$;
  const CAREER_KEY = 'standclear.career';
  const RANKS = [[0, 'Trainee'], [800, 'Conductor'], [2500, 'Train Operator'], [6000, 'Motorman'], [12000, 'Road Car Inspector'], [25000, 'Subway Legend']];

  const FP = {
    game: null, renderer: null, kind: null,
    career: U.load(CAREER_KEY, { runs: 0, pay: 0, perfect: 0, stops: 0, best: {} }),
    rank() { let r = RANKS[0][1]; for (const [p, n] of RANKS) if (this.career.pay >= p) r = n; return r; },

    init() {
      this.canvas = $('#fp-canvas'); this.renderer = new SC.FPRenderer(this.canvas);
      this.sideCanvas = $('#fp-side');
      this.buildDash();
      window.addEventListener('keydown', (e) => this.onKey(e));
      window.addEventListener('resize', () => { if (this.game) this.renderer.resize(); });
      $('#fp-watch-exit').addEventListener('click', () => this.exit());
      $('#fp-watch-speed').addEventListener('click', () => { if (!this.game) return; const s = this.game.speedMult >= 4 ? 1 : this.game.speedMult * 2; this.game.speedMult = s; $('#fp-watch-speed').textContent = `⏩ ${s}×`; AU.click(); });
      $('#fp-pause').addEventListener('click', () => this.pauseMenu());
    },

    buildDash() {
      const notches = $('#fp-notches'); notches.innerHTML = '';
      for (let n = 3; n >= -4; n--) {
        const b = UI.el('button', 'notch ' + (n > 0 ? 'np' : n < 0 ? (n === -4 ? 'neb' : 'nb') : 'nc'), SC.ConductorGame.NOTCH_LABEL[n]);
        b.dataset.n = n; b.addEventListener('click', () => this.game && !this.game.auto && this.game.setNotch(n)); notches.appendChild(b);
      }
      const bind = (id, fn) => $(id).addEventListener('click', () => { if (this.game && !this.game.auto) fn(this.game); });
      bind('#fp-btn-open', g => g.openDoors()); bind('#fp-btn-close', g => g.closeDoors()); bind('#fp-btn-horn', g => g.horn());
      bind('#fp-btn-pa', g => g.announce()); bind('#fp-btn-zebra', g => g.pointZebra()); bind('#fp-btn-eb', g => g.emergency()); bind('#fp-btn-rev', g => g.toggleReverse());
      bind('#fp-btn-up', g => g.notchUp()); bind('#fp-btn-down', g => g.notchDown());
    },

    // kind: 'conductor' | 'ride' | 'watch'
    start(kind, opts) {
      this.stop();
      this.kind = kind; this.opts = opts;
      UI.show('screen-fp');
      const scr = $('#screen-fp'); scr.classList.toggle('auto', kind !== 'conductor'); scr.classList.toggle('watching', kind === 'watch');
      $('#fp-watch').classList.toggle('hidden', kind === 'conductor');
      $('#fp-watch-title').innerHTML = kind === 'watch' ? `👁 LIVE · Train #${opts.trainId} ${UI.bullet(net.routeById[opts.routeId], 'sm')}` : `👁 Ride Along ${UI.bullet(net.routeById[opts.routeId], 'sm')}`;
      $('#fp-watch-speed').textContent = '⏩ 1×';
      $('#fp-mgrbar').classList.toggle('hidden', kind !== 'watch');
      requestAnimationFrame(() => {
        this.renderer.resize();
        this.game = new SC.ConductorGame({
          ...opts, autopilot: kind !== 'conductor', watch: kind === 'watch', renderer: this.renderer, sideCanvas: this.sideCanvas,
          dashH: () => (kind === 'conductor' ? $('#fp-dash').offsetHeight : 0),
          onEnd: (rep) => this.onEnd(rep),
        });
        AU.startLoops();
        const st = this.game.stations[0];
        if (kind === 'conductor') {
          this.game.say(`Boarding at ${U.stationName(st.name)} — close the doors (C) when everyone's aboard`, 'info', 5);
          if (!this.career.runs) setTimeout(() => this.tutorial(), 300);
        }
        AU.speak(`This is ${st.name}. This is a ${st.bound.replace(/&/g, 'and')} ${this.game.route.shortName}.`);
      });
    },
    stop() { if (this.game) { this.game.over = true; this.game = null; } AU.stopLoops(); if (window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } },
    exit() { const k = this.kind; this.stop(); AU.click(); if (k === 'watch') SC.app.backToManager(); else SC.app.showConductorSetup(); },

    tutorial() {
      if (!this.game) return;
      this.game.modal(() => UI.alert({ icon: '🚇', title: 'Welcome to the cab!', html: `
        <ul class="howto">
          <li><kbd>W</kbd>/<kbd>↑</kbd> and <kbd>S</kbd>/<kbd>↓</kbd> move the master controller: <b>P1–P3</b> power, <b>C</b> coast, <b>B1–B3</b> brake.</li>
          <li><kbd>Space</kbd> is the emergency brake. Don't spill the coffee ☕ — smooth driving keeps riders comfy.</li>
          <li>Stop with your cab lined up with the black <b>"10"</b> car stop marker. The gauge on the right shows how far you are.</li>
          <li><kbd>Z</kbd> point at the zebra board, <kbd>O</kbd> open doors, <kbd>P</kbd> announce, <kbd>C</kbd> close doors, <kbd>H</kbd> horn.</li>
          <li>Obey speed signs, red signals and yellow work-zone lanterns (10 mph + horn!). Open doors off the platform and someone may step into the gap.</li>
        </ul>`, button: "Let's roll" }));
    },

    onKey(e) {
      if (UI.current !== 'screen-fp' || !this.game || UI.modalOpen()) return;
      const g = this.game; const k = e.key.toLowerCase();
      if (k === 'escape') { e.preventDefault(); return this.pauseMenu(); }
      if (g.auto) { if (k === 'f') $('#fp-watch-speed').click(); return; }
      const map = { w: () => g.notchUp(), arrowup: () => g.notchUp(), s: () => g.notchDown(), arrowdown: () => g.notchDown(), ' ': () => g.emergency(), o: () => g.openDoors(), enter: () => g.openDoors(), c: () => g.closeDoors(), h: () => g.horn(), p: () => g.announce(), z: () => g.pointZebra(), r: () => g.toggleReverse() };
      if (map[k]) { e.preventDefault(); if (!e.repeat || k === 'w' || k === 's' || k === 'arrowup' || k === 'arrowdown') map[k](); }
    },

    pauseMenu() {
      if (!this.game || this.game.over) return; const g = this.game;
      g.modal(() => new Promise(res => {
        const root = $('#modal-root'); const card = UI.el('div', 'modal-backdrop');
        card.innerHTML = `<div class="modal info-card pop-in"><div class="choice-icon">⏸</div><h2>Paused</h2><div class="btn-col">
          <button class="btn btn-primary" data-a="resume">Resume</button>${this.kind === 'conductor' ? '<button class="btn" data-a="restart">Restart shift</button>' : ''}
          <button class="btn" data-a="quit">${this.kind === 'watch' ? 'Back to MTA Manager' : 'Quit to menu'}</button></div></div>`;
        root.appendChild(card);
        card.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { AU.click(); card.remove(); res(b.dataset.a); }));
      })).then(a => { if (a === 'restart') this.start(this.kind, { ...this.opts, seed: undefined }); if (a === 'quit') this.exit(); });
    },

    onEnd(rep) {
      if (this.kind !== 'conductor') {
        // autopilot reached the end: loop the ride (watch returns to manager)
        if (this.kind === 'watch') { UI.toast('The train reached the end of its run.', 'info'); return this.exit(); }
        const r = net.routeById[this.opts.routeId]; const last = this.game.stations[this.game.stations.length - 1].k;
        const dir = (last === 0 || last === r.stops.length - 1) ? -this.opts.dir : this.opts.dir;
        return this.start('ride', { ...this.opts, from: last, dir });
      }
      const c = this.career; c.runs++; c.pay += rep.pay; c.perfect += rep.perfect; c.stops += rep.stops;
      const bestKey = rep.route.id; const isBest = !c.best[bestKey] || rep.score > c.best[bestKey]; if (isBest) c.best[bestKey] = rep.score;
      U.save(CAREER_KEY, c);
      AU.success();
      const row = (l, v) => `<tr><td>${l}</td><td><b>${v}</b></td></tr>`;
      UI.alert({ icon: rep.grade.startsWith('A') ? '🏆' : rep.grade === 'F' ? '😬' : '🚇', title: `Shift complete — Grade ${rep.grade}`, cls: 'report', html: `
        <p class="report-route">${UI.bullet(rep.route, 'sm')} ${U.esc(U.stationName(rep.from))} → ${U.esc(U.stationName(rep.to))}</p>
        <div class="grade grade-${rep.grade.replace('+', 'p')}">${rep.grade}</div>
        <table class="report-table">
          ${row('Score', U.num(rep.score) + (isBest ? ' 🥇 best on this line!' : ''))}
          ${row('Stops', `${rep.stops} (${rep.perfect} perfect, ${rep.great} great)`)}
          ${row('Avg. distance from marker', `${(rep.avgErr * 3.28).toFixed(1)} ft`)}
          ${row('On-time arrivals', `${rep.onTime}/${rep.onTime + rep.late}`)}
          ${row('Safety · Comfort · Service', `${rep.safety} · ${rep.comfort} · ${rep.service}`)}
          ${rep.trips ? row('Signal trips', rep.trips) : ''}${rep.skipped ? row('Stations skipped', rep.skipped) : ''}${rep.falls ? row('Riders in the gap', rep.falls) : ''}
          ${row('Pay for this shift', U.money(rep.pay, true))}
          ${row('Career', `${this.rank()} · ${U.money(c.pay, true)} earned · ${c.runs} shifts`)}
        </table>`, button: 'Back to the yard' }).then(() => this.exit());
    },

    // ---------------- per-frame ----------------
    frame(dt) {
      const g = this.game; if (!g) return;
      g.update(dt); g.render();
      this.hudT = (this.hudT || 0) - dt; if (this.hudT <= 0) { this.hudT = 0.08; this.updateHud(); }
    },

    updateHud() {
      const g = this.game; if (!g) return; const st = g.stations[g.si]; const r = g.route;
      $('#screen-fp').style.setProperty('--dash-h', ($('#fp-dash').offsetHeight || 0) + 'px');
      $('#fp-bullet').innerHTML = UI.bullet(r, 'lg');
      $('#fp-bound').textContent = `${g.stations[0].bound} · ${U.stationName(net.terminal(r, g.opts.dir).name)}`;
      const nextName = st ? U.stationName(st.name) : 'End of shift';
      $('#fp-next-label').textContent = g.phase === 'dwell' || g.phase === 'ready' ? 'Now at' : 'Next stop';
      $('#fp-next').textContent = nextName;
      $('#fp-transfers').innerHTML = st ? st.transfers.slice(0, 7).map(t => UI.bullet(t, 'xs')).join('') : '';
      $('#fp-score').textContent = U.num(Math.round(g.score));
      const m = Math.floor(g.clock / 60), s = Math.floor(g.clock % 60); $('#fp-clock').textContent = `${m}:${String(s).padStart(2, '0')}`;
      const delta = st ? g.clock - g.sched[g.si] : 0; const sched = $('#fp-sched');
      if (!g.started) { sched.textContent = 'Boarding'; sched.className = ''; }
      else if (g.phase === 'run') { const eta = g.sched[g.si] - g.clock; sched.textContent = eta >= 0 ? `due in ${Math.ceil(eta)}s` : `${Math.ceil(-eta)}s late`; sched.className = eta >= -20 ? 'ok' : 'late'; }
      else { sched.textContent = delta <= 20 ? 'On time' : `+${Math.round(delta)}s`; sched.className = delta <= 20 ? 'ok' : 'late'; }
      $('#fp-riders').textContent = U.num(g.riders);
      $('#fp-hour').textContent = U.clock(g.hour * 3600);
      // speedometer
      const mph = U.mph(g.v); const lim = U.mph(g.limit || 0);
      $('#fp-speed').textContent = Math.round(mph);
      $('#fp-needle').style.transform = `rotate(${-120 + U.clamp(mph / 60, 0, 1) * 240}deg)`;
      $('#fp-limit-mark').style.transform = `rotate(${-120 + U.clamp(lim / 60, 0, 1) * 240}deg)`;
      $('#fp-limit').textContent = `LIMIT ${Math.round(lim)}`;
      $('#fp-limit').classList.toggle('over', mph > lim + 3);
      let nl = ''; for (let d = 20; d < 300; d += 10) { const l2 = U.mph(g.track.limitAt(g.z + d)); if (Math.round(l2) !== Math.round(lim)) { nl = `${Math.round(l2)} in ${Math.round(d * 3.28)} ft`; break; } }
      const flag = g.flags.find(f => f.z0 - g.z < 300 && f.z1 > g.z); if (flag) nl = `⚠ WORK ZONE 10 mph ${flag.z0 > g.z ? 'in ' + Math.round((flag.z0 - g.z) * 3.28) + ' ft' : ''}`;
      $('#fp-next-limit').textContent = nl;
      // notches
      UI.$$('#fp-notches .notch').forEach(b => b.classList.toggle('on', +b.dataset.n === g.notch));
      $('#fp-rev').classList.toggle('on', g.reverse);
      // lights
      const dl = $('#fp-light-doors'); dl.className = 'lamp ' + (g.doors === 'closed' ? 'green' : g.doors === 'open' ? 'red' : 'amber blink');
      $('#fp-light-brake').className = 'lamp ' + (g.notch < 0 ? 'red' : 'off');
      let asp = 'G'; for (const sg of g.track.signals) if (sg.z > g.z) { if (sg.z - g.z < 400) asp = sg.state; break; }
      $('#fp-light-signal').className = 'lamp ' + (asp === 'R' ? 'red blink' : asp === 'Y' ? 'amber' : 'green');
      // meters
      const meter = (id, v) => { const el = $(id); el.style.width = v + '%'; el.style.background = v > 66 ? '#2fbf71' : v > 33 ? '#ffb02e' : '#ff4d4d'; };
      meter('#fp-m-safety', g.safety); meter('#fp-m-comfort', g.comfort); meter('#fp-m-service', g.service);
      // button states
      const at = g.phase === 'berthed';
      $('#fp-btn-open').classList.toggle('ready', at && g.doors === 'closed');
      $('#fp-btn-close').classList.toggle('ready', g.doors === 'open' && g.boardingDone() && g.hold <= 0);
      $('#fp-btn-zebra').classList.toggle('ready', (at || g.phase === 'dwell') && !g.zebraDone);
      // alerts
      const al = $('#fp-alert'); const list = g.alerts.slice(-2);
      let html = list.map(a => `<div class="alert alert-${a.cls}" data-k="${U.esc(a.text)}">${U.esc(a.text)}</div>`).join('');
      if (g.hold > 0 && g.doors === 'open') html += `<div class="alert alert-warn hold">⏳ Holding: ${U.esc(g.holdReason)} (<span class="hold-s">${Math.ceil(g.hold)}</span>s)</div>`;
      else if (g.phase === 'dwell' && g.doors === 'open' && g.boardingDone() && !g.auto) html += `<div class="alert alert-info">${g.si === g.stations.length - 1 ? '🏁 Last stop! Close the doors (C) to end your shift' : 'All aboard! Announce (P), then close the doors (C)'}</div>`;
      else if (g.phase === 'ready' && !g.auto) html += `<div class="alert alert-info">Doors closed — power up (W) to depart</div>`;
      const key = html.replace(/<span class="hold-s">\d+<\/span>/, '');
      if (al.dataset.key !== key) { al.dataset.key = key; al.innerHTML = html; } else { const hs = al.querySelector('.hold-s'); if (hs) hs.textContent = Math.ceil(g.hold); }
      // approach gauge
      const ap = $('#fp-approach');
      const showAp = st && g.phase !== 'dwell' && g.phase !== 'ready' && st.zMarker - g.z < 200 && g.z > st.zStart - 200;
      ap.classList.toggle('hidden', !showAp);
      if (showAp) {
        const err = g.z - st.zMarker; const ft = err * 3.28;
        $('#fp-approach-dist').textContent = Math.abs(err) < 0.3 ? 'ON THE MARK' : err < 0 ? `${Math.abs(ft) > 300 ? Math.round(Math.abs(ft) / 10) * 10 : Math.abs(ft).toFixed(Math.abs(ft) < 30 ? 1 : 0)} ft to go` : `${ft.toFixed(1)} ft past`;
        const pos = U.clamp(50 + err / 30 * 50, 0, 100); $('#fp-gauge-needle').style.left = pos + '%';
        ap.className = (Math.abs(err) < 1 ? 'perfect' : Math.abs(err) < 3 ? 'great' : Math.abs(err) <= SC.ConductorGame.OFF_PLATFORM ? 'okay' : 'bad');
      }
      $('#fp-sidewrap').classList.toggle('hidden', !g.sideStation);
      if (g.sideStation) { const e2 = (g.z - g.track.TRAIN_LEN / 2) - g.sideStation.zZebra; $('#fp-zebra-msg').textContent = Math.abs(e2) < 2.5 ? '✔ On the zebra board' : `${e2 < 0 ? '◀' : '▶'} ${Math.abs(e2 * 3.28).toFixed(0)} ft from zebra board`; $('#fp-zebra-msg').className = Math.abs(e2) < 2.5 ? 'ok' : ''; }
      $('#fp-point').classList.toggle('show', g.pointT > 0);
      if (this.kind === 'watch' && SC.app.mgr) SC.app.mgr.updateMiniBar();
    },
  };
  SC.FP = FP;
})(window.SC);
