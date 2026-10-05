// Conductor mode: drive a real MTA route in first person. Also powers Ride Along / Watch mode
// (autopilot) and the animated title-screen background.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const U = SC.util, UI = SC.ui, AU = SC.audio, net = SC.net, SP = SC.sprites;
  const POWER = [0.45, 0.85, 1.2], BRAKE = [0.45, 0.85, 1.3], EB = 2.4;
  const NOTCH_LABEL = { '-4': 'EB', '-3': 'B3', '-2': 'B2', '-1': 'B1', '0': 'C', '1': 'P1', '2': 'P2', '3': 'P3' };
  const OFF_PLATFORM = 8.5;
  const CHATTER = ['Finally!', 'Is this the express?', 'Ugh, rush hour…', 'Showtime!', '🍕', 'Hold the door!', 'Let me off first!', 'Stand clear!', 'Morning!', 'Late again…', 'Yo!', 'Is this Brooklyn?', '☕', 'Excuse me!', 'Move in, please!'];

  class ConductorGame {
    constructor(opts) {
      this.opts = opts;
      this.auto = !!opts.autopilot; this.demo = !!opts.demo; this.watch = !!opts.watch;
      this.track = SC.buildTrack({ routeId: opts.routeId, from: opts.from, count: opts.count, dir: opts.dir, seed: opts.seed || Math.floor(Math.random() * 1e6) });
      this.route = this.track.route; this.stations = this.track.stations;
      this.renderer = opts.renderer; this.side = opts.sideCanvas ? opts.sideCanvas.getContext('2d') : null;
      this.z = this.stations[0].zMarker; this.v = 0; this.a = 0; this.notch = -3; this.reverse = false;
      this.doors = 'open'; this.doorT = 0; this.phase = 'dwell'; this.dwellT = 0; this.si = 0; this.t = 0; this.clock = 0; this.started = false;
      this.hour = opts.hour ?? 8; this.speedMult = 1;
      this.score = 0; this.safety = 100; this.service = 100; this.comfort = 100; this.riders = 0;
      this.stats = { stops: 0, perfect: 0, great: 0, good: 0, errors: [], onTime: 0, late: 0, events: 0, trips: 0, overspeed: 0, skipped: 0, falls: 0 };
      this.people = []; this.opp = null; this.oppTimer = U.rand(20, 40);
      this.cupTilt = 0; this.cupVel = 0; this.coffee = 1; this.spill = 0; this.bob = 0; this.bobVel = 0;
      this.alerts = []; this.paused = false; this.over = false; this.hold = 0; this.holdReason = '';
      this.usedEvents = new Set(); this.flash = null;
      this.rain = !this.demo && Math.random() < 0.18;
      this.setupRun();
      this.spawnPeople(this.stations[0], true);
      this.startBoarding(this.stations[0], true);
    }

    // ---------------- setup ----------------
    setupRun() {
      const T = this.track, rand = U.rng(U.hash(this.route.id + ':' + this.opts.from));
      // schedule: dwell + run time per segment
      this.sched = [0]; let tt = 0;
      for (let i = 1; i < this.stations.length; i++) { const G = this.stations[i].zMarker - this.stations[i - 1].zMarker; tt += 28 + G / 11.5 + 14; this.sched.push(Math.round(tt)); }
      // signal holds (train traffic ahead) and track-worker flagging zones
      this.holds = []; this.flags = [];
      for (let i = 0; i < this.stations.length - 1; i++) {
        const a = this.stations[i].zEnd + 60, b = this.stations[i + 1].zStart - 80;
        const sigs = T.signals.filter(s => !s.gt && s.z > a && s.z < b);
        if (!this.demo && sigs.length && rand() < 0.3) this.holds.push({ sig: sigs[Math.floor(sigs.length / 2)], armed: false, release: 0, done: false, span: i });
        if (!this.demo && b - a > 360 && rand() < 0.25) {
          const z0 = (a + b) / 2 - 20, z1 = z0 + 70; const f = { z0, z1, honked: false, sped: false, i };
          this.flags.push(f);
          const seg = (z) => Math.floor(z / T.SEG); const out = T.outdoor(T.env[seg(z0)]); const Lw = out ? 2.4 : 2.1;
          const add = (z, sp) => { const i2 = seg(z); (T.sprites[i2] = T.sprites[i2] || []).push(sp); };
          add(z0 - 120, { k: 'lantern', L: Lw, h: 1.0, lamp: 'Y' });
          add(z0 - 90, { k: 'flagger', L: Lw + 0.1, h: 0.0, lamp: 'Y', seed: 11 });
          add(z0 + 15, { k: 'flagger', L: Lw + 0.1, h: 0.0, lamp: 'Y', seed: 23 });
          add(z0 + 40, { k: 'flagger', L: Lw + 0.1, h: 0.0, lamp: 'Y', seed: 37 });
          add(z1 + 12, { k: 'lantern', L: Lw, h: 1.0, lamp: 'G' });
        }
      }
    }

    // ---------------- people ----------------
    spawnPeople(st, first) {
      if (st.spawned) return; st.spawned = true;
      const h = this.hour % 24; const rush = (h >= 7 && h < 10) || (h >= 16.5 && h < 19.5); const night = h < 5.5 || h >= 22;
      const n = Math.round((rush ? 30 : night ? 7 : 16) * U.rand(0.8, 1.2) * (st.terminal && !first ? 0.4 : 1));
      const maxL = st.under ? 7.3 : 5.4; const rand = Math.random;
      for (let q = 0; q < n; q++) {
        this.people.push({ st: st.i, z: U.lerp(st.zStart + 6, st.zEnd - 4, rand()), L: U.lerp(2.5, maxL, rand()), p: SP.makePerson(rand), state: 'wait', walk: 0, alpha: 1, sp: U.rand(1.1, 1.7), bubble: null, bt: 0 });
      }
      // a couple of them chat when the train pulls in
      setTimeout(() => { for (const p of this.people) if (p.st === st.i && Math.random() < 0.12) { p.bubble = U.pick(CHATTER); p.bt = U.rand(2, 4); } }, 10);
    }
    doorPositions(st) {
      const out = []; const z0 = this.z - this.track.TRAIN_LEN;
      for (let c = 0; c < 10; c++) for (const o of [3.6, 9.15, 14.7]) { const dz = z0 + c * 18.3 + o; if (dz > st.zStart + 0.5 && dz < st.zEnd - 0.5) out.push(dz); }
      return out;
    }
    startBoarding(st, first) {
      const doors = this.doorPositions(st); if (!doors.length) return;
      this.boarding = { st: st.i, t: 0, boarded: 0, alighted: 0 };
      for (const p of this.people) {
        if (p.st !== st.i || p.state !== 'wait') continue;
        if (Math.random() < 0.88) { let best = doors[0]; for (const d of doors) if (Math.abs(d - p.z) < Math.abs(best - p.z)) best = d; p.state = 'board'; p.tz = best + U.rand(-0.5, 0.5); p.tL = 1.6; }
      }
      if (!first) {
        const n = Math.round(Math.min(this.riders, U.rand(4, 12) * (st.terminal ? 2 : 1)));
        for (let q = 0; q < n; q++) { const d = U.pick(doors); this.people.push({ st: st.i, z: d, L: 1.6, p: SP.makePerson(), state: 'exit', tz: d + U.rand(-3, 3), tL: U.rand(3.5, st.under ? 7 : 5), walk: 1, alpha: 1, sp: U.rand(1.2, 1.7), delay: q * 0.25 }); }
        this.riders = Math.max(0, this.riders - n); this.boarding.alighted = n;
      }
    }
    updatePeople(dt) {
      const st = this.stations[this.si];
      for (const p of this.people) {
        if (p.bt > 0) { p.bt -= dt; if (p.bt <= 0) p.bubble = null; }
        if (p.delay > 0) { p.delay -= dt; p.alpha = 0; continue; } else if (p.state === 'exit') p.alpha = 1;
        if (p.state === 'board' || p.state === 'exit' || p.state === 'leave') {
          const doorsOpen = this.doors === 'open';
          if (p.state === 'board' && !doorsOpen) { p.walk = 0; continue; }
          const dz = p.tz - p.z, dL = p.tL - p.L; const d = Math.hypot(dz, dL);
          if (d < 0.15) {
            if (p.state === 'board') { p.state = 'gone'; this.riders++; if (this.boarding) this.boarding.boarded++; }
            else if (p.state === 'exit') { p.state = 'leave'; const s2 = this.stations[p.st]; p.tz = Math.random() < 0.5 ? s2.zStart + 12 : s2.zEnd - 12; p.tL = p.L; }
            else if (p.state === 'leave') p.state = 'gone';
            continue;
          }
          const sp = Math.min(d, p.sp * dt); p.z += dz / d * sp; p.L += dL / d * sp; p.walk = 1;
          if (p.state === 'leave') p.alpha = Math.max(0, p.alpha - dt * 0.12);
        } else p.walk = 0;
      }
      this.people = this.people.filter(p => p.state !== 'gone' && p.alpha > 0.02 && p.z > this.z - 420 - this.track.TRAIN_LEN);
      if (this.boarding) this.boarding.t += dt;
      // spawn crowds ahead
      for (const s of this.stations) if (!s.spawned && this.z > s.zStart - 700) this.spawnPeople(s);
    }
    boardingDone() { return !this.people.some(p => p.state === 'board' && p.st === this.si) || (this.boarding && this.boarding.t > 30); }

    // ---------------- controls ----------------
    setNotch(n) { if (this.over || this.paused) return; const prev = this.notch; this.notch = U.clamp(n, -4, 3); if (this.notch !== prev) AU.click(); if (this.tripped && this.notch > -4 && this.v > 0.1) this.notch = -4; }
    notchUp() { this.setNotch(this.notch + 1); }
    notchDown() { this.setNotch(this.notch - 1); }
    emergency() { this.setNotch(-4); this.say('EMERGENCY BRAKE', 'bad'); AU.trip(); }
    horn() { AU.horn(); this.hornT = 1.2; for (const f of this.flags) if (!f.honked && this.z > f.z0 - 180 && this.z < f.z0 + 10) { f.honked = true; this.addScore(50, 'Workers acknowledged 👷'); } }
    toggleReverse() { if (Math.abs(this.v) > 0.05) return this.say('Stop first to change direction', 'warn'); if (this.doors !== 'closed') return this.say('Close the doors first', 'warn'); this.reverse = !this.reverse; AU.click(); this.say(this.reverse ? 'REVERSE — creep back slowly' : 'FORWARD', this.reverse ? 'warn' : 'info'); if (this.reverse) this.addScore(-30, 'Back-up move (-30)'); }
    openDoors(force) {
      if (this.over || this.paused) return;
      if (this.doors !== 'closed') return;
      if (Math.abs(this.v) > 0.05) return this.say('Stop the train before opening doors!', 'bad');
      const st = this.stations[this.si];
      if (this.phase === 'ready' || this.phase === 'dwell') return;
      if (!st || this.phase !== 'berthed') return this.say('No platform here — stop at the station first!', 'bad');
      const err = this.z - st.zMarker;
      if (Math.abs(err) > OFF_PLATFORM && !force && !this.offWarned) { this.offWarned = true; AU.alarm(); return this.say(`DOORS OFF THE PLATFORM! ${err > 0 ? 'Back up' : 'Pull up'} ${Math.abs(err * 3.28).toFixed(0)} ft — or press Open again to risk it`, 'bad', 4); }
      this.doors = 'opening'; this.doorT = 0; AU.doors(); this.offWarned = false;
      this.phase = 'dwell'; this.dwellT = 0; this.paSaid = false; this.zebraDone = this.zebraDone || false;
      this.scoreBerth(st, err);
      if (Math.abs(err) > OFF_PLATFORM) this.fallIncident(st);
    }
    closeDoors() {
      if (this.over || this.paused || this.doors !== 'open') return;
      if (this.hold > 0) return this.say(`Hold on — ${this.holdReason} (${Math.ceil(this.hold)}s)`, 'warn');
      const st = this.stations[this.si];
      const blocking = this.people.some(p => p.state === 'board' && p.st === this.si && Math.abs(p.tz - p.z) < 2.5 && p.L < 2.6);
      if (blocking) { this.addScore(-60, 'Door obstruction! (-60)'); this.service = Math.max(0, this.service - 3); AU.thud(); this.doorBounce = 2.2; return this.say('Someone is in the doorway! Doors bounced back open.', 'bad'); }
      if (!this.paSaid && !this.auto) this.addScore(-10, 'Tip: announce (P) before closing');
      AU.chime(); if (!this.paSaid) this.speak('Stand clear of the closing doors, please.');
      this.doors = 'closing'; this.doorT = 0; this.boarding = null;
      for (const p of this.people) if (p.state === 'board' && p.st === this.si) { p.state = 'wait'; p.walk = 0; }
      if (st && this.si === this.stations.length - 1) this.finish();
    }
    announce() {
      if (this.over || this.paused) return; AU.click();
      const st = this.stations[this.si];
      if (this.doors === 'open') { if (!this.paSaid) { this.paSaid = true; this.addScore(25, 'Announcement +25'); } AU.chime(); this.speak('Stand clear of the closing doors, please.'); return; }
      const next = this.phase === 'run' ? st : this.stations[this.si + 1];
      if (next) this.speak(`This is a ${this.track.stations[0].bound.replace(/&/g, 'and')} ${this.route.shortName}. The next stop is ${next.name}.`);
    }
    pointZebra() {
      if (this.over || this.paused) return; const st = this.stations[this.si];
      if (!st || (this.phase !== 'berthed' && this.phase !== 'dwell') || Math.abs(this.v) > 0.05) return this.say('Point at the zebra board when stopped at a platform', 'warn');
      if (this.zebraDone) return;
      this.zebraDone = true; const err = (this.z - this.track.TRAIN_LEN / 2) - st.zZebra; this.pointT = 1.2;
      if (Math.abs(err) < 2.5) { this.addScore(50, 'Zebra board confirmed ✔ +50'); AU.success(); } else { this.addScore(-20, `Not on the zebra board (${(err * 3.28).toFixed(0)} ft)`); AU.fail(); }
    }

    speak(text, opts) { if (!this.demo) AU.speak(text, opts); }

    // ---------------- scoring ----------------
    addScore(n, label) { this.score += n; if (label) this.say(label, n >= 0 ? 'good' : 'bad', 2.2); }
    say(text, cls = 'info', dur = 2.6) { this.alerts.push({ text, cls, t: dur }); if (this.alerts.length > 3) this.alerts.shift(); }
    scoreBerth(st, err) {
      if (st.scored) return; st.scored = true; const e = Math.abs(err); this.stats.stops++; this.stats.errors.push(e);
      if (e < 1) { this.stats.perfect++; this.addScore(300, 'PERFECT STOP! +300'); AU.success(); this.flashT = 0.4; }
      else if (e < 3) { this.stats.great++; this.addScore(200, `GREAT STOP — ${(e * 3.28).toFixed(1)} ft off  +200`); AU.coin(); }
      else if (e < 6) { this.stats.good++; this.addScore(120, `Good stop — ${(e * 3.28).toFixed(0)} ft off  +120`); }
      else if (e <= OFF_PLATFORM) this.addScore(60, `Sloppy stop — ${(e * 3.28).toFixed(0)} ft off  +60`);
    }
    fallIncident(st) {
      this.stats.falls++; this.safety = Math.max(0, this.safety - 30); this.addScore(-600, 'A rider stepped into the gap! (-600)');
      AU.alarm(); this.hold = 60; this.holdReason = 'EMS is helping a rider out of the gap';
      if (!this.auto) setTimeout(() => this.modal(() => UI.alert({ icon: '🚑', title: 'Rider in the Gap!', html: `<p>You opened the doors <b>off the platform</b>. A rider stepped out into thin air and fell onto the roadbed.</p><p>Power was cut, EMS pulled them out with a sprained ankle and a great story — but your train is held for a minute and Rail Control wants a word.</p><p class="tip">Always line the cab up with the black <b>"10" car stop marker</b> before opening the doors.</p>`, button: 'Understood' })), 400);
    }
    checkArrival() {
      const st = this.stations[this.si]; if (st.arrived) return; st.arrived = true;
      const delta = this.clock - this.sched[this.si];
      if (delta <= 20) { this.stats.onTime++; this.addScore(100, `On time! (${delta <= 0 ? Math.round(-delta) + 's early' : Math.round(delta) + 's'})  +100`); }
      else if (delta <= 60) { this.stats.onTime++; this.addScore(40, `Slightly late (+${Math.round(delta)}s)  +40`); }
      else { this.stats.late++; this.addScore(-Math.min(200, Math.round((delta - 60) * 2)), `Running late (+${Math.round(delta)}s)`); }
    }

    // ---------------- per-frame update ----------------
    update(dtReal) {
      if (this.paused || this.over) return;
      const dt = Math.min(0.05, dtReal) * this.speedMult;
      const sub = this.speedMult > 1 ? Math.ceil(this.speedMult) : 1;
      for (let q = 0; q < sub; q++) this.step(dt / sub);
    }
    step(dt) {
      this.t += dt; const T = this.track;
      if (this.started) this.clock += dt;
      this.hour = ((this.opts.hour ?? 8) + this.t / 3600) % 24;
      if (this.auto) this.autopilot(dt);
      // doors
      if (this.doors === 'opening') { this.doorT += dt; if (this.doorT > 1.2) { this.doors = 'open'; this.onDoorsOpen(); } }
      else if (this.doors === 'closing') { this.doorT += dt; if (this.doorT > 1.6) { this.doors = 'closed'; if (this.phase === 'dwell') this.phase = 'ready'; } }
      if (this.doorBounce > 0) this.doorBounce -= dt;
      if (this.hold > 0) this.hold -= dt;
      if (this.doors === 'open') this.dwellT += dt;
      // physics
      let a = 0; const n = this.notch; const doorsShut = this.doors === 'closed';
      if (n > 0 && doorsShut && !this.tripped) a = POWER[n - 1] * Math.pow(Math.max(0.05, 1 - this.v / 24), 0.6) * (this.reverse ? 0.35 : 1);
      else if (n < 0) a = -(n === -4 ? EB : BRAKE[-n - 1]);
      else a = -0.03 - 0.0012 * this.v * this.v;
      if (!doorsShut) a = Math.min(a, -1);
      a -= 9.81 * T.slopeAt(this.z) * 0.35 * (this.v > 0.05 || n > 0 ? 1 : 0);
      if (this.reverse && this.v > 1.6) a = Math.min(a, -0.5);
      if (this.v <= 0.001 && a < 0) a = 0;
      // traction & brakes are jerk-limited like a real car (emergency brake bites much faster)
      const J = n === -4 ? 7 : 1.8; const prevA = this.a;
      this.a += U.clamp(a - this.a, -J * dt, J * dt);
      this.v = Math.max(0, this.v + this.a * dt);
      if (this.v === 0 && this.a < 0) this.a = 0;
      const prevZ = this.z; this.z += this.v * dt * (this.reverse ? -1 : 1);
      if (this.v > 0.3 && !this.started) this.started = true;
      // wheels clacking over rail joints
      this.clackAcc = (this.clackAcc || 0) + this.v * dt; if (this.clackAcc > 18) { this.clackAcc = 0; if (this.v > 2) AU.clack(Math.min(0.2, this.v * 0.01)); }
      // comfort: coffee cup sloshes with jerk
      const jerk = Math.abs(this.a - prevA) / Math.max(dt, 1e-3);
      this.cupVel += (-this.a * 0.32 - this.cupTilt * 22 - this.cupVel * 3.2) * dt; this.cupTilt += this.cupVel * dt;
      this.bobVel += (-this.a * 1.6 - this.bob * 40 - this.bobVel * 2.2) * dt; this.bob += this.bobVel * dt;
      if (this.spill > 0) this.spill -= dt * 1.5;
      if (Math.abs(this.cupTilt) > 0.32 && this.coffee > 0.15 && this.spillCool <= 0) { this.coffee -= 0.12; this.spill = 1; this.comfort = Math.max(0, this.comfort - 6); this.say('☕ Coffee spilled! Smoother, please', 'bad'); this.spillCool = 2; }
      this.spillCool = (this.spillCool || 0) - dt;
      if (this.v > 0.5 && (Math.abs(this.a) > 1.25 || jerk > 3)) this.comfort = Math.max(0, this.comfort - dt * (n === -4 ? 9 : 3));
      // signals
      this.updateSignals(dt, prevZ);
      // speed limits & flagging
      let limit = T.limitAt(this.z); const flag = this.flags.find(f => this.z > f.z0 - 5 && this.z < f.z1 + 5);
      if (flag) { limit = Math.min(limit, 4.6); if (this.v > 5.6 && !flag.sped) { flag.sped = true; this.safety = Math.max(0, this.safety - 12); this.addScore(-200, 'Too fast through the work zone! (-200)'); AU.alarm(); } }
      this.limit = limit;
      if (this.v > limit + 1.35) { this.overT = (this.overT || 0) + dt; this.score -= 12 * dt; this.stats.overspeed += dt; if (this.overT > 0.6 && !this.overWarned) { this.overWarned = true; this.say(`OVERSPEED — limit ${Math.round(U.mph(limit))} mph`, 'bad'); AU.alarm(); } }
      else { this.overT = 0; this.overWarned = false; }
      // station logic
      this.updateStations(dt);
      this.updatePeople(dt);
      this.updateOpp(dt);
      // alerts decay
      for (const al of this.alerts) al.t -= dt; this.alerts = this.alerts.filter(al => al.t > 0);
      if (this.flashT > 0) this.flashT -= dt;
      if (this.pointT > 0) this.pointT -= dt;
      if (this.hornT > 0) this.hornT -= dt;
      AU.updateLoops(this.v, n > 0 && doorsShut ? n / 3 : 0, n < 0 ? -n / 4 : 0, !T.outdoor(T.envAt(this.z)));
    }

    updateSignals(dt, prevZ) {
      const T = this.track;
      // automatic block holds: a train ahead turns a signal red for a little while
      for (const h of this.holds) {
        if (h.done) continue; const s = h.sig;
        if (!h.armed && this.si === h.span + 1 && this.phase === 'run' && this.z > this.stations[h.span].zEnd) { h.armed = true; s.state = 'R'; const prev = T.signals.filter(x => x.z < s.z - 20 && x.z > this.z).pop(); if (prev) { prev.state = 'Y'; h.prev = prev; } h.release = U.rand(9, 18); }
        if (h.armed && s.z - this.z < 220) { h.release -= dt; if (this.v < 0.1 && !h.saidDelay && !this.demo) { h.saidDelay = true; this.speak('Ladies and gentlemen, we are delayed because of train traffic ahead of us. We should be moving shortly. Thank you for your patience.'); } }
        if (h.armed && h.release <= 0) { s.state = 'G'; if (h.prev) h.prev.state = 'G'; h.done = true; }
      }
      // grade-time signals: overspeed on approach turns them red
      for (const s of T.signals) {
        if (s.gt) { const d = s.z - this.z; if (d > 0 && d < 260) s.state = this.v > s.limit + 0.9 ? 'R' : (s.state === 'R' && this.v > 0.5 ? 'R' : 'G'); else if (d < -200) s.state = 'G'; }
        if (prevZ < s.z && this.z >= s.z && s.state === 'R') this.trip(s);
      }
    }
    trip(s) {
      this.tripped = true; this.notch = -4; this.safety = Math.max(0, this.safety - 20); this.addScore(-400, s.gt ? 'TRIPPED by a timer signal — too fast! (-400)' : 'RAN A RED SIGNAL — tripped! (-400)'); AU.trip(); this.flash = 'rgba(255,0,0,.25)'; setTimeout(() => this.flash = null, 300);
      s.state = 'G';
    }

    updateStations(dt) {
      const st = this.stations[this.si]; if (!st) return;
      if (this.tripped && this.v < 0.05) { this.tripped = false; this.say('Trip arm reset — key the brake and carry on', 'warn'); }
      if (this.phase === 'ready' && this.z > st.zEnd + 4) {
        // departed
        this.si++; this.phase = 'run'; this.zebraDone = false; this.offWarned = false;
        const next = this.stations[this.si]; if (!next) return this.finish();
        this.speak(`This is a ${st.bound.replace(/&/g, 'and')} ${this.route.shortName}. The next stop is ${next.name}.${next.transfers.length ? ' Transfer is available to the ' + next.transfers.slice(0, 4).map(r => r.label).join(', ') + ' train.' : ''}`, { interrupt: false });
        return;
      }
      if (this.phase === 'run' || this.phase === 'berthed') {
        const err = this.z - st.zMarker;
        if (this.v < 0.02 && Math.abs(err) < 45 && this.doors === 'closed') {
          if (this.phase === 'run') { this.phase = 'berthed'; this.checkArrival(); if (!this.auto) this.speak(`This is ${st.name}.`, { interrupt: false }); }
        } else if (this.phase === 'berthed' && this.v > 0.05) this.phase = 'run';
        if (err > 50 && this.phase === 'run') {
          this.stats.skipped++; this.service = Math.max(0, this.service - 15); this.addScore(-300, `You blew through ${U.stationName(st.name)}! (-300)`); AU.fail();
          st.arrived = true; st.scored = true; this.si++; if (!this.stations[this.si]) this.finish();
        }
      }
    }

    onDoorsOpen() {
      const st = this.stations[this.si];
      if (this.si > 0) this.startBoarding(st);
      if (this.si === this.stations.length - 1) { this.hold = Math.max(this.hold, 4); this.holdReason = 'everyone is getting off'; }
      // a station event?
      if (this.si > 0 && !this.demo && Math.random() < 0.42 && this.si < this.stations.length - 1) {
        const pool = SC.STOP_EVENTS.filter(e => !this.usedEvents.has(e.id)); if (!pool.length) return;
        const ev = U.pick(pool); this.usedEvents.add(ev.id); this.stats.events++;
        const apply = (k) => {
          const fx = ev[k].fx; this.addScore(fx.score || 0); this.safety = U.clamp(this.safety + (fx.safety || 0), 0, 100); this.service = U.clamp(this.service + (fx.service || 0), 0, 100); this.comfort = U.clamp(this.comfort + (fx.comfort || 0), 0, 100);
          if (fx.delay) { this.hold = Math.max(this.hold, fx.delay); this.holdReason = ev.title.toLowerCase(); }
          if (fx.horn) AU.horn(); if (fx.pa) this.speak(fx.pa);
          if (fx.msg) UI.toast(`<b>${ev.icon} ${U.esc(ev.title)}</b><br>${U.esc(fx.msg)}${fx.score ? ` <b>${fx.score > 0 ? '+' : ''}${fx.score}</b>` : ''}`, (fx.score || 0) >= 0 ? 'good' : 'bad', 4200);
        };
        if (this.auto) { setTimeout(() => apply(Math.random() < 0.6 ? 'a' : 'b'), 800); return; }
        setTimeout(() => this.modal(() => UI.choice({ icon: ev.icon, kicker: `${U.stationName(st.name)} · ${this.route.shortName}`, title: ev.title, text: U.esc(ev.text(U.stationName(st.name))), a: ev.a, b: ev.b }).then(apply)), 700);
      }
    }
    modal(fn) { if (this.over) return; this.paused = true; AU.updateLoops(0, 0, 0, false); return Promise.resolve(fn()).then(r => { this.paused = false; return r; }); }

    updateOpp(dt) {
      const T = this.track;
      if (this.opp) { this.opp.z -= this.opp.v * dt; if (!this.opp.whoosh && this.opp.z < this.z + 25) { this.opp.whoosh = true; AU.whoosh(); } if (this.opp.z + this.opp.len < this.z - 30) this.opp = null; return; }
      this.oppTimer -= dt;
      if (this.oppTimer <= 0 && this.v > 3 && this.phase === 'run') {
        this.oppTimer = U.rand(35, 80);
        const zs = this.z + 420; const e = T.envAt(zs); if (T.stn[Math.floor(zs / T.SEG)] >= 0 || e === 4) return;
        const r = this.route; this.opp = { z: zs, len: 183, v: U.rand(9, 15), route: r };
      }
    }

    // ---------------- autopilot (Ride Along / watch / title demo) ----------------
    autopilot(dt) {
      const T = this.track; const st = this.stations[this.si];
      this.apT = (this.apT || 0) + dt;
      if (this.phase === 'dwell') {
        if (this.doors === 'open' && this.dwellT > 4 && this.boardingDone() && this.hold <= 0 && this.dwellT > (this.si === 0 ? 3 : 8)) { this.paSaid = true; this.closeDoors(); }
        this.notch = -3; return;
      }
      if (this.phase === 'ready') { if (this.doors === 'closed') this.notch = 3; return; }
      if (this.phase === 'berthed') { this.notch = -3; if (this.v < 0.02) { this.berthT = (this.berthT || 0) + dt; if (this.berthT > 1.2) { this.berthT = 0; this.openDoors(true); } } return; }
      if (!st) return;
      // target speed: limits ahead, the next stop, red signals
      let vd = 30;
      for (let d = 0; d <= 260; d += 10) { const lim = T.limitAt(this.z + d); vd = Math.min(vd, Math.sqrt(lim * lim + 2 * 0.75 * d)); }
      for (const f of this.flags) { if (this.z < f.z1 + 5) { const d = Math.max(0, f.z0 - 8 - this.z); vd = Math.min(vd, Math.sqrt(4.2 * 4.2 + 2 * 0.75 * d)); if (!f.honked && f.z0 - this.z < 150 && f.z0 - this.z > 0) this.horn(); } }
      const toStop = st.zMarker - this.z; vd = Math.min(vd, Math.sqrt(2 * 0.75 * Math.max(0, toStop - 0.15 - this.v * 0.45)));
      for (const s of T.signals) if (s.state === 'R' && s.z > this.z) { vd = Math.min(vd, Math.sqrt(2 * 0.75 * Math.max(0, s.z - 12 - this.z - this.v * 0.45))); break; }
      if (toStop < 0.8 && this.v < 1.2) { this.v = 0; this.a = 0; this.z = st.zMarker + U.rand(-0.15, 0.15) * (this.demo ? 0 : 1); this.notch = -3; return; }
      const ad = U.clamp((vd - this.v) * 1.3, -1.3, 1.2);
      this.notch = ad > 0.65 ? 3 : ad > 0.35 ? 2 : ad > 0.06 ? 1 : ad > -0.12 ? 0 : ad > -0.55 ? -1 : ad > -0.95 ? -2 : -3;
    }

    // ---------------- end of shift ----------------
    finish() {
      if (this.over) return; this.over = true; AU.updateLoops(0, 0, 0, false);
      const s = this.stats; const avgErr = s.errors.length ? s.errors.reduce((a, b) => a + b, 0) / s.errors.length : 0;
      const stopPart = s.stops ? (s.perfect * 100 + s.great * 80 + s.good * 60) / s.stops : 0;
      const ontimePart = (s.onTime / Math.max(1, s.onTime + s.late)) * 100;
      const total = 0.3 * stopPart + 0.2 * ontimePart + 0.2 * this.safety + 0.15 * this.comfort + 0.15 * this.service - s.skipped * 10 - s.falls * 15;
      const grade = total >= 92 ? 'A+' : total >= 85 ? 'A' : total >= 78 ? 'B+' : total >= 70 ? 'B' : total >= 60 ? 'C' : total >= 50 ? 'D' : 'F';
      const pay = Math.max(40, Math.round(28 * (this.stations.length - 1) + Math.max(0, this.score) * 0.12));
      this.report = { grade, total: Math.round(total), score: Math.round(this.score), pay, avgErr, ...s, safety: Math.round(this.safety), comfort: Math.round(this.comfort), service: Math.round(this.service), riders: this.riders, route: this.route, from: this.stations[0].name, to: this.stations[this.stations.length - 1].name };
      if (this.opts.onEnd) setTimeout(() => this.opts.onEnd(this.report), 900);
    }

    // ---------------- rendering ----------------
    render() {
      if (!this.renderer) return;
      const st = this.stations[this.si];
      const mid = this.z - this.track.TRAIN_LEN / 2; const sideStation = st && (this.phase !== 'run' || mid > st.zStart - 25) && mid < st.zEnd + 25 ? st : null;
      const g = {
        track: this.track, z: this.z, v: this.v, t: this.t, hour: this.hour, people: this.people, opp: this.opp, dashH: this.opts.dashH ? this.opts.dashH() : 0,
        route: this.route, bobble: this.bob, cupTilt: this.cupTilt, coffee: this.coffee, spill: this.spill, showCab: this.opts.showCab !== false, rain: this.rain,
        flash: this.flash || (this.flashT > 0 ? `rgba(255,255,200,${this.flashT * 0.4})` : null), sideStation,
      };
      this.renderer.render(g);
      if (this.side) { const c = this.side.canvas; this.renderer.drawSideWindow(this.side, c.width, c.height, g); }
      this.sideStation = sideStation;
    }
  }
  ConductorGame.NOTCH_LABEL = NOTCH_LABEL; ConductorGame.OFF_PLATFORM = OFF_PLATFORM;
  SC.ConductorGame = ConductorGame;
})(window.SC);
