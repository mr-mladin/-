import { html } from "htm/preact";
import { useStore } from "../lib/store.js";
import { href } from "../lib/router.js";
import { Icon } from "../lib/icons.js";

const NAV = [
  { name: "dashboard", label: "Главная",   icon: "dashboard" },
  { name: "operations", label: "Операции", icon: "list" },
  { name: "budgets",    label: "Бюджеты",  icon: "budget" },
  { name: "goals",      label: "Цели",     icon: "goal" },
  { name: "settings",   label: "Настройки", icon: "settings" },
];

export function Layout({ active, children }) {
  const { user } = useStore();

  return html`
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark">₽</span>
          <span>Финансы</span>
        </div>
        <nav class="nav">
          ${NAV.map(item => html`
            <a class=${active === item.name ? "active" : ""} href=${href(item.name)} key=${item.name}>
              ${Icon[item.icon]()} <span>${item.label}</span>
            </a>
          `)}
        </nav>
        <div class="sidebar-foot">
          <div class="user">
            <span class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Аккаунт</span>
            <span class="email">${user?.email}</span>
          </div>
        </div>
      </aside>

      <main>
        <div class="mobile-bar glass">
          <div class="brand">
            <span class="brand-mark">₽</span>
            <span>Финансы</span>
          </div>
        </div>
        <div class="content">
          ${children}
        </div>
      </main>

      <nav class="mobile-tabs glass">
        ${NAV.map(item => html`
          <a class=${active === item.name ? "active" : ""} href=${href(item.name)} key=${item.name}>
            ${Icon[item.icon]()}
            <span>${item.label}</span>
          </a>
        `)}
      </nav>
    </div>
  `;
}
