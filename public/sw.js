// Bumping this version invalidates the old cache the next time the app
// loads — use it whenever the thumbnail route's output changes in a way
// that should force a re-fetch (e.g. the requested source resolution).
const CACHE_NAME = "ky-su-thumbs-v1";
const THUMB_PATH = "/api/drive/thumbnail";

// Priority order for eviction: index 0 = top of the library page (newest),
// so it's the last thing dropped when storage runs low. Populated by the
// "SYNC_IDS" message below, which the page sends in the same top-to-bottom
// order it renders the grid in.
let priorityIds = [];
function keyFor(id) {
  return `${THUMB_PATH}?id=${id}`;
}

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

// If the device is running low on space for this cache, drop the
// lowest-priority thumbnails (furthest down the library page) until
// there's comfortable headroom again — so what stays cached is always
// weighted toward the top of the list first.
const QUOTA_HIGH_WATER = 0.85; // start evicting once usage crosses this
const QUOTA_LOW_WATER = 0.7; // stop evicting once back under this
async function pruneToQuota(cache) {
  if (!self.navigator?.storage?.estimate) return;
  try {
    let { usage, quota } = await self.navigator.storage.estimate();
    if (!quota || usage / quota < QUOTA_HIGH_WATER) return;

    const keys = await cache.keys();
    const cachedIds = new Set(
      keys.map((req) => new URL(req.url).searchParams.get("id")).filter(Boolean)
    );

    // Evict lowest-priority first: anything not in priorityIds at all
    // (stale/unknown) goes first, then known ids from the bottom of the
    // page upward.
    const knownLowToHigh = [...priorityIds].reverse().filter((id) => cachedIds.has(id));
    const unknown = [...cachedIds].filter((id) => !priorityIds.includes(id));
    const evictionOrder = [...unknown, ...knownLowToHigh];

    for (const id of evictionOrder) {
      await cache.delete(keyFor(id));
      ({ usage, quota } = await self.navigator.storage.estimate());
      if (!quota || usage / quota < QUOTA_LOW_WATER) break;
    }
  } catch {
    // Storage estimate unsupported or failed — skip pruning quietly, the
    // cache just won't self-limit on this device.
  }
}

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
          if (res && res.ok) {
            cache.put(request, res.clone());
            pruneToQuota(cache);
          }
          return res;
        })
        .catch(() => cached);

      return cached || refresh;
    })
  );
});

// Lets the page tell us when a file no longer exists, so its cached
// thumbnail doesn't sit around forever:
//  - { type: "DELETE_THUMB", id } — one file was just deleted; drop it
//    from the cache immediately.
//  - { type: "SYNC_IDS", ids } — the full current list of valid file ids,
//    top-to-bottom in page order (sent once after the library loads);
//    anything cached that isn't in this list gets removed (catching files
//    deleted in another session), and this order also becomes the
//    eviction priority used by pruneToQuota above.
self.addEventListener("message", (event) => {
  const msg = event.data || {};

  if (msg.type === "DELETE_THUMB" && msg.id) {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.delete(keyFor(msg.id))));
  }

  if (msg.type === "SYNC_IDS" && Array.isArray(msg.ids)) {
    priorityIds = msg.ids;
    const validKeys = new Set(msg.ids.map(keyFor));
    event.waitUntil(
      caches.open(CACHE_NAME).then(async (cache) => {
        const requests = await cache.keys();
        await Promise.all(
          requests
            .filter((req) => {
              const path = new URL(req.url).pathname + new URL(req.url).search;
              return path.startsWith(THUMB_PATH) && !validKeys.has(path);
            })
            .map((req) => cache.delete(req))
        );
        await pruneToQuota(cache);
      })
    );
  }
});
