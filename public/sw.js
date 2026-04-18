// ============================================================
// StoryCraft Studio — Advanced Service Worker v3.0
// Strategy: Stale-While-Revalidate + Cache-First + Network-Only
// Features: Versioned caches, background sync, periodic updates,
//           offline fallback, push notifications, share target
// ============================================================

const APP_VERSION   = '3.0.0';
const CACHE_STATIC  = `storycraft-static-v${APP_VERSION}`;
const CACHE_DYNAMIC = `storycraft-dynamic-v${APP_VERSION}`;
const CACHE_IMAGES  = `storycraft-images-v${APP_VERSION}`;
const ALL_CACHES    = [CACHE_STATIC, CACHE_DYNAMIC, CACHE_IMAGES];

const BASE = self.location.pathname.replace(/sw\.js$/, '');

const swLogger = {
  log: (...args) => self.console.log('[SW]', ...args),
  warn: (...args) => self.console.warn('[SW]', ...args),
  error: (...args) => self.console.error('[SW]', ...args),
};

// ── Pre-cache shell assets ───────────────────────────────────
// VitePWA (injectManifest) replaces self.__WB_MANIFEST at build time with
// the full hashed asset list. In dev / standalone mode the array is empty
// and we fall back to the minimal shell URLs below.
// eslint-disable-next-line no-underscore-dangle
const _WB_MANIFEST = self.__WB_MANIFEST || [];

const PRECACHE_URLS = [
  BASE,
  `${BASE}index.html`,
  `${BASE}manifest.json`,
  `${BASE}favicon.svg`,
  `${BASE}offline.html`,
  ..._WB_MANIFEST.map((entry) => (typeof entry === 'string' ? entry : entry.url)),
];

// ── Max age / entry limits ───────────────────────────────────
const MAX_AGE_DYNAMIC = 7  * 24 * 60 * 60 * 1000; // 7 days
const MAX_AGE_IMAGES  = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_ENTRIES_DYN = 60;
const MAX_ENTRIES_IMG = 40;

// ── Stamp a response with a cached-at timestamp ──────────────
function stampedResponse(response) {
  const cloned  = response.clone();
  const headers = new Headers(cloned.headers);
  headers.set('sw-cached-at', Date.now().toString());
  return new Response(cloned.body, {
    status:     cloned.status,
    statusText: cloned.statusText,
    headers,
  });
}

function isExpired(response, maxAge) {
  const cachedAt = response?.headers?.get('sw-cached-at');
  if (!cachedAt) return false;
  return Date.now() - parseInt(cachedAt, 10) > maxAge;
}

// ── Trim oldest entries when cache exceeds maxEntries ────────
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys  = await cache.keys();
  if (keys.length > maxEntries) {
    await cache.delete(keys[0]);
    return trimCache(cacheName, maxEntries);
  }
}

// ── Offline fallback per resource type ───────────────────────
async function offlineFallback(request) {
  if (request.destination === 'document') {
    const cached = await caches.match(`${BASE}offline.html`);
    return cached || new Response('<!doctype html><title>Offline</title><p>StoryCraft Studio ist offline.</p>', {
      headers: { 'Content-Type': 'text/html' },
      status: 503,
    });
  }
  if (request.destination === 'image') {
    return new Response(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
         <rect width="200" height="200" fill="#1e293b"/>
         <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
               fill="#64748b" font-family="sans-serif" font-size="14">Offline</text>
       </svg>`,
      { headers: { 'Content-Type': 'image/svg+xml' } }
    );
  }
  return new Response('', { status: 408 });
}

// ════════════════════════════════════════════════════════════
// INSTALL — Precache shell
// ════════════════════════════════════════════════════════════
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch((err) => {
        // Some precache entries (e.g. offline.html) may not exist yet; continue anyway
        swLogger.warn('Precache partial failure (non-fatal):', err);
      })
  );
});

// ════════════════════════════════════════════════════════════
// ACTIVATE — Prune stale caches, claim all clients
// ════════════════════════════════════════════════════════════
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => !ALL_CACHES.includes(name))
            .map((name) => {
              swLogger.log('Pruning old cache:', name);
              return caches.delete(name);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ════════════════════════════════════════════════════════════
// FETCH — Multi-strategy routing
// ════════════════════════════════════════════════════════════
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Non-GET: passthrough
  if (request.method !== 'GET') return;

  // 1. External AI / analytics — Network Only, no cache
  if (
    url.hostname.includes('generativelanguage.googleapis.com') ||
    url.protocol === 'chrome-extension:'
  ) {
    return;
  }

  // 2. Image files — Cache First with expiry + offline SVG fallback
  if (
    request.destination === 'image' ||
    /\.(png|jpg|jpeg|gif|webp|avif|svg|ico)(\?|$)/i.test(url.pathname)
  ) {
    event.respondWith(
      caches.open(CACHE_IMAGES).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached && !isExpired(cached, MAX_AGE_IMAGES)) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) {
            cache.put(request, stampedResponse(response.clone()));
            trimCache(CACHE_IMAGES, MAX_ENTRIES_IMG);
          }
          return response;
        } catch {
          return cached || offlineFallback(request);
        }
      })
    );
    return;
  }

  // 3. JS / CSS bundles — Cache First (Vite hashes these; stale = always valid)
  if (
    url.origin === self.location.origin &&
    (request.destination === 'script' || request.destination === 'style')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_STATIC).then((c) => c.put(request, response.clone()));
          }
          return response;
        });
        return cached || networkFetch;
      }).catch(() => offlineFallback(request))
    );
    return;
  }

  // 4. Locale JSON — Stale-While-Revalidate (fast first paint, always fresh bg)
  if (url.pathname.includes('/locales/')) {
    event.respondWith(
      caches.open(CACHE_DYNAMIC).then(async (cache) => {
        const cached  = await cache.match(request);
        const fetchPr = fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        }).catch(() => null);
        return cached || await fetchPr || offlineFallback(request);
      })
    );
    return;
  }

  // 5. Navigation — Network First, SPA fallback to index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE_DYNAMIC).then((c) => c.put(request, response.clone()));
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(request)) ||
          (await caches.match(`${BASE}index.html`)) ||
          offlineFallback(request)
        )
    );
    return;
  }

  // 6. Everything else — Stale-While-Revalidate with expiry
  event.respondWith(
    caches.open(CACHE_DYNAMIC).then(async (cache) => {
      const cached  = await cache.match(request);
      const fetchPr = fetch(request).then((response) => {
        if (response.ok) {
          cache.put(request, stampedResponse(response.clone()));
          trimCache(CACHE_DYNAMIC, MAX_ENTRIES_DYN);
        }
        return response;
      }).catch(() => null);
      if (cached && !isExpired(cached, MAX_AGE_DYNAMIC)) return cached;
      return await fetchPr || cached || offlineFallback(request);
    })
  );
});

// ════════════════════════════════════════════════════════════
// MESSAGE — Handle commands from the app
// ════════════════════════════════════════════════════════════
self.addEventListener('message', (event) => {
  const { type } = event.data || {};

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (type === 'CLEAR_CACHE') {
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => event.source?.postMessage({ type: 'CACHE_CLEARED' }));
  }

  if (type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'SW_VERSION', version: APP_VERSION });
  }

  if (type === 'PRECACHE_URLS') {
    const urls = event.data.urls || [];
    caches.open(CACHE_DYNAMIC).then((cache) =>
      Promise.allSettled(urls.map((url) => cache.add(url)))
    );
  }
});

// ════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS — Future-ready handler
// ════════════════════════════════════════════════════════════
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { data = { title: 'StoryCraft Studio', body: event.data.text() }; }

  const options = {
    body:    data.body    || 'New notification',
    icon:    `${BASE}favicon.svg`,
    badge:   `${BASE}favicon.svg`,
    tag:     data.tag     || 'storycraft-notification',
    data:    data.data    || {},
    actions: data.actions || [],
    vibrate: [100, 50, 100],
    renotify:           false,
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'StoryCraft Studio', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || BASE;
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const focused = clients.find((c) => c.url === targetUrl && 'focus' in c);
        if (focused) return focused.focus();
        return self.clients.openWindow(targetUrl);
      })
  );
});

// ════════════════════════════════════════════════════════════
// BACKGROUND SYNC — Retry deferred autosave operations
// ════════════════════════════════════════════════════════════
self.addEventListener('sync', (event) => {
  if (event.tag === 'storycraft-autosave') {
    event.waitUntil(
      self.clients.matchAll().then((clients) =>
        clients.forEach((c) => c.postMessage({ type: 'TRIGGER_AUTOSAVE' }))
      )
    );
  }
});

// ════════════════════════════════════════════════════════════
// PERIODIC BACKGROUND SYNC — Refresh locale JSON while idle
// ════════════════════════════════════════════════════════════
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'storycraft-refresh') {
    event.waitUntil(
      caches.open(CACHE_DYNAMIC).then(async (cache) => {
        const keys         = await cache.keys();
        const localeKeys   = keys.filter((r) => r.url.includes('/locales/'));
        return Promise.allSettled(
          localeKeys.map(async (req) => {
            const response = await fetch(req);
            if (response.ok) cache.put(req, response);
          })
        );
      })
    );
  }
});

swLogger.log(`StoryCraft Studio Service Worker v${APP_VERSION} loaded`);
