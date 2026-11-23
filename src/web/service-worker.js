/* PWA 仅提供离线说明，不缓存认证接口、会话正文或重放写操作。 */
const CACHE = "bugpaw-relay-shell-__OFFLINE_VERSION__";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll([
          "/offline.html",
          "/offline-i18n.js",
          "/assets/bugpaw-app-icon-brown-paw.png",
        ]),
      ),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  if (
    new URL(event.request.url).origin === self.location.origin &&
    new URL(event.request.url).pathname === "/offline-i18n.js"
  ) {
    event.respondWith(
      caches
        .match("/offline-i18n.js")
        .then((cached) => cached || fetch(event.request)),
    );
    return;
  }
  if (event.request.mode === "navigate" &&
      new URL(event.request.url).origin === self.location.origin)
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/offline.html")),
    );
});
