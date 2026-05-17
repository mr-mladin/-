// Service worker: network-first.
// Цель — всегда отдавать актуальные файлы. Старая стратегия
// stale-while-revalidate приводила к "лоскутному" кешу: часть файлов
// успевала обновиться, часть — нет, и приложение ломалось.
// Кеш теперь используется только как офлайн-фолбэк.

const CACHE = "fin-v3";

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try { await cache.addAll(["./", "./index.html"]); } catch (err) {}
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    // Сообщить открытым вкладкам, что есть новый SW — пусть перезагрузятся
    // и получат свежий набор файлов одним заходом, без Cmd+Shift+R.
    const clients = await self.clients.matchAll({ type: "window" });
    for (const c of clients) c.postMessage({ type: "sw-updated" });
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Только наш origin (Supabase / esm.sh браузер кеширует сам).
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (err) {
      const cached = await cache.match(req);
      if (cached) return cached;
      if (req.mode === "navigate") {
        const idx = (await cache.match("./index.html")) || (await cache.match("./"));
        if (idx) return idx;
      }
      return new Response("offline", { status: 503, statusText: "Offline" });
    }
  })());
});
