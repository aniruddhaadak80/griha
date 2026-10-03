/**
 * Griha offline shell.
 *
 * Strategy, in plain terms:
 *
 *   navigations  → network first, fall back to the cached shell. A shared
 *                  chore board that only shows stale data when the network is
 *                  gone would be worse than one that says it cannot reach the
 *                  server, so the live response always wins when there is one.
 *   same-origin  → stale-while-revalidate. Static assets are immutable;
 *                  JSON reads revalidate in the background so the next visit
 *                  is warm.
 *   cross-origin → never cached. Weather and holiday feeds belong to someone
 *                  else and must not be replayed from a stale cache.
 *
 * Only same-origin GETs are cached at all, so no request body and no
 * cross-origin response can end up here.
 */

const VERSION = "griha-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const SHELL_URLS = ["/", "/board", "/fairness", "/export", "/install", "/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("griha-") && key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const shell = await caches.match("/offline");
          if (shell) return shell;
          return new Response("Griha is offline and this page was not cached.", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});