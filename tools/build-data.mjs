#!/usr/bin/env node
// Builds js/data/nyc-data.js from official MTA open data + OpenStreetMap land polygons.
//
//   node tools/build-data.mjs --gtfs <dir with GTFS json> --stations <stations.json> \
//        --land <lands.geo.json> --nybb <dir with nybb.shp/.dbf>
//
// See tools/fetch-data.sh for how to download the inputs. The output is a plain
// script (not JSON) so the game can be opened straight from disk via file://.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? acc.concat([[a.slice(2), arr[i + 1]]]) : acc), [])
);
for (const k of ['gtfs', 'stations', 'land', 'nybb']) {
  if (!args[k]) { console.error(`missing --${k}`); process.exit(1); }
}
const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = args.out || path.join(here, '..', 'js', 'data', 'nyc-data.js');

// ---------- projection: local equirectangular, metres, y grows southward ----------
const LAT0 = 40.72, LON0 = -73.93;
const KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
const KY = 110574;
const px = lon => (lon - LON0) * KX;
const py = lat => (LAT0 - lat) * KY;

const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const G = f => readJSON(path.join(args.gtfs, f));

// ---------- geometry helpers ----------
function dpSimplify(pts, tol) { // pts: [[x,y],...]
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]]; const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bd = t2;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i];
      let t = ((x - ax) * dx + (y - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - x, ey = ay + t * dy - y, d = ex * ex + ey * ey;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function ringArea(r) { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(s / 2); }
function clipRing(ring, box) { // Sutherland–Hodgman against axis-aligned box
  const edges = [
    [p => p[0] >= box.x0, (a, b) => { const t = (box.x0 - a[0]) / (b[0] - a[0]); return [box.x0, a[1] + t * (b[1] - a[1])]; }],
    [p => p[0] <= box.x1, (a, b) => { const t = (box.x1 - a[0]) / (b[0] - a[0]); return [box.x1, a[1] + t * (b[1] - a[1])]; }],
    [p => p[1] >= box.y0, (a, b) => { const t = (box.y0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), box.y0]; }],
    [p => p[1] <= box.y1, (a, b) => { const t = (box.y1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), box.y1]; }],
  ];
  let out = ring;
  for (const [inside, inter] of edges) {
    const input = out; out = [];
    if (!input.length) break;
    let prev = input[input.length - 1];
    for (const cur of input) {
      if (inside(cur)) { if (!inside(prev)) out.push(inter(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(inter(prev, cur));
      prev = cur;
    }
  }
  return out;
}
const flat = (pts, q = 1) => pts.flatMap(([x, y]) => [Math.round(x / q), Math.round(y / q)]);

// ---------- land ----------
console.log('reading land polygons…');
const BOX_LL = { lon0: -74.32, lon1: -73.60, lat0: 40.44, lat1: 40.97 };
const box = { x0: px(BOX_LL.lon0), x1: px(BOX_LL.lon1), y0: py(BOX_LL.lat1), y1: py(BOX_LL.lat0) };
const landRaw = readJSON(args.land);
const land = [];
for (const geom of landRaw.geometries || landRaw.features.map(f => f.geometry)) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    for (let ri = 0; ri < poly.length; ri++) {
      const ring = poly[ri];
      let inBox = false;
      for (const [lon, lat] of ring) if (lon > BOX_LL.lon0 && lon < BOX_LL.lon1 && lat > BOX_LL.lat0 && lat < BOX_LL.lat1) { inBox = true; break; }
      if (!inBox) continue;
      let r = clipRing(ring.map(([lon, lat]) => [px(lon), py(lat)]), box);
      if (r.length < 3) continue;
      r = dpSimplify(r, 18);
      // outer rings: drop specks; inner rings (lakes): keep only big ones
      if (r.length < 3 || ringArea(r) < (ri === 0 ? 25000 : 1500000)) continue;
      land.push(flat(r));
    }
  }
}
console.log(`  ${land.length} land rings, ${land.reduce((s, r) => s + r.length / 2, 0)} points`);

// ---------- NYC borough shorelines (NYC Dept. of City Planning "nybb", shoreline-clipped) ----------
// The shapefile is in NY State Plane Long Island (US feet, Lambert Conformal Conic 2SP).
function lccInverse() {
  const a = 6378137, f = 1 / 298.257222101, e = Math.sqrt(2 * f - f * f), D = Math.PI / 180;
  const p1 = 40.66666666666666 * D, p2 = 41.03333333333333 * D, p0 = 40.16666666666666 * D, l0 = -74 * D;
  const FE = 984250 * 0.3048006096012192, FT = 0.3048006096012192;
  const m = p => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
  const t = p => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
  const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const F = m(p1) / (n * t(p1) ** n), r0 = a * F * t(p0) ** n;
  return (xf, yf) => {
    const x = xf * FT - FE, y = yf * FT;
    const r = Math.sign(n) * Math.hypot(x, r0 - y), th = Math.atan2(x, r0 - y);
    const tt = (r / (a * F)) ** (1 / n);
    let phi = Math.PI / 2 - 2 * Math.atan(tt);
    for (let i = 0; i < 8; i++) phi = Math.PI / 2 - 2 * Math.atan(tt * ((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) ** (e / 2));
    return [(th / n + l0) / D, phi / D];
  };
}
function readShapefilePolygons(shpPath) {
  const b = fs.readFileSync(shpPath); const recs = []; let o = 100;
  while (o < b.length) {
    const len = b.readInt32BE(o + 4) * 2; const c = o + 8; o = c + len;
    if (b.readInt32LE(c) !== 5) { recs.push([]); continue; }
    const nParts = b.readInt32LE(c + 36), nPts = b.readInt32LE(c + 40);
    const parts = []; for (let i = 0; i < nParts; i++) parts.push(b.readInt32LE(c + 44 + i * 4));
    const pt0 = c + 44 + nParts * 4; const rings = [];
    for (let i = 0; i < nParts; i++) {
      const s0 = parts[i], s1 = i + 1 < nParts ? parts[i + 1] : nPts; const ring = [];
      for (let k = s0; k < s1; k++) ring.push([b.readDoubleLE(pt0 + k * 16), b.readDoubleLE(pt0 + k * 16 + 8)]);
      rings.push(ring);
    }
    recs.push(rings);
  }
  return recs;
}
function readDbf(dbfPath) {
  const b = fs.readFileSync(dbfPath); const n = b.readUInt32LE(4), hl = b.readUInt16LE(8), rl = b.readUInt16LE(10);
  const fields = []; for (let o = 32; b[o] !== 0x0d; o += 32) fields.push({ name: b.toString('latin1', o, o + 11).replace(/\0.*$/, ''), len: b[o + 16] });
  const rows = [];
  for (let r = 0; r < n; r++) {
    let o = hl + r * rl + 1; const row = {};
    for (const f of fields) { row[f.name] = b.toString('latin1', o, o + f.len).trim(); o += f.len; }
    rows.push(row);
  }
  return rows;
}
console.log('reading borough shorelines…');
const inv = lccInverse();
const boroRows = readDbf(path.join(args.nybb, 'nybb.dbf'));
const boroShapes = readShapefilePolygons(path.join(args.nybb, 'nybb.shp'));
const BORO_CODE = { 'Manhattan': 'M', 'Brooklyn': 'Bk', 'Queens': 'Q', 'Bronx': 'Bx', 'Staten Island': 'SI' };
const boroughs = boroRows.map((row, i) => {
  const rings = [];
  for (const ring of boroShapes[i]) {
    let r = ring.map(([x, y]) => { const [lon, lat] = inv(x, y); return [px(lon), py(lat)]; });
    if (ringArea(r) < 6000) continue;
    r = dpSimplify(r, 7);
    if (r.length >= 3) rings.push(flat(r));
  }
  return { name: row.BoroName, code: BORO_CODE[row.BoroName] || '?', rings };
});
for (const bo of boroughs) console.log(`  ${bo.name}: ${bo.rings.length} rings, ${bo.rings.reduce((s, r) => s + r.length / 2, 0)} pts`);

// Approximate NYC limits incl. its waterways (mid-channel on water, slightly inside the city on
// land borders). Neighbouring land (NJ, Nassau, Westchester) is only drawn outside this region.
const NYC_REGION_LL = [
  [40.905, -73.927], [40.85, -73.955], [40.80, -73.981], [40.75, -74.014], [40.71, -74.025], [40.695, -74.047],
  [40.66, -74.068], [40.6455, -74.09], [40.6455, -74.15], [40.637, -74.19], [40.60, -74.207], [40.56, -74.24],
  [40.51, -74.26], [40.48, -74.26], [40.475, -74.10], [40.50, -73.95], [40.55, -73.75], [40.595, -73.748],
  [40.63, -73.752], [40.66, -73.74], [40.70, -73.737], [40.735, -73.717], [40.755, -73.71], [40.77, -73.737],
  [40.79, -73.757], [40.81, -73.762], [40.85, -73.766], [40.872, -73.795], [40.886, -73.828], [40.889, -73.86],
  [40.896, -73.88], [40.906, -73.90], [40.909, -73.918],
];
const nycRegion = flat(NYC_REGION_LL.map(([lat, lon]) => [px(lon), py(lat)]));

// ---------- stations ----------
console.log('reading stations…');
const meta = new Map(readJSON(args.stations).map(s => [s['GTFS Stop ID'], s]));
const STRUCT = { 'Subway': 'S', 'Elevated': 'E', 'Open Cut': 'C', 'Viaduct': 'V', 'At Grade': 'G', 'Embankment': 'B' };
const gStops = G('stops.json').filter(s => s.location_type === '1');
const stations = []; const stationIndex = new Map();
for (const s of gStops) {
  const m = meta.get(s.stop_id) || {};
  stationIndex.set(s.stop_id, stations.length);
  stations.push([
    s.stop_id, s.stop_name, Math.round(px(+s.stop_lon)), Math.round(py(+s.stop_lat)),
    m['Borough'] || 'M', STRUCT[m['Structure']] || 'S', +(m['Complex ID'] || 0),
    (m['Daytime Routes'] || []).join(''), m['North Direction Label'] || '', m['South Direction Label'] || '',
  ]);
}

// ---------- routes ----------
console.log('reading GTFS trips / shapes / stop_times (this takes a moment)…');
const WANT = ['1', '2', '3', '4', '5', '6', '7', 'A', 'C', 'E', 'B', 'D', 'F', 'M', 'G', 'J', 'Z', 'L', 'N', 'Q', 'R', 'W', 'GS', 'FS', 'H', 'SI'];
const routesMeta = new Map(G('routes.json').map(r => [r.route_id, r]));
const trips = G('trips.json').filter(t => WANT.includes(t.route_id) && /Weekday/i.test(t.service_id));
const tripById = new Map(trips.map(t => [t.trip_id, t]));
const stopsByTrip = new Map();
for (const st of G('stop_times.json')) {
  if (!tripById.has(st.trip_id)) continue;
  let a = stopsByTrip.get(st.trip_id); if (!a) stopsByTrip.set(st.trip_id, a = []);
  a.push([+st.stop_sequence, st.stop_id.replace(/[NS]$/, '')]);
}
const shapePts = new Map();
for (const p of G('shapes.json')) {
  let a = shapePts.get(p.shape_id); if (!a) shapePts.set(p.shape_id, a = []);
  a.push([+p.shape_pt_sequence, +p.shape_pt_lon, +p.shape_pt_lat]);
}

function pickTrip(routeId) {
  const rts = trips.filter(t => t.route_id === routeId && shapePts.has(t.shape_id) && stopsByTrip.has(t.trip_id));
  const byShape = new Map();
  for (const t of rts) { const e = byShape.get(t.shape_id) || { n: 0, trip: t }; e.n++; byShape.set(t.shape_id, e); }
  const maxN = Math.max(...[...byShape.values()].map(e => e.n));
  let best = null;
  for (const e of byShape.values()) {
    if (e.n < maxN * 0.25) continue;
    const len = stopsByTrip.get(e.trip.trip_id).length;
    if (!best || len > best.len || (len === best.len && e.n > best.n)) best = { ...e, len };
  }
  return best.trip;
}

function projectOnto(line, cum, x, y, fromSeg) {
  let best = { d2: Infinity, s: 0, seg: fromSeg };
  for (let i = fromSeg; i < line.length - 1; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
    let t = ((x - ax) * dx + (y - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
    const ex = ax + t * dx - x, ey = ay + t * dy - y, d2 = ex * ex + ey * ey;
    if (d2 < best.d2 - 1) best = { d2, s: cum[i] + t * Math.sqrt(L2), seg: i };
  }
  return best;
}

const LABEL = { GS: 'S', FS: 'S', H: 'S', SI: 'SIR' };
const routes = [];
for (const id of WANT) {
  const r = routesMeta.get(id); if (!r) { console.warn('no route', id); continue; }
  const trip = pickTrip(id);
  let stopIds = stopsByTrip.get(trip.trip_id).sort((a, b) => a[0] - b[0]).map(s => s[1]);
  let shape = shapePts.get(trip.shape_id).sort((a, b) => a[0] - b[0]).map(([, lon, lat]) => [px(lon), py(lat)]);
  // normalise so every route runs in GTFS direction 0 ("northbound" / toward the N label)
  if (trip.direction_id === '1') { stopIds.reverse(); shape.reverse(); }
  shape = dpSimplify(shape, 3.5);
  const cum = [0]; for (let i = 1; i < shape.length; i++) cum.push(cum[i - 1] + Math.hypot(shape[i][0] - shape[i - 1][0], shape[i][1] - shape[i - 1][1]));
  let seg = 0; const stopD = [];
  const stops = stopIds.map(sid => {
    const si = stationIndex.get(sid); const st = stations[si];
    const p = projectOnto(shape, cum, st[2], st[3], seg);
    seg = p.seg; stopD.push(Math.round(p.s));
    if (p.d2 > 400 * 400) console.warn(`  ${id}: ${st[1]} is ${Math.sqrt(p.d2) | 0} m from shape`);
    return si;
  });
  routes.push({
    id, label: LABEL[id] || id, name: r.route_long_name, color: '#' + (r.route_color || '808183'),
    text: '#' + (r.route_text_color || 'FFFFFF'), stops, stopD, len: Math.round(cum[cum.length - 1]),
    shape: flat(shape),
  });
  console.log(`  ${id.padEnd(3)} ${stops.length} stops, ${(cum[cum.length - 1] / 1000).toFixed(1)} km, ${shape.length} pts — ${stations[stops[0]][1]} → ${stations[stops[stops.length - 1]][1]}`);
}

const out = {
  source: 'MTA GTFS static (subway) + MTA Subway Stations dataset + NYC DCP borough boundaries + OpenStreetMap land polygons (ODbL)',
  proj: { lat0: LAT0, lon0: LON0, kx: +KX.toFixed(3), ky: KY },
  bounds: { x0: Math.round(box.x0), x1: Math.round(box.x1), y0: Math.round(box.y0), y1: Math.round(box.y1) },
  stations, routes, boroughs, nycRegion, land,
};
const js = `// AUTO-GENERATED by tools/build-data.mjs — do not edit by hand.\n// ${out.source}\nwindow.NYC_DATA = ${JSON.stringify(out)};\n`;
fs.writeFileSync(outFile, js);
console.log(`wrote ${outFile} (${(js.length / 1024).toFixed(0)} KB)`);
