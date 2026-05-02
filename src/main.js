import { render } from "preact";
import { html } from "htm/preact";
import { StoreProvider } from "./lib/store.js";
import { App } from "./App.js";

render(
  html`<${StoreProvider}><${App} /></${StoreProvider}>`,
  document.getElementById("app")
);

// Регистрация service worker — чтобы новые деплои подхватывались сразу
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
