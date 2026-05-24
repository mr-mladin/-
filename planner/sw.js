// Service worker планера: кэшируем ТОЛЬКО сторонние библиотеки с CDN (esm.sh).
// У них фиксированные версии в адресе, поэтому они никогда не меняются —
// безопасно отдавать из кэша (быстрый холодный старт, в т.ч. с домашней иконки).
// Файлы самого приложения НЕ кэшируем: они всегда грузятся из сети, чтобы любая
// правка подтягивалась свежей. Так мы не повторяем старую проблему «залипания».

const CDN_CACHE = "planner-cdn-v1";
const CDN_HOSTS = ["esm.sh"];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith("planner") && k !== CDN_CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (!CDN_HOSTS.includes(url.hostname)) return; // свои файлы — всегда из сети

  e.respondWith((async () => {
    const cache = await caches.open(CDN_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
    return res;
  })());
});
