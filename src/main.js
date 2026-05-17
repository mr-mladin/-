import { render } from "preact";
import { html } from "htm/preact";
import { StoreProvider } from "./lib/store.js";
import { App } from "./App.js";

render(
  html`<${StoreProvider}><${App} /></${StoreProvider}>`,
  document.getElementById("app")
);

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
