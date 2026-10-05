// The NYC network model built from window.NYC_DATA (real MTA GTFS geometry + station list),
// plus hand-placed landmarks, parks and labels for the cartoon map.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const U = SC.util;
  const D = window.NYC_DATA;
  const P = D.proj;
  const toXY = (lat, lon) => [(lon - P.lon0) * P.kx, (P.lat0 - lat) * P.ky];
  const ll = (arr) => arr.flatMap(([lat, lon]) => toXY(lat, lon));

  const net = { toXY, bounds: D.bounds, nycRegion: D.nycRegion, land: D.land };

  // ---------- boroughs ----------
  net.boroughs = D.boroughs.map(b => ({ ...b, boxes: b.rings.map(U.ringBBox) }));
  net.isLand = (x, y) => {
    for (const b of net.boroughs) {
      let inside = false;
      for (let i = 0; i < b.rings.length; i++) { const bb = b.boxes[i]; if (x < bb.x0 || x > bb.x1 || y < bb.y0 || y > bb.y1) continue; if (U.pointInRing(x, y, b.rings[i])) inside = !inside; }
      if (inside) return true;
    }
    return false;
  };

  // ---------- routes ----------
  const TRUNK_OFFSET = { A: -1, C: -1, E: -1, B: 1, D: 1, F: 1, M: 1, G: -1, J: 2, Z: 2 };
  const EXPRESS = new Set(['2', '3', '4', '5', 'A', 'D', 'Q', 'B', 'Z']);
  net.routes = D.routes.map((r, idx) => {
    const line = new U.Polyline(r.shape);
    return {
      ...r, idx, line, offset: TRUNK_OFFSET[r.id] || 0, express: EXPRESS.has(r.id), rgb: U.hexToRgb(r.color),
      shortName: r.id === 'GS' ? '42 St Shuttle' : r.id === 'FS' ? 'Franklin Av Shuttle' : r.id === 'H' ? 'Rockaway Park Shuttle' : r.id === 'SI' ? 'Staten Island Railway' : `${r.label} train`,
    };
  });
  net.routeById = Object.fromEntries(net.routes.map(r => [r.id, r]));

  // ---------- stations ----------
  const BORO_W = { M: 2.4, Bk: 1.15, Q: 1.15, Bx: 1.0, SI: 0.45 };
  const BORO_NAME = { M: 'Manhattan', Bk: 'Brooklyn', Q: 'Queens', Bx: 'The Bronx', SI: 'Staten Island' };
  const HUBS = ['Times Sq-42 St', 'Grand Central-42 St', '34 St-Herald Sq', '14 St-Union Sq', 'Fulton St', '34 St-Penn Station', '59 St-Columbus Circle',
    'Atlantic Av-Barclays Ctr', 'Jackson Hts-Roosevelt Av', 'Flushing-Main St', 'Lexington Av/59 St', '42 St-Port Authority Bus Terminal', 'W 4 St-Wash Sq',
    'Jay St-MetroTech', 'Court Sq', '161 St-Yankee Stadium', 'Jamaica Center-Parsons/Archer', 'Canal St', 'Chambers St', 'Bowling Green', '51 St', 'Wall St', 'Union Sq'];
  const STRUCT_NAME = { S: 'Underground', E: 'Elevated', C: 'Open cut', V: 'Viaduct', G: 'At grade', B: 'Embankment' };
  net.STRUCT_NAME = STRUCT_NAME; net.BORO_NAME = BORO_NAME;
  net.stations = D.stations.map((s, idx) => ({
    idx, id: s[0], name: s[1], x: s[2], y: s[3], boro: s[4], struct: s[5], complex: s[6], daytime: s[7], north: s[8], south: s[9], routes: [],
  }));
  net.routes.forEach(r => r.stops.forEach(si => { if (!net.stations[si].routes.includes(r.idx)) net.stations[si].routes.push(r.idx); }));
  net.complexes = {};
  net.stations.forEach(s => { const k = s.complex || ('s' + s.idx); (net.complexes[k] = net.complexes[k] || []).push(s.idx); });
  net.stations.forEach(s => {
    const cx = net.complexes[s.complex || ('s' + s.idx)];
    s.complexRoutes = [...new Set(cx.flatMap(i => net.stations[i].routes))];
    s.transfers = s.complexRoutes; // route indices reachable at this complex
    let w = BORO_W[s.boro] || 1;
    w *= 1 + 0.22 * Math.min(6, s.complexRoutes.length - 1) / Math.max(1, cx.length);
    if (HUBS.some(h => s.name === h || s.name.startsWith(h))) w *= 2.2;
    s.weight = w;
  });

  // ---------- landmarks (cartoon icons on the map; skyline objects in first person) ----------
  const LM = (name, lat, lon, kind, h = 0) => { const [x, y] = toXY(lat, lon); return { name, x, y, kind, h }; };
  net.landmarks = [
    LM('Statue of Liberty', 40.6892, -74.0445, 'liberty', 93),
    LM('Empire State Building', 40.7484, -73.9857, 'esb', 443),
    LM('Chrysler Building', 40.7516, -73.9755, 'chrysler', 319),
    LM('One World Trade Center', 40.7127, -74.0134, 'wtc', 541),
    LM('Brooklyn Bridge', 40.7061, -73.9969, 'bridge', 84),
    LM('Times Square', 40.7580, -73.9855, 'timessq'),
    LM('Yankee Stadium', 40.8296, -73.9262, 'stadium', 40),
    LM('Citi Field', 40.7571, -73.8458, 'stadium', 40),
    LM('Unisphere', 40.7465, -73.8449, 'unisphere', 43),
    LM('Wonder Wheel', 40.5739, -73.9786, 'wheel', 46),
    LM('JFK Airport', 40.6413, -73.7781, 'plane'),
    LM('LaGuardia Airport', 40.7769, -73.8740, 'plane'),
    LM('Bronx Zoo', 40.8506, -73.8769, 'zoo'),
    LM('Barclays Center', 40.6826, -73.9754, 'arena', 30),
    LM('Grand Central Terminal', 40.7527, -73.9772, 'gct'),
    LM('Central Park', 40.7812, -73.9665, 'tree'),
    LM('Prospect Park', 40.6602, -73.9690, 'tree'),
    LM('Verrazzano-Narrows Bridge', 40.6066, -74.0447, 'bridge', 211),
    LM('Coney Island', 40.5755, -73.9707, 'coaster'),
    LM('Apollo Theater', 40.8100, -73.9500, 'apollo'),
  ];
  // Skyline for the first-person view: the icons plus deterministic "generic" towers in real clusters.
  const sky = [
    ['esb', 40.7484, -73.9857, 443], ['chrysler', 40.7516, -73.9755, 319], ['wtc', 40.7127, -74.0134, 541],
    ['slim', 40.7616, -73.9719, 426], ['slim', 40.7663, -73.9810, 472], ['slim', 40.7647, -73.9776, 435], ['tower', 40.7540, -74.0014, 387],
    ['citi', 40.7585, -73.9702, 279], ['tower', 40.7531, -73.9767, 246], ['woolworth', 40.7124, -74.0082, 241], ['tower', 40.7107, -74.0054, 265],
    ['tower', 40.7556, -73.9845, 366], ['liberty', 40.6892, -74.0445, 93], ['bridge', 40.6066, -74.0447, 211], ['unisphere', 40.7465, -73.8449, 43],
    ['wheel', 40.5739, -73.9786, 46], ['stadium', 40.8296, -73.9262, 40], ['stadium', 40.7571, -73.8458, 40],
  ].map(([kind, lat, lon, h]) => { const [x, y] = toXY(lat, lon); return { kind, x, y, h }; });
  const r = U.rng(12345);
  const cluster = (lat0, lat1, lon0, lon1, n, hmin, hmax) => { for (let i = 0; i < n; i++) { const [x, y] = toXY(U.lerp(lat0, lat1, r()), U.lerp(lon0, lon1, r())); sky.push({ kind: 'box', x, y, h: U.lerp(hmin, hmax, Math.pow(r(), 1.6)), w: U.lerp(25, 60, r()), seed: (r() * 1e6) | 0 }); } };
  cluster(40.745, 40.766, -73.995, -73.968, 46, 90, 260); // Midtown
  cluster(40.703, 40.716, -74.016, -74.004, 24, 90, 250); // FiDi
  cluster(40.688, 40.698, -73.990, -73.978, 10, 70, 180); // Downtown Brooklyn
  cluster(40.742, 40.752, -73.950, -73.937, 10, 80, 200); // Long Island City
  cluster(40.712, 40.728, -74.040, -74.030, 10, 70, 200); // Jersey City
  cluster(40.700, 40.716, -73.995, -73.985, 6, 40, 120);
  net.skyline = sky;

  net.parks = [
    { name: 'Central Park', pts: ll([[40.7644, -73.9730], [40.7681, -73.9819], [40.8006, -73.9580], [40.7968, -73.9493]]) },
    { name: 'Prospect Park', pts: ll([[40.6740, -73.9703], [40.6614, -73.9797], [40.6515, -73.9725], [40.6550, -73.9617], [40.6660, -73.9622]]) },
    { name: 'Flushing Meadows', pts: ll([[40.759, -73.848], [40.757, -73.836], [40.735, -73.832], [40.718, -73.830], [40.715, -73.842], [40.735, -73.851], [40.751, -73.851]]) },
    { name: 'Van Cortlandt Park', pts: ll([[40.889, -73.899], [40.911, -73.905], [40.911, -73.874], [40.894, -73.879], [40.888, -73.889]]) },
    { name: 'Pelham Bay Park', pts: ll([[40.873, -73.815], [40.876, -73.800], [40.862, -73.790], [40.848, -73.802], [40.850, -73.823], [40.862, -73.826]]) },
    { name: 'Bronx Park', pts: ll([[40.870, -73.880], [40.866, -73.871], [40.843, -73.872], [40.845, -73.881], [40.858, -73.884]]) },
    { name: 'Forest Park', pts: ll([[40.705, -73.873], [40.711, -73.846], [40.702, -73.840], [40.696, -73.865]]) },
    { name: 'Greenbelt', pts: ll([[40.600, -74.150], [40.604, -74.122], [40.582, -74.110], [40.566, -74.133], [40.576, -74.156]]) },
  ];
  net.airports = [
    { name: 'JFK', pts: ll([[40.665, -73.810], [40.662, -73.770], [40.650, -73.746], [40.626, -73.760], [40.623, -73.790], [40.641, -73.815]]) },
    { name: 'LGA', pts: ll([[40.785, -73.890], [40.786, -73.862], [40.772, -73.858], [40.768, -73.880]]) },
  ];
  const lab = (text, lat, lon, rot = 0, size = 1, kind = 'boro') => { const [x, y] = toXY(lat, lon); return { text, x, y, rot, size, kind }; };
  net.labels = [
    lab('MANHATTAN', 40.790, -73.962, -1.08, 1), lab('THE BRONX', 40.856, -73.885, 0, 1), lab('QUEENS', 40.712, -73.810, 0, 1.15),
    lab('BROOKLYN', 40.640, -73.950, 0, 1.15), lab('STATEN ISLAND', 40.582, -74.150, -0.55, 0.95),
    lab('NEW JERSEY', 40.760, -74.090, 0, 0.8, 'nj'), lab('NASSAU', 40.700, -73.675, 0, 0.7, 'nj'), lab('WESTCHESTER', 40.935, -73.840, 0, 0.7, 'nj'),
    lab('Hudson River', 40.800, -73.990, -1.08, 0.55, 'water'), lab('East River', 40.737, -73.966, -1.25, 0.5, 'water'),
    lab('Upper Bay', 40.665, -74.050, 0, 0.55, 'water'), lab('Jamaica Bay', 40.612, -73.835, 0, 0.6, 'water'),
    lab('ATLANTIC OCEAN', 40.535, -73.920, 0, 0.9, 'water'), lab('Long Island Sound', 40.815, -73.770, -0.3, 0.5, 'water'),
    lab('Lower Bay', 40.540, -74.040, 0, 0.55, 'water'),
  ];
  const [fx0, fy0] = toXY(40.6437, -74.0736), [fx1, fy1] = toXY(40.7013, -74.0132);
  net.ferry = { x0: fx0, y0: fy0, x1: fx1, y1: fy1 };

  // ---------- route helpers ----------
  // Terminal label for travelling in direction dir (+1 = toward last stop in the list).
  net.terminal = (route, dir) => net.stations[dir > 0 ? route.stops[route.stops.length - 1] : route.stops[0]];
  net.boundLabel = (route, dir, stopIdx) => {
    const st = net.stations[route.stops[stopIdx]];
    const lab = dir > 0 ? st.north : st.south;
    return lab || U.stationName(net.terminal(route, dir).name);
  };

  SC.net = net;
})(window.SC);
