import { html } from "htm/preact";
import { useEffect, useState } from "preact/hooks";
import { useStore } from "../lib/store.js";
import { href, navigate } from "../lib/router.js";
import { Icon } from "../lib/icons.js";

const NAV = [
  { name: "dashboard", label: "Главная",   icon: "dashboard" },
  { name: "budgets",    label: "Бюджеты",  icon: "budget" },
  { name: "goals",      label: "Цели",     icon: "goal" },
  { name: "settings",   label: "Настройки", icon: "settings" },
];

export function Layout({ active, children }) {
  const { user, auth } = useStore();
  const [open, setOpen] = useState(false);

  // Закрываем меню при смене маршрута
  useEffect(() => { setOpen(false); }, [active]);

  // Esc → закрыть
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return html`
    <div class="app-shell">
      <button class="menu-btn ${open ? "is-open" : ""}"
        onClick=${() => setOpen(o => !o)}
        aria-label=${open ? "Закрыть меню" : "Открыть меню"}>
        ${open ? Icon.close() : Icon.menu()}
      </button>

      <div class="menu-overlay ${open ? "open" : ""}" aria-hidden=${!open}>
        <div class="menu-backdrop" onClick=${() => setOpen(false)}></div>
        <nav class="menu-panel glass">
          <div class="brand" style="padding:6px 10px 18px;">
            <span class="brand-mark">₽</span>
            <span>Финансы</span>
          </div>
          <div class="nav">
            ${NAV.map(item => html`
              <a class=${active === item.name ? "active" : ""}
                href=${href(item.name)}
                onClick=${() => setOpen(false)}
                key=${item.name}>
                ${Icon[item.icon]()} <span>${item.label}</span>
              </a>
            `)}
          </div>
          <div class="menu-foot">
            <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Аккаунт</div>
            <div class="email">${user?.email}</div>
          </div>
        </nav>
      </div>

      <div class="page">${children}</div>
    </div>
  `;
}
