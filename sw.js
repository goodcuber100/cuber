// Service worker: makes Stand Clear! installable and playable offline.
// Pages are network-first (falling back to the cached app shell), everything else is
// served from the cache and refreshed in the background. Bump VERSION when you ship so
// installed copies download the new files on their next launch.
const VERSION = 'v1';
const CACHE = `standclear-${VERSION}`;
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/data/nyc-data.js',
  'js/core/util.js', 'js/core/audio.js', 'js/core/ui.js', 'js/core/pwa.js', 'js/core/net.js', 'js/core/icons.js',
  'js/manager/content.js', 'js/manager/sim.js', 'js/manager/map.js', 'js/manager/mode.js',
  'js/fp/track.js', 'js/fp/sprites.js', 'js/fp/renderer.js', 'js/fp/stopEvents.js', 'js/fp/conductor.js', 'js/fp/mode.js',
  'js/main.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];
const SCOPE = new URL(self.registration.scope).pathname;
const INDEX = new URL('index.html', self.registration.scope).href;
const PAGE_TIMEOUT = 3000;

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the HTTP cache so a new version never precaches stale files
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('standclear-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || req.cache === 'only-if-cached') return;
  const page = req.mode === 'navigate';
  const shell = url.pathname === SCOPE || url.pathname === SCOPE + 'index.html';
  const network = fetch(req).then((res) => {
    // keep only complete, same-origin answers; the app page is stored as the shell
    if (res.status === 200 && res.type === 'basic' && !res.redirected && (!page || shell)) {
      const copy = res.clone();
      e.waitUntil(caches.open(CACHE).then(c => c.put(page ? INDEX : req, copy)));
    }
    return res;
  });
  e.waitUntil(network.catch(() => {}));
  e.respondWith(page ? networkFirst(network) : staleWhileRevalidate(req, network));
});

async function networkFirst(network) {
  const slow = new Promise(r => setTimeout(r, PAGE_TIMEOUT));
  const res = await Promise.race([network, slow]).catch(() => null);
  return res || (await caches.match(INDEX)) || network;
}

async function staleWhileRevalidate(req, network) {
  return (await caches.match(req)) || network;
}
