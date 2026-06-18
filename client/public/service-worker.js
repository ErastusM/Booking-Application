/* Bookplus service worker — offline shell + faster repeat loads on costly mobile data.
 *
 * Strategy (kept conservative so it never serves a stale app):
 *  - Cross-origin requests (the API on api.*, Cloudinary, Google) pass through untouched.
 *  - Navigations (HTML): network-first — always load the latest app when online,
 *    fall back to the cached shell only when offline.
 *  - Content-hashed static assets (/static/...): cache-first (safe; filenames change per build).
 *  - Other same-origin GETs: network, falling back to cache.
 */
const CACHE = 'bookplus-v1';
const OFFLINE_URLS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE_URLS)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    let url;
    try { url = new URL(request.url); } catch { return; }

    // Only handle same-origin; let the API, Cloudinary, Google fonts/photos pass through.
    if (url.origin !== self.location.origin) return;

    // Navigations → network-first, cached shell as offline fallback.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((res) => {
                    caches.open(CACHE).then((c) => c.put('/index.html', res.clone())).catch(() => {});
                    return res;
                })
                .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
        );
        return;
    }

    // Content-hashed build assets → cache-first.
    if (url.pathname.startsWith('/static/')) {
        event.respondWith(
            caches.match(request).then((cached) => cached || fetch(request).then((res) => {
                if (res && res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone())).catch(() => {});
                return res;
            }))
        );
        return;
    }

    // Everything else same-origin → network, fall back to cache when offline.
    event.respondWith(fetch(request).catch(() => caches.match(request)));
});
