// ВЫКЛЮЧАТЕЛЬ service worker планера.
// Раньше здесь был кэширующий SW (cache-first) — он мог залипать.
// Этот вариант ничего не кэширует и при активации аккуратно убирает только
// следы планера: чистит СВОИ кэши (по префиксу "planner") и снимает свою
// регистрацию. Чужие приложения (финансы, корень) не трогает, страницу
// принудительно не перезагружает. Установка на экран Домой работает через
// manifest, просто без офлайн-кэша.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("planner")).map(k => caches.delete(k)));
    await self.registration.unregister();
  })());
});

// Запросы не перехватываем — всегда из сети.
