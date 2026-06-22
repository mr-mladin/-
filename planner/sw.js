// Service worker планера. Стратегия — «сеть в приоритете, кэш как запас»:
//  • Библиотеки с CDN (esm.sh, фиксированные версии) — cache-first: мгновенный
//    холодный старт, в т.ч. с домашней иконки.
//  • Файлы самого приложения (html/js/css) — всегда тянем свежие из сети (любая
//    правка подхватывается сразу, без «залипания»), НО успешный ответ кладём в
//    кэш и при сетевом сбое/тайм-ауте отдаём его. Это спасает от «вечной крутилки»
//    на плохом мобильном интернете: приложение стартует из кэша, а не висит.

// Версию кэша бампаем вместе с релизом — на activate старые кэши удаляются (ниже),
// чтобы один раз осевший «битый»/устаревший файл не жил вечно.
const VERSION = "v3";
const CDN_CACHE = "planner-cdn-" + VERSION;
const APP_CACHE = "planner-app-" + VERSION;
const CDN_HOSTS = ["esm.sh"];
const NET_TIMEOUT = 7000; // дольше не ждём ответ — иначе старт «висит» на плохой сети

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith("planner") && k !== CDN_CACHE && k !== APP_CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// fetch с тайм-аутом — чтобы зависший запрос не держал старт приложения вечно.
function fetchTimeout(req, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NET_TIMEOUT);
  return fetch(req, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Библиотеки с CDN (фиксированные версии) — из кэша: быстрый холодный старт.
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(CDN_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetchTimeout(req);
      // Только успешные CORS-ответы (не opaque/ошибки): иначе «битый» модуль осядет
      // в cache-first навсегда и даст белый экран, не лечащийся перезагрузкой.
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  // Свои файлы (тот же origin) — сеть в приоритете (свежие правки, минуя HTTP-кэш
  // браузера), но успешный ответ кэшируем и при сбое/тайм-ауте отдаём из кэша,
  // чтобы приложение запустилось даже на плохой сети, а не висело на крутилке.
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      try {
        const res = await fetchTimeout(req, { cache: "reload" });
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (err) {
        const cached = await cache.match(req, { ignoreSearch: true }) || await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        // Навигация офлайн без точного совпадения — отдаём закэшированную оболочку,
        // чтобы не было белого экрана при запуске с иконки без сети.
        if (req.mode === "navigate") {
          const shell = await cache.match("./", { ignoreSearch: true }) || await cache.match("./index.html", { ignoreSearch: true });
          if (shell) return shell;
        }
        throw err;
      }
    })());
  }
  // Остальное (например, Supabase) — не трогаем.
});
