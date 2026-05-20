// Корневой service worker заменён на «выключатель».
// Финансовое приложение переехало в /finance/ (свой service worker со своей
// областью). Этот SW нужен только чтобы у уже установленных клиентов снять
// прежнюю корневую регистрацию и очистить старый кэш — иначе браузер мог бы
// продолжать отдавать старую версию из корня.

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
