// ВЫКЛЮЧАТЕЛЬ service worker планера.
// Раньше здесь был кэширующий SW (cache-first). Он мог «залипнуть» и отдавать
// старую/битую версию — отсюда бесконечная загрузка на части устройств.
// Этот вариант ничего не кэширует: при активации он чистит все кэши, снимает
// собственную регистрацию и перезагружает открытые вкладки — после чего
// страница грузится напрямую из сети, как обычный сайт. Установка на экран
// Домой продолжает работать (через manifest), просто без офлайн-кэша.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: "window" });
    for (const c of clients) { try { await c.navigate(c.url); } catch (err) {} }
  })());
});

// Запросы не перехватываем — всегда из сети.
