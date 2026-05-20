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

// Регистрация service worker — чтобы новые деплои подхватывались сразу.
// При активации новой версии SW он шлёт сообщение — мы один раз перезагружаем
// страницу, чтобы получить полностью свежий набор файлов без Cmd+Shift+R.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "sw-updated" && !sessionStorage.getItem("fin.sw.reloaded")) {
      sessionStorage.setItem("fin.sw.reloaded", "1");
      window.location.reload();
    }
  });
}
