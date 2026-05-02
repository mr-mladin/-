// Service worker: network-first для собственных файлов сайта.
// Цель — чтобы любой деплой подхватывался сразу, без долгого кеша.
// Если сеть недоступна — отдаём из кеша (offline-fallback).

const CACHE = "fin-v1";

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
  // Применяем стратегию только к файлам нашего origin (не к Supabase, не к esm.sh)
  if (url.origin !== self.location.origin) return;

  // Network-first: пытаемся получить из сети, при неудаче — из кеша.
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: "no-store" });
      if (fresh && fresh.status === 200) {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw err;
    }
  })());
});
