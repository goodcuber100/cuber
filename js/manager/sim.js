// MTA Manager simulation. Pure logic (no DOM) so it can also run headless for balancing.
// Time unit: game seconds. Distances: metres along the real GTFS route geometry.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const U = SC.util, C = SC.content;

  const DT = 2;                 // fixed simulation step (game seconds)
  const BASE_V = 13.5;          // cruise speed m/s (~30 mph) before multipliers
  const ACCEL = 1.0, DECEL = 1.1;
  const SAFE_GAP = 320;         // block-signal spacing between trains (m)
  const TURNAROUND = 150;       // terminal turnaround time (s)
  const SPAWN = 2.4;           // riders per minute per unit station weight at demand 1.0
  const PLATFORM_CAP = 260;     // riders waiting per platform per unit weight
  const PATIENCE = 40 * 60;     // mean seconds before a waiting rider gives up
  const START_MONEY = 150000;
  // hourly demand profile (AM and PM rush)
  const TOD = [0.15, 0.1, 0.08, 0.08, 0.12, 0.3, 0.8, 1.6, 1.9, 1.4, 0.95, 0.9, 0.95, 0.95, 0.95, 1.1, 1.5, 1.85, 1.6, 1.1, 0.8, 0.6, 0.45, 0.3];
  const INCIDENTS = {
    signal: { icon: '🚦', name: 'Signal problems', min: 25, max: 50, fix: 9000, weight: 3 },
    breakdown: { icon: '🔧', name: 'Train breakdown', min: 15, max: 35, fix: 7000, weight: 3 },
    sick: { icon: '🚑', name: 'Sick passenger', min: 6, max: 12, fix: 2500, weight: 2.5 },
    police: { icon: '🚓', name: 'Police activity', min: 15, max: 30, fix: 5000, weight: 1.5 },
    fire: { icon: '🔥', name: 'Track fire', min: 15, max: 30, fix: 11000, weight: 1 },
  };

  class ManagerSim extends U.Emitter {
    constructor(saved) {
      super();
      this.net = SC.net;
      this.state = saved ? saved : this.freshState();
      this.migrate();
      this.taps = new Float64Array(this.net.stations.length);
      this.acc = 0;
    }

    freshState() {
      const routes = {};
      for (const r of this.net.routes) routes[r.id] = { active: false, waiting: new Array(r.stops.length).fill(0), lastDep: { '1': -1e9, '-1': -1e9 }, delivered: 0 };
      return {
        v: 1, money: START_MONEY, time: 6 * 3600, day: 1, fare: 2.90, sat: 70, satTarget: 70,
        routes, trains: [], nextTrainId: 1, nextIncId: 1,
        upgrades: Object.fromEntries(C.UPGRADES.map(u => [u.key, 0])),
        unlocked: ['R32'], model: 'R32', incidents: [], mods: [], closed: {},
        freeLine: true, nextEventAt: 10 * 3600, eventsSeen: {}, achievements: {},
        avgWait: 0, avgLoad: 0, walkRate: 0, rejectRate: 0, negDays: 0, over: false,
        stats: { riders: 0, revenue: 0, today: this.blankDay(1), days: [], hourly: [] },
      };
    }
    blankDay(day) { return { day, riders: 0, revenue: 0, costs: 0, capex: 0, walkouts: 0, rejected: 0, incidents: 0, satSum: 0, satN: 0 }; }
    migrate() { // tolerate older/partial saves
      const s = this.state;
      for (const r of this.net.routes) if (!s.routes[r.id]) s.routes[r.id] = { active: false, waiting: new Array(r.stops.length).fill(0), lastDep: { '1': -1e9, '-1': -1e9 }, delivered: 0 };
      s.closed = s.closed || {}; s.mods = s.mods || []; s.incidents = s.incidents || [];
    }

    // ---------------- helpers ----------------
    hour() { return (this.state.time % 86400) / 3600; }
    tod() { const h = this.hour(); const i = Math.floor(h); return U.lerp(TOD[i], TOD[(i + 1) % 24], h - i); }
    isRush() { const h = this.hour(); return (h >= 7 && h < 10) || (h >= 16.5 && h < 19.5); }
    mod(kind) { let v = 0; for (const m of this.state.mods) if (m.kind === kind) v += m.value; return v; }
    upg(k) { return this.state.upgrades[k] || 0; }
    activeLineCount() { return this.net.routes.filter(r => this.state.routes[r.id].active).length; }
    routeTrains(id) { return this.state.trains.filter(t => t.route === id); }
    model(id) { return C.MODEL[id]; }
    demandMult() {
      const s = this.state;
      return (0.45 + 0.011 * s.sat) * (1 + 0.08 * this.upg('ads') + 0.05 * this.upg('access') + 0.03 * this.upg('wifi')) * Math.max(0.1, 1 + this.mod('demand'));
    }
    speedMult(routeId) {
      let m = (1 + 0.06 * this.upg('cbtc')) * Math.max(0.2, 1 + this.mod('speed'));
      for (const inc of this.state.incidents) if (inc.type === 'signal' && inc.route === routeId) m *= 0.45;
      return m;
    }
    evasion() { return U.clamp(0.04 - 0.01 * this.upg('omny') + this.mod('evasion'), 0, 0.6); }
    farePaid() { return this.state.fare * (1 - this.evasion()) * Math.max(0, 1 + this.mod('revenue')); }
    lineActivationCost(r) { return this.state.freeLine ? 0 : Math.round((40000 + 3000 * r.stops.length) / 1000) * 1000; }
    platformCap(st) { return PLATFORM_CAP * Math.pow(st.weight, 0.7) * (1 + 0.3 * this.upg('omny')); }
    stationClosed(idx) { return (this.state.closed[idx] || 0) > this.state.time; }
    randomActiveStation() {
      const act = this.net.routes.filter(r => this.state.routes[r.id].active);
      if (!act.length) return null;
      const r = U.pick(act); return this.net.stations[U.pick(r.stops)];
    }
    randomStationName() { const st = this.randomActiveStation() || U.pick(this.net.stations); return U.stationName(st.name); }
    randomActiveRouteName() { const act = this.net.routes.filter(r => this.state.routes[r.id].active); return (act.length ? U.pick(act) : U.pick(this.net.routes)).shortName; }

    // ---------------- player actions ----------------
    canAfford(c) { return this.state.money >= c; }
    spend(c, label) { this.state.money -= c; this.state.stats.today.capex = (this.state.stats.today.capex || 0) + c; this.emit('money', -c, label); }

    activateLine(routeId) {
      const r = this.net.routeById[routeId], rs = this.state.routes[routeId];
      if (rs.active) return { ok: true };
      const cost = this.lineActivationCost(r);
      if (!this.canAfford(cost)) return { ok: false, msg: `Opening the ${r.shortName} costs ${U.money(cost)}.` };
      if (cost) this.spend(cost, 'Line opened');
      rs.active = true; this.state.freeLine = false;
      this.emit('line', routeId);
      return { ok: true, cost };
    }
    trainPrice(modelId) { return C.MODEL[modelId].price; }
    buyTrain(routeId, modelId = this.state.model) {
      const rs = this.state.routes[routeId];
      if (!rs.active) { const a = this.activateLine(routeId); if (!a.ok) return a; }
      const m = C.MODEL[modelId];
      if (!this.state.unlocked.includes(modelId)) return { ok: false, msg: `${m.name} is still locked.` };
      if (!this.canAfford(m.price)) return { ok: false, msg: `A new ${m.name} costs ${U.money(m.price)}.` };
      this.spend(m.price, `New ${m.name}`);
      const r = this.net.routeById[routeId];
      // new trains enter service at whichever terminal has had the longest gap
      const dir = (rs.lastDep['1'] <= rs.lastDep['-1']) ? 1 : -1;
      const k = dir > 0 ? 0 : r.stops.length - 1;
      const t = { id: this.state.nextTrainId++, model: modelId, route: routeId, d: r.stopD[k], dir, v: 0, state: 'layover', timer: 20, load: 0, next: k, born: this.state.time, held: 0 };
      this.state.trains.push(t);
      this.emit('train', t);
      return { ok: true, train: t };
    }
    retireTrain(trainId) {
      const i = this.state.trains.findIndex(t => t.id === trainId); if (i < 0) return { ok: false };
      const t = this.state.trains[i]; const refund = Math.round(C.MODEL[t.model].price * 0.35);
      this.state.trains.splice(i, 1); this.state.money += refund;
      this.state.incidents = this.state.incidents.filter(inc => inc.train !== trainId);
      this.emit('money', refund, 'Train sold'); return { ok: true, refund };
    }
    replaceTrain(trainId, modelId = this.state.model) {
      const t = this.state.trains.find(x => x.id === trainId); if (!t) return { ok: false };
      const m = C.MODEL[modelId]; const refund = Math.round(C.MODEL[t.model].price * 0.35);
      if (t.model === modelId) return { ok: false, msg: 'That train is already the newest model you picked.' };
      if (this.state.money + refund < m.price) return { ok: false, msg: `Need ${U.money(m.price - refund)} after trade-in.` };
      this.state.money += refund; this.spend(m.price, `Upgraded to ${m.name}`); t.model = modelId; t.load = Math.min(t.load, m.cap);
      return { ok: true };
    }
    unlockModel(id) {
      const m = C.MODEL[id]; if (this.state.unlocked.includes(id)) return { ok: true };
      const idx = C.MODELS.indexOf(m);
      if (idx > 0 && !this.state.unlocked.includes(C.MODELS[idx - 1].id)) return { ok: false, msg: `Unlock ${C.MODELS[idx - 1].name} first.` };
      if (!this.canAfford(m.unlock)) return { ok: false, msg: `The ${m.name} contract costs ${U.money(m.unlock)}.` };
      this.spend(m.unlock, `${m.name} contract`); this.state.unlocked.push(id); this.state.model = id;
      this.emit('unlock', id); return { ok: true };
    }
    buyUpgrade(key, free = false) {
      const u = C.UPGRADE[key]; const lvl = this.upg(key);
      if (lvl >= u.max) return { ok: false, msg: 'Already maxed out.' };
      const cost = free ? 0 : C.upgradeCost(u, lvl);
      if (!this.canAfford(cost)) return { ok: false, msg: `${u.name} level ${lvl + 1} costs ${U.money(cost)}.` };
      if (cost) this.spend(cost, u.name);
      this.state.upgrades[key] = lvl + 1; this.emit('upgrade', key); return { ok: true };
    }
    rushIncident(id) {
      const inc = this.state.incidents.find(i => i.id === id); if (!inc) return { ok: false };
      const cost = inc.fix; if (!this.canAfford(cost)) return { ok: false, msg: `A crew costs ${U.money(cost)}.` };
      this.spend(cost, 'Emergency crew'); this.endIncident(inc); return { ok: true };
    }

    // ---------------- decisions ----------------
    maybeEvent() {
      const s = this.state; if (s.pending || s.time < s.nextEventAt || !s.trains.length) return;
      const pool = C.EVENTS.filter(e => !e.cond || e.cond(this));
      let total = 0; const weights = pool.map(e => { const w = (e.weight || 1) / (1 + (s.eventsSeen[e.id] || 0) * 0.7); total += w; return w; });
      let r = Math.random() * total, ev = pool[0];
      for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { ev = pool[i]; break; } }
      const ctx = ev.ctx ? ev.ctx(this) : {};
      s.pending = { id: ev.id, ctx };
      s.eventsSeen[ev.id] = (s.eventsSeen[ev.id] || 0) + 1;
      s.nextEventAt = s.time + U.rand(5, 9) * 3600;
      this.emit('decision', ev, ctx);
    }
    resolveEvent(choice) {
      const s = this.state; if (!s.pending) return null;
      const ev = C.EVENTS.find(e => e.id === s.pending.id); const ctx = s.pending.ctx; s.pending = null;
      const fx = ev[choice].fx(ctx) || {};
      this.applyEffects(fx, ev.title);
      return fx;
    }
    applyEffects(fx, label) {
      const s = this.state;
      if (fx.money) { if (fx.money < 0) this.spend(-fx.money, label); else { s.money += fx.money; this.emit('money', fx.money, label); } }
      if (fx.sat) { s.sat = U.clamp(s.sat + fx.sat, 0, 100); }
      if (fx.fare) s.fare = Math.round((s.fare + fx.fare) * 100) / 100;
      if (fx.mods) for (const m of fx.mods) s.mods.push({ kind: m.kind, value: m.value, until: s.time + m.hours * 3600, label: m.label });
      if (fx.upgrade) this.buyUpgrade(fx.upgrade.key, true);
      if (fx.closeStation && fx.closeStation.idx >= 0) s.closed[fx.closeStation.idx] = s.time + fx.closeStation.hours * 3600;
    }

    // ---------------- incidents ----------------
    spawnIncident() {
      const s = this.state; const act = this.net.routes.filter(r => s.routes[r.id].active && this.routeTrains(r.id).length);
      if (!act.length) return;
      let type; const roll = Math.random() * 11;
      type = roll < 3 ? 'signal' : roll < 6 ? 'breakdown' : roll < 8.5 ? 'sick' : roll < 10 ? 'police' : 'fire';
      if (type === 'police' && Math.random() < this.upg('police') * 0.15) return;
      const r = U.pick(act); const T = INCIDENTS[type];
      const trains = this.routeTrains(r.id).filter(t => t.state === 'run' || t.state === 'dwell');
      const inc = { id: s.nextIncId++, type, route: r.id, start: s.time, end: s.time + U.rand(T.min, T.max) * 60, fix: Math.round(T.fix * (1 + s.day * 0.05) / 500) * 500 };
      if (type === 'breakdown' || type === 'sick') {
        if (!trains.length) return;
        // older models break down more often
        const t = type === 'breakdown' ? trains.slice().sort((a, b) => C.MODEL[a.model].rel - C.MODEL[b.model].rel)[Math.floor(Math.random() * Math.min(2, trains.length))] : U.pick(trains);
        if (s.incidents.some(i => i.train === t.id)) return;
        inc.train = t.id; inc.k = t.next;
        if (type === 'breakdown') { t.state = 'broken'; t.v = 0; }
      } else {
        inc.k = U.randInt(0, r.stops.length - 1);
      }
      if (type === 'police') s.closed[r.stops[inc.k]] = inc.end;
      if (type === 'fire') { inc.d = r.stopD[inc.k]; }
      const st = this.net.stations[r.stops[inc.k]];
      inc.station = U.stationName(st.name);
      inc.label = `${T.name} ${type === 'breakdown' || type === 'sick' ? 'on the' : 'at'} ${type === 'breakdown' || type === 'sick' ? r.shortName : inc.station}`;
      inc.icon = T.icon;
      s.incidents.push(inc); s.stats.today.incidents++;
      s.sat = U.clamp(s.sat - (type === 'sick' ? 1 : 2.5), 0, 100);
      this.emit('incident', inc);
    }
    endIncident(inc) {
      const s = this.state;
      s.incidents = s.incidents.filter(i => i !== inc);
      if (inc.type === 'breakdown') { const t = s.trains.find(x => x.id === inc.train); if (t && t.state === 'broken') { t.state = 'run'; } }
      if (inc.type === 'police') delete s.closed[this.net.routeById[inc.route].stops[inc.k]];
      this.emit('incidentEnd', inc);
    }

    // ---------------- main loop ----------------
    advance(gameSeconds) {
      if (this.state.over) return;
      this.acc += gameSeconds;
      let n = 0;
      while (this.acc >= DT && n < 400) { this.acc -= DT; this.step(DT); n++; if (this.state.pending || this.state.over) { this.acc = 0; break; } }
    }

    step(dt) {
      const s = this.state, net = this.net;
      const prevHour = Math.floor(s.time / 3600);
      s.time += dt;
      const tod = this.tod(), dm = this.demandMult(), fare = this.farePaid();
      let waitingTotal = 0, spawnRate = 0, walk = 0, rejected = 0, revenue = 0, riders = 0;

      // 1) riders arrive and tap through the gates -> fare collected at the gate
      for (const r of net.routes) {
        const rs = s.routes[r.id]; if (!rs.active) continue;
        const hasTrains = this.routeTrains(r.id).length > 0;
        for (let k = 0; k < r.stops.length; k++) {
          const st = net.stations[r.stops[k]];
          const nAct = st.routes.reduce((a, ri) => a + (s.routes[net.routes[ri].id].active ? 1 : 0), 0) || 1;
          let lambda = hasTrains ? SPAWN * st.weight * tod * dm * (1 + 0.15 * (nAct - 1)) / nAct / 60 : 0; // riders per second
          if (this.stationClosed(st.idx)) lambda = 0;
          spawnRate += lambda;
          let w = rs.waiting[k];
          const arrive = lambda * dt;
          const cap = this.platformCap(st);
          const room = Math.max(0, cap - w);
          const enter = Math.min(arrive, room);
          rejected += arrive - enter;
          w += enter;
          const give = w * dt / (PATIENCE * (1 + 0.12 * this.upg('clocks')));
          w -= give; walk += give;
          rs.waiting[k] = w; waitingTotal += w;
          if (enter > 0) { revenue += enter * fare; riders += enter; this.taps[st.idx] += enter; }
        }
      }
      s.money += revenue; s.stats.revenue += revenue; s.stats.riders += riders;
      s.stats.today.revenue += revenue; s.stats.today.riders += riders; s.stats.today.walkouts += walk; s.stats.today.rejected += rejected;

      // 2) trains
      let loadSum = 0, loadN = 0, heldN = 0;
      for (const t of s.trains) {
        this.stepTrain(t, dt);
        const cap = C.MODEL[t.model].cap;
        if (t.state === 'run' || t.state === 'dwell') { loadSum += t.load / cap; loadN++; }
        if (t.state === 'broken' || t.held > 30) heldN++;
      }

      // 3) operating costs
      let opHr = 0;
      for (const t of s.trains) opHr += C.MODEL[t.model].op;
      opHr *= Math.max(0.3, 1 + this.mod('opcost'));
      for (const r of net.routes) if (s.routes[r.id].active) opHr += 150 + r.stops.length * 25;
      const cost = opHr * dt / 3600; s.money -= cost; s.stats.today.costs += cost;

      // 4) rolling metrics
      const a = Math.min(1, dt / 1200);
      const W = spawnRate > 1e-6 ? waitingTotal / spawnRate : 0; // Little's law: average wait (s)
      s.avgWait += (W - s.avgWait) * a;
      s.avgLoad += ((loadN ? loadSum / loadN : 0) - s.avgLoad) * a;
      s.walkRate += (walk / dt * 60 - s.walkRate) * a;
      s.rejectRate += (rejected / dt * 60 - s.rejectRate) * a;
      s.heldFrac = s.trains.length ? heldN / s.trains.length : 0;

      // 5) satisfaction drifts toward a target driven by service quality
      const comfort = s.trains.length ? s.trains.reduce((x, t) => x + C.MODEL[t.model].comfort, 0) / s.trains.length : 0;
      const waitMin = s.avgWait / 60;
      const waitPen = Math.min(32, Math.max(0, waitMin - 6) * 1.15 * (1 - 0.12 * this.upg('clocks')));
      const crowdPen = Math.min(15, Math.max(0, s.avgLoad - 0.85) * 60);
      const incPen = Math.min(18, s.incidents.length * 3);
      const heldPen = s.heldFrac * 25;
      const walkPen = Math.min(8, s.walkRate * 0.12);
      const rejPen = Math.min(10, s.rejectRate * 0.12);
      const upg = 3 * this.upg('clean') + 2 * this.upg('wifi') + 2 * this.upg('police') + 1.5 * this.upg('access');
      s.satParts = { comfort, upg, waitPen, crowdPen, incPen, heldPen, walkPen, rejPen, mod: this.mod('sat') };
      s.satTarget = U.clamp(this.activeLineCount() ? 64 + comfort + upg + this.mod('sat') - waitPen - crowdPen - incPen - heldPen - walkPen - rejPen : 55, 0, 100);
      s.sat = U.clamp(s.sat + (s.satTarget - s.sat) * a, 0, 100);
      s.stats.today.satSum += s.sat * dt; s.stats.today.satN += dt;

      // 6) incidents & modifiers expire / spawn
      for (const inc of s.incidents.slice()) if (s.time >= inc.end) this.endIncident(inc);
      s.mods = s.mods.filter(m => m.until > s.time);
      const lines = this.activeLineCount();
      if (lines && s.trains.length) {
        const avgRel = s.trains.reduce((x, t) => x + C.MODEL[t.model].rel, 0) / s.trains.length;
        const perHour = (0.04 * lines + 0.012 * s.trains.length) * (1 - 0.13 * this.upg('maint')) * Math.max(0, 1 + this.mod('incidents')) * (1.6 - avgRel);
        if (Math.random() < perHour * dt / 3600) this.spawnIncident();
      }

      // 7) hour / day bookkeeping
      const hourNow = Math.floor(s.time / 3600);
      if (hourNow !== prevHour) {
        s.stats.hourly.push({ t: hourNow, money: Math.round(s.money), rev: Math.round(s.stats.today.revenue), riders: Math.round(s.stats.riders), sat: Math.round(s.sat) });
        if (s.stats.hourly.length > 72) s.stats.hourly.shift();
        this.checkAchievements();
        this.emit('hour', hourNow % 24);
        if (hourNow % 24 === 0) this.endDay();
      }
      this.maybeEvent();
    }

    endDay() {
      const s = this.state, d = s.stats.today;
      const rep = { ...d, profit: d.revenue - d.costs, sat: d.satN ? d.satSum / d.satN : s.sat, money: s.money };
      s.stats.days.push({ day: d.day, riders: Math.round(d.riders), revenue: Math.round(d.revenue), costs: Math.round(d.costs), sat: Math.round(rep.sat) });
      if (s.stats.days.length > 60) s.stats.days.shift();
      s.day += 1; s.stats.today = this.blankDay(s.day);
      if (s.money < 0) s.negDays++; else s.negDays = 0;
      if (s.negDays >= 3 || s.money < -400000) { s.over = true; this.emit('gameover', rep); return; }
      this.emit('day', rep);
    }

    checkAchievements() {
      for (const a of C.ACHIEVEMENTS) if (!this.state.achievements[a.id] && a.test(this)) { this.state.achievements[a.id] = this.state.time; this.emit('achievement', a); }
    }

    // ---------------- train movement ----------------
    gapAhead(t, r) {
      // distance to the nearest obstacle ahead on the same route & direction (train or track fire)
      let best = Infinity;
      for (const o of this.state.trains) {
        if (o === t || o.route !== t.route || o.dir !== t.dir || o.state === 'layover' || o.state === 'turn') continue;
        const g = (o.d - t.d) * t.dir; if (g > 0 && g < best) best = g;
      }
      for (const inc of this.state.incidents) if (inc.type === 'fire' && inc.route === t.route) { const g = (inc.d - t.d) * t.dir; if (g > 0 && g + SAFE_GAP * 0.5 < best) best = g + SAFE_GAP * 0.5; }
      return best;
    }

    stepTrain(t, dt) {
      const s = this.state, r = this.net.routeById[t.route], rs = s.routes[t.route], m = C.MODEL[t.model];
      const last = r.stops.length - 1;
      if (t.state === 'broken') { t.held += dt; return; }
      if (t.state === 'dwell' || t.state === 'turn') {
        t.timer -= dt;
        if (t.timer <= 0) {
          if (t.state === 'turn') { t.dir = -t.dir; t.next = U.clamp(t.next + t.dir, 0, last); t.state = 'layover'; t.timer = 0; }
          else { t.state = 'run'; }
        }
        return;
      }
      if (t.state === 'layover') {
        // hold at the terminal to keep trains evenly spaced
        const n = this.routeTrains(t.route).length;
        const cycle = 2 * (r.len / (BASE_V * 0.62 * m.speed * this.speedMult(t.route))) + 2 * TURNAROUND;
        const headway = Math.max(90, cycle / Math.max(1, n));
        const key = String(t.dir);
        const k = t.dir > 0 ? 0 : last;
        if (Math.abs(t.d - r.stopD[k]) < 1 && s.time - rs.lastDep[key] < headway * 0.9) return;
        rs.lastDep[key] = s.time; t.state = 'dwell'; t.timer = 25; t.held = 0;
        // board riders at the terminal before leaving
        this.serveStop(t, r, rs, k, 'start');
        t.next = U.clamp(k + t.dir, 0, last);
        return;
      }
      // running
      const target = r.stopD[t.next];
      const dist = (target - t.d) * t.dir;
      const vmax = BASE_V * m.speed * this.speedMult(t.route);
      const vstop = Math.sqrt(2 * DECEL * Math.max(0, dist));
      const gap = this.gapAhead(t, r);
      const vblock = gap === Infinity ? Infinity : Math.sqrt(2 * DECEL * Math.max(0, gap - SAFE_GAP));
      const vt = Math.min(vmax, vstop, vblock);
      if (t.v < vt) t.v = Math.min(vt, t.v + ACCEL * dt); else t.v = Math.max(vt, t.v - DECEL * 2 * dt);
      if (vblock < 1 && gap < SAFE_GAP + 30) t.held += dt; else t.held = Math.max(0, t.held - dt);
      const move = t.v * dt;
      if (move >= dist - 0.5 || dist <= 0.5) {
        t.d = target; t.v = 0;
        const terminal = (t.dir > 0 && t.next === last) || (t.dir < 0 && t.next === 0);
        const dwell = this.serveStop(t, r, rs, t.next, terminal ? 'end' : 'stop');
        const sick = s.incidents.find(i => i.type === 'sick' && i.train === t.id);
        if (terminal) { t.state = 'turn'; t.timer = dwell + TURNAROUND; }
        else { t.state = 'dwell'; t.timer = dwell + (sick ? Math.max(0, sick.end - s.time) : 0); t.next += t.dir; }
      } else t.d += move * t.dir;
    }

    // mode: 'stop' (alight some, board), 'end' (terminal arrival: everyone off), 'start' (terminal departure: board only)
    serveStop(t, r, rs, k, mode) {
      const st = this.net.stations[r.stops[k]], m = C.MODEL[t.model];
      const alight = mode === 'end' ? t.load : mode === 'start' ? 0 : t.load * U.clamp(0.1 * Math.sqrt(st.weight), 0.05, 0.45);
      t.load -= alight; rs.delivered += alight;
      let board = 0;
      if (mode !== 'end' && !this.stationClosed(st.idx)) { board = Math.max(0, Math.min(rs.waiting[k], m.cap - t.load)); rs.waiting[k] -= board; t.load += board; }
      return U.clamp(18 + (alight + board) * (m.gangway ? 0.025 : 0.035), 18, 90);
    }

    flushTaps() {
      const out = [];
      for (let i = 0; i < this.taps.length; i++) if (this.taps[i] >= 1) { const n = Math.floor(this.taps[i]); out.push([i, n]); this.taps[i] -= n; }
      return out;
    }

    // ---------------- queries for UI ----------------
    lineStats(id) {
      const r = this.net.routeById[id], rs = this.state.routes[id], trains = this.routeTrains(id);
      const waiting = rs.waiting.reduce((a, b) => a + b, 0);
      const cap = trains.reduce((a, t) => a + C.MODEL[t.model].cap, 0);
      const load = trains.reduce((a, t) => a + t.load, 0);
      const cycle = 2 * (r.len / (BASE_V * 0.62 * this.speedMult(id))) + 2 * TURNAROUND;
      return { active: rs.active, trains: trains.length, waiting, load, cap, headway: trains.length ? cycle / trains.length / 2 : Infinity, incidents: this.state.incidents.filter(i => i.route === id).length };
    }
    stationWaiting(idx) {
      const st = this.net.stations[idx]; let w = 0;
      for (const ri of st.routes) { const r = this.net.routes[ri]; const rs = this.state.routes[r.id]; if (!rs.active) continue; const k = r.stops.indexOf(idx); if (k >= 0) w += rs.waiting[k]; }
      return w;
    }
    trainPos(t) { const r = this.net.routeById[t.route]; return r.line.at(t.d); }
    serialize() { const s = this.state; return JSON.parse(JSON.stringify(s)); }
  }
  ManagerSim.DT = DT; ManagerSim.INCIDENTS = INCIDENTS; ManagerSim.TOD = TOD;
  SC.ManagerSim = ManagerSim;
})(window.SC);
