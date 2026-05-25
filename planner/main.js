import { render } from "preact";
import { html } from "htm/preact";
import { StoreProvider } from "./store.js";
import { App } from "./Planner.js";

// iOS на первом кадре считает высоту экрана коротко (и 100dvh, и innerHeight),
// а «дозревает» она только после взаимодействия — отсюда серый пробел и съезды.
// Берём реальную видимую высоту из visualViewport и несколько раз пере-замеряем
// после загрузки + на любые изменения вьюпорта, чтобы не нужно было тапать.
function setAppHeight() {
  const vv = window.visualViewport;
  const h = vv && vv.height ? vv.height : window.innerHeight;
  if (h) document.documentElement.style.setProperty("--app-h", Math.round(h) + "px");
}
setAppHeight();
[60, 200, 500, 1000].forEach((d) => setTimeout(setAppHeight, d));
addEventListener("resize", setAppHeight);
addEventListener("orientationchange", () => setTimeout(setAppHeight, 200));
addEventListener("pageshow", setAppHeight);
addEventListener("load", setAppHeight);
if (window.visualViewport) {
  visualViewport.addEventListener("resize", setAppHeight);
  visualViewport.addEventListener("scroll", setAppHeight);
}

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

