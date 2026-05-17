// Service worker: cache-first со фоновой ревалидацией.
// При наличии кеша отдаём его мгновенно, а в фоне без блокировки тянем
// свежую версию и обновляем кеш. Это устраняет "зависающие" загрузки на
// медленной сети — пользователь всегда получает страницу сразу.
// Когда выходит новая версия SW (бамп CACHE), мы шлём вкладкам сигнал на
// одну автоперезагрузку, чтобы они подхватили согласованный набор файлов.

const CACHE = "fin-v4";
const CORE = ["./", "./index.html"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try { await cache.addAll(CORE); } catch (err) {}
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window" });
    for (const c of clients) c.postMessage({ type: "sw-updated" });
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);

    // Тихая фоновая ревалидация — не блокирует ответ
    const revalidate = fetch(req)
      .then(res => {
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      })
      .catch(() => null);

    if (cached) {
      // Запускаем revalidate в фоне, но возвращаем кеш сразу
      revalidate.catch(() => {});
      return cached;
    }

    // Кеша нет — ждём сеть, но не дольше 6 секунд
    let fresh = null;
    try {
      fresh = await Promise.race([
        revalidate,
        new Promise(resolve => setTimeout(() => resolve(null), 6000)),
      ]);
    } catch (err) {}
    if (fresh) return fresh;

    // Последняя попытка: вдруг revalidate успел что-то положить
    const c2 = await cache.match(req);
    if (c2) return c2;

    if (req.mode === "navigate") {
      const idx = (await cache.match("./index.html")) || (await cache.match("./"));
      if (idx) return idx;
    }
    return new Response("offline", { status: 503, statusText: "Offline" });
  })());
});
