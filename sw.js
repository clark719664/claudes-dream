// Cache-first for the app shell so it opens with no network at all. Bump VERSION on release.
const VERSION = 'lasts-v1';
const SHELL = [
  './', './index.html', './app.css', './manifest.webmanifest',
  './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png',
  './src/ui.js', './src/core.js', './src/store.js', './src/catalog.js', './src/vision.js',
  './src/barcode.js', './src/parts.js', './src/scanner.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request)
          .then((res) => {
            // Fonts are the only third-party request; cache them so a second visit is fully offline.
            if (res.ok && new URL(e.request.url).origin !== location.origin) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(e.request, copy));
            }
            return res;
          })
          .catch(() => caches.match('./index.html'))
    )
  );
});
