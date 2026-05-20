import { html } from "htm/preact";
import { useStore } from "../lib/store.js";
import { href, navigate } from "../lib/router.js";
import { Icon } from "../lib/icons.js";
import { ProfileSettings } from "./settings/ProfileSettings.js";
import { AccountsSettings } from "./settings/AccountsSettings.js";
import { CategoriesSettings } from "./settings/CategoriesSettings.js";
import { TagsSettings } from "./settings/TagsSettings.js";
import { DataSettings } from "./settings/DataSettings.js";

const TABS = [
  { id: "profile",    label: "Общие" },
  { id: "accounts",   label: "Счета" },
  { id: "categories", label: "Категории" },
  { id: "tags",       label: "Теги" },
  { id: "data",       label: "Данные" },
];

export function SettingsPage({ segments }) {
  const active = TABS.find(t => t.id === segments?.[0])?.id || "profile";

  let content;
  switch (active) {
    case "accounts":   content = html`<${AccountsSettings} />`; break;
    case "categories": content = html`<${CategoriesSettings} />`; break;
    case "tags":       content = html`<${TagsSettings} />`; break;
    case "data":       content = html`<${DataSettings} />`; break;
    default:           content = html`<${ProfileSettings} />`;
  }

  return html`
    <div class="page-head">
      <div>
        <h1>Настройки</h1>
        <div class="sub">Личные предпочтения и управление сущностями</div>
      </div>
    </div>

    <div class="seg" style="margin-bottom:18px;flex-wrap:wrap;">
      ${TABS.map(t => html`
        <button key=${t.id}
          class=${active === t.id ? "active" : ""}
          onClick=${() => navigate("settings/" + t.id)}>
          ${t.label}
        </button>
      `)}
    </div>

    ${content}
  `;
}
