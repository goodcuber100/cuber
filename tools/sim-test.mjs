#!/usr/bin/env node
// Headless balance check for MTA Manager: runs the real simulation code with a simple
// "greedy manager" policy and prints the economy over several game days.
//   node tools/sim-test.mjs [days=5] [policy=greedy|idle]
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { window: {}, console, Math, JSON, Date, localStorage: undefined };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['js/data/nyc-data.js', 'js/core/util.js', 'js/core/net.js', 'js/manager/content.js', 'js/manager/sim.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const SC = ctx.SC;
const days = +(process.argv[2] || 5), policy = process.argv[3] || 'greedy';
const sim = new SC.ManagerSim();
const C = SC.content;
let events = 0, incidents = 0;
sim.on('decision', () => { events++; sim.resolveEvent(Math.random() < 0.5 ? 'a' : 'b'); });
sim.on('incident', () => incidents++);
sim.on('gameover', () => console.log('GAME OVER'));

const first = sim.buyTrain('6'); if (!first.ok) throw new Error(first.msg);
const fmt = n => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString();
console.log('day  hour   money        sat  wait(min) load  lines trains riders/day  revenue/day');
for (let h = 0; h < days * 24; h++) {
  for (let i = 0; i < 1800; i++) sim.advance(2);
  const s = sim.state;
  if (policy === 'greedy') {
    // unlock next model when rich, otherwise add trains where waits are worst, otherwise open lines
    const nextModel = C.MODELS.find(m => !s.unlocked.includes(m.id));
    if (nextModel && s.money > nextModel.unlock * 1.6 && s.trains.length > 6) sim.unlockModel(nextModel.id);
    const price = C.MODEL[s.model].price;
    const cheapest = C.UPGRADES.filter(u => s.upgrades[u.key] < u.max).map(u => ({ u, c: C.upgradeCost(u, s.upgrades[u.key]) })).sort((a, b) => a.c - b.c)[0];
    if (cheapest && s.money > cheapest.c * 3 && s.trains.length > 4) sim.buyUpgrade(cheapest.u.key);
    if (s.money > price * 1.4) {
      const act = sim.net.routes.filter(r => s.routes[r.id].active);
      const worst = act.map(r => ({ r, st: sim.lineStats(r.id) })).sort((a, b) => b.st.waiting / (b.st.trains + 1) - a.st.waiting / (a.st.trains + 1))[0];
      if (worst && worst.st.trains < Math.max(2, worst.r.stops.length / 5)) sim.buyTrain(worst.r.id);
      else {
        const next = sim.net.routes.filter(r => !s.routes[r.id].active).sort((a, b) => b.stops.length - a.stops.length)[0];
        if (next && s.money > sim.lineActivationCost(next) + price * 1.2) sim.buyTrain(next.id);
      }
    }
  }
  if ((h + 1) % 6 === 0) {
    const d = s.stats.days[s.stats.days.length - 1];
    console.log(`${String(s.day).padStart(3)}  ${String(Math.floor(sim.hour())).padStart(4)}  ${fmt(s.money).padStart(12)}  ${s.sat.toFixed(0).padStart(4)}  ${(s.avgWait / 60).toFixed(1).padStart(8)}  ${s.avgLoad.toFixed(2)}  ${String(sim.activeLineCount()).padStart(5)}  ${String(s.trains.length).padStart(6)}  ${d ? String(d.riders).padStart(10) : ''.padStart(10)}  ${d ? fmt(d.revenue).padStart(11) : ''}`);
  }
}
console.log(`events: ${events}, incidents: ${incidents}, upgrades: ${JSON.stringify(sim.state.upgrades)}, unlocked: ${sim.state.unlocked.join(',')}`);
