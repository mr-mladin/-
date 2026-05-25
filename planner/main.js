import { render } from "preact";
import { html } from "htm/preact";
import { StoreProvider } from "./store.js";
import { App } from "./Planner.js";

// Высоту приложения задаём из реального innerHeight: iOS Safari (особенно с
// иконки на домашнем экране) на старте считает 100dvh неверно — отсюда пустое
// место снизу и «съезды». Обновляем при ресайзе/повороте/возврате.
function setAppHeight() {
  document.documentElement.style.setProperty("--app-h", window.innerHeight + "px");
}
setAppHeight();
addEventListener("resize", setAppHeight);
addEventListener("orientationchange", () => setTimeout(setAppHeight, 120));
addEventListener("pageshow", setAppHeight);
if (window.visualViewport) window.visualViewport.addEventListener("resize", setAppHeight);

render(html`<${StoreProvider}><${App} /><//>`, document.getElementById("app"));
window.__appBooted = true;
requestAnimationFrame(setAppHeight);

// Полоса прокрутки видна только во время прокрутки: ставим .is-scrolling на
// <html>, пока пользователь скроллит, и снимаем через 700мс после остановки.
// CSS прячет/показывает «бегунок» через transition — мягкое появление/исчезновение.
// Слушаем в фазе захвата (capture), чтобы ловить и прокрутку внутренних областей.
{
  let scrollTimer = null;
  window.addEventListener("scroll", () => {
    const root = document.documentElement;
    root.classList.add("is-scrolling");
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => root.classList.remove("is-scrolling"), 700);
  }, { passive: true, capture: true });
}

