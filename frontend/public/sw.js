// CdMento Progressive Web App Service Worker
// Bump the version whenever the caching strategy changes so old caches purge.
const CACHE_NAME = "cdmento-app-v5";
const STATIC_ASSETS = [
  "/",
  "/workspace",
  "/brand/cdmento-favicon.svg",
  "/brand/icon-192.png",
  "/brand/icon-512.png",
  "/brand/apple-touch-icon.png",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Continue even if some individual assets fail to precache
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never intercept sign-in, fonts, or other third-party requests.
  if (url.origin !== self.location.origin) return;

  // 1. Skip non-GET requests and browser extensions
  if (request.method !== "GET" || !url.protocol.startsWith("http")) {
    return;
  }

  // 2. Skip API calls and AI endpoints — never cache dynamic private data
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // 3. Skip dev-server modules and cache-busted URLs. The Vite dev server
  //    rewrites these constantly; caching them serves stale code after edits.
  if (
    url.search ||
    url.pathname.startsWith("/src/") ||
    url.pathname.startsWith("/@") ||
    url.pathname.startsWith("/node_modules/")
  ) {
    return;
  }

  // 4. For navigation (HTML document): Network-first with offline cache fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(() => {
        return caches.match(request).then((cached) => {
          return cached || caches.match("/") || caches.match("/workspace");
        }).catch(() => new Response("Offline", { status: 503 }));
      })
    );
    return;
  }

  // 5. Static assets (JS, CSS, images, fonts): Cache-first with network fallback
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch update in background
        fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse)).catch(() => {});
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      return fetch(request).then((networkResponse) => {
        if (
          !networkResponse ||
          networkResponse.status !== 200 ||
          networkResponse.type !== "basic"
        ) {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache)).catch(() => {});

        return networkResponse;
      }).catch(() => new Response("Offline", { status: 503 }));
    })
  );
});
