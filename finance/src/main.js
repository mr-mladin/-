import { render } from "preact";
import { html } from "htm/preact";
import { StoreProvider } from "./lib/store.js";
import { App } from "./App.js";

render(
  html`<${StoreProvider}><${App} /></${StoreProvider}>`,
  document.getElementById("app")
);

// Авто-скрытие полосы прокрутки: ставим .is-scrolling на <html>, пока юзер
// скроллит, и снимаем через 700мс после остановки. CSS прячет/показывает
// thumb через transition — получается мягкое появление/исчезновение.
{
  let scrollTimer = null;
  function onScroll() {
    const root = document.documentElement;
    root.classList.add("is-scrolling");
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => root.classList.remove("is-scrolling"), 700);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
}

// Регистрация service worker. Обновлённую версию пользователь увидит при
// следующем заходе (cache-first + фоновая ревалидация). Без авто-перезагрузки —
// она давала риск циклических релоадов при стечении обстоятельств.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
