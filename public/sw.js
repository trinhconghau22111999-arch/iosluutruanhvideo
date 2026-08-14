// Bumping this version invalidates the old cache the next time the app
// loads — use it whenever the thumbnail route's output changes in a way
// that should force a re-fetch (e.g. the requested source resolution).
const CACHE_NAME = "ky-su-thumbs-v1";
const THUMB_PATH = "/api/drive/thumbnail";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for thumbnails: if we already have this exact image cached,
// return it instantly (no network round-trip at all, so it loads
// immediately every time the library page is opened), and quietly refresh
// the cached copy in the background so it doesn't go stale forever.
// Everything else (the page itself, the library listing API, etc.) is left
// alone and goes to the network as normal.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!url.pathname.startsWith(THUMB_PATH)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);

      const refresh = fetch(request)
        .then((res) => {
          if (res && res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);

      return cached || refresh;
    })
  );
});
