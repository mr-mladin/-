import { render } from "preact";
import { html } from "htm/preact";
import { StoreProvider } from "./store.js";
import { App } from "./Planner.js?v=131";

// Высоту приложения держит CSS: html/body зафиксированы по размеру экрана
// (position: fixed; inset: 0), .app = 100%. Документ не прокручивается, поэтому
// iOS-«съезды» и пробелы снизу больше не возникают — отдельный пересчёт высоты
// через JS не нужен.

render(html`<${StoreProvider}><${App} /><//>`, document.getElementById("app"));
window.__appBooted = true;

// Полоса прокрутки видна только во время прокрутки: ставим .is-scrolling на
// <html>, пока пользователь скроллит, и снимаем через 700мс после остановки.
// CSS прячет/показывает «бегунок» через transition — мягкое появление/исчезновение.
// Слушаем в фазе захвата (capture), чтобы ловить и прокрутку внутренних областей.
{
  const root = document.documentElement;
  let scrollTimer = null, scrolling = false, lastReset = 0;
  window.addEventListener("scroll", () => {
    if (!scrolling) { scrolling = true; root.classList.add("is-scrolling"); }
    // Сбрасываем таймер не чаще раза в 100мс — иначе во время инерционного свайпа
    // пересоздаются сотни таймеров/сек ровно там, где боремся за плавность.
    const now = Date.now();
    if (now - lastReset > 100) {
      lastReset = now;
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => { scrolling = false; root.classList.remove("is-scrolling"); }, 700);
    }
  }, { passive: true, capture: true });
}
