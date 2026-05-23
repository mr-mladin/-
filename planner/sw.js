// Service worker планера: быстрый запуск и работа офлайн.
//
// Стратегия:
//  • Свой origin (HTML, JS, CSS, иконки) — stale-while-revalidate:
//    мгновенно отдаём из кэша, в фоне тихо тянем свежую версию и кладём в кэш.
//    Новые правки видны при следующем заходе. Если кэша ещё нет — ждём сеть
//    (с тайм-аутом), чтобы не висеть бесконечно.
//  • CDN-модули (esm.sh: preact, htm, supabase) — cache-first навсегда.
//    Их адреса привязаны к версии и не меняются, поэтому грузим один раз и
//    дальше отдаём из кэша мгновенно (это самая тяжёлая часть загрузки).
//
// Авто-перезагрузку клиентов не делаем — чтобы не словить циклы релоадов.

const CACHE = "planner-v1";
const CDN_CACHE = "planner-cdn-v1";
const CORE = [
  "./", "./index.html", "./main.js", "./Planner.js",
  "./store.js", "./lib.js", "./components.js", "./styles.css",
];
const CDN_HOSTS = ["esm.sh"];

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
    await Promise.all(
      keys.filter(k => k !== CACHE && k !== CDN_CACHE && k.startsWith("planner"))
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // CDN-модули: cache-first (неизменяемые версии).
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(CDN_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (err) {
        return new Response("offline", { status: 503, statusText: "Offline" });
      }
    })());
    return;
  }

  // Свой origin: stale-while-revalidate.
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const revalidate = fetch(req)
      .then(res => { if (res && res.ok) cache.put(req, res.clone()).catch(() => {}); return res; })
      .catch(() => null);

    if (cached) { revalidate.catch(() => {}); return cached; }

    let fresh = null;
    try {
      fresh = await Promise.race([
        revalidate,
        new Promise(resolve => setTimeout(() => resolve(null), 6000)),
      ]);
    } catch (err) {}
    if (fresh) return fresh;

    const c2 = await cache.match(req);
    if (c2) return c2;

    if (req.mode === "navigate") {
      const idx = (await cache.match("./index.html")) || (await cache.match("./"));
      if (idx) return idx;
    }
    return new Response("offline", { status: 503, statusText: "Offline" });
  })());
});
