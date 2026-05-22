// Service worker планера: cache-first с фоновой ревалидацией.
// Кеш отдаём мгновенно, свежую версию тянем в фоне — она появляется
// при следующем заходе. Кросс-доменные запросы (Supabase, CDN) не трогаем.

const CACHE = "planner-v1";
const CORE = ["./", "./index.html", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

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
