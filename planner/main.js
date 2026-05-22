import { render } from "preact";
import { html } from "htm/preact";
import { StoreProvider } from "./store.js";
import { App } from "./Planner.js";

render(html`<${StoreProvider}><${App} /><//>`, document.getElementById("app"));

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

