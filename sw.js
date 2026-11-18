// Service worker : l'application s'ouvre sans réseau. Les appels Google ne sont jamais mis en cache.
const CACHE = 'barrena-temps-v1.2.0';
const FILES = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/config.js', './js/backend.js', './js/db.js', './js/invoice.js', './js/lock.js', './js/sync.js', './js/time.js',
  './vendor/jspdf.umd.min.js',
  './fonts/outfit-latin-400-normal.woff2', './fonts/outfit-latin-500-normal.woff2', './fonts/outfit-latin-600-normal.woff2', './fonts/outfit-latin-700-normal.woff2',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png', './icons/logo.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Réseau d'abord pour garder les mises à jour, cache en secours hors ligne.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
