/* ARZ Terminal — service worker (приложение на телефоне).
 *
 * Зачем: чтобы приложение открывалось без сети и быстро. Стратегия: «сначала сеть, при ошибке — кэш»:
 * онлайн всегда свежая версия сайта и данных, офлайн — последняя виденная. Не трогаем:
 *   - чужие адреса (Firestore/Google) — это данные игрока, они не кэшируются;
 *   - /api/* — локальный сервер ПК;
 *   - не-GET запросы.
 * Версию кэша меняй при изменении этого файла, старые кэши удаляются при активации.
 */
const CACHE = "arz-shell-v1";
const SHELL = ["./", "index.html", "styles.css", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;       // Firestore, Google и т.п. — мимо кэша
  if (url.pathname.startsWith("/api/")) return;          // локальный API ПК
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined)))
  );
});
