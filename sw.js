// Service worker: stale-while-revalidate.
// Цель — мгновенная загрузка страницы из кеша + тихое обновление в фоне.
// При следующем заходе пользователь видит свежую версию.

const CACHE = "fin-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Только наш origin (Supabase, esm.sh не трогаем — пусть браузер кэширует сам).
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);

    // Сетевой запрос — не блокируемся на нём, если есть кеш
    const networkPromise = fetch(req)
      .then(res => {
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      })
      .catch(() => null);

    if (cached) {
      // Пользователь видит ответ мгновенно из кеша.
      // В фоне сеть обновит кеш — на следующем заходе будет уже свежее.
      networkPromise.catch(() => {});
      return cached;
    }

    // Кеша нет — придётся подождать сеть
    const fresh = await networkPromise;
    if (fresh) return fresh;
    return new Response("offline", { status: 503 });
  })());
});
