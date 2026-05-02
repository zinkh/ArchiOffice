const CACHE_NAME = 'archi-v1';

// Assets to precache on install (app shell)
const PRECACHE_URLS = ['/', '/manifest.json'];

// Domains that should never be cached (external APIs)
const EXTERNAL_PASSTHROUGH = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'georisques.gouv.fr',
  'apicarto.ign.fr',
  'api-adresse.data.gouv.fr',
  'opendata.arcgis.com',
];

function isExternal(url) {
  return EXTERNAL_PASSTHROUGH.some((domain) => url.includes(domain));
}

function isApiRequest(url) {
  return url.includes('/api/');
}

// ── Install: precache app shell ──────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ──────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  // Always pass through non-GET and external requests
  if (request.method !== 'GET' || isExternal(url)) {
    return;
  }

  // API requests: network-first, no cache fallback (app handles offline state via Dexie)
  if (isApiRequest(url)) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ offline: true, error: 'Offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Static assets & navigation: cache-first, fall back to network then '/'
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Cache successful responses for static assets
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          // Navigation fallback: serve app shell so React Router handles the route
          caches.match('/')
        );
    })
  );
});
