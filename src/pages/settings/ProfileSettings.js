import { html } from "htm/preact";
import { useState } from "preact/hooks";
import { useStore } from "../../lib/store.js";
import { CURRENCIES } from "../../lib/format.js";
import { Icon } from "../../lib/icons.js";

const WEEKDAYS = [
  { v: 1, label: "Понедельник" },
  { v: 0, label: "Воскресенье" },
  { v: 6, label: "Суббота" },
];

const NUMBER_FORMATS = [
  { v: "space", label: "1 234,56" },
  { v: "comma", label: "1,234.56" },
  { v: "none",  label: "1234.56" },
];

const THEMES = [
  { v: "light", label: "Светлая", icon: "sun" },
  { v: "dark",  label: "Тёмная",  icon: "moon" },
  { v: "auto",  label: "Авто",    icon: "auto" },
];

export function ProfileSettings() {
  const store = useStore();
  const { profile } = store;
  const [busy, setBusy] = useState(false);

  if (!profile) return null;

  async function update(patch) {
    setBusy(true);
    try {
      await store.actions.profile.update(patch);
    } catch (e) { store.pushToast("Не удалось сохранить", "error"); }
    finally { setBusy(false); }
  }

  return html`
    <div class="row cols-2" style="align-items:start;">
      <div class="card" style="padding:18px;">
        <h2 style="margin:0 0 14px;font-size:16px;">Внешний вид</h2>
        <div class="field">
          <label>Тема</label>
          <div class="seg" style="align-self:flex-start;">
            ${THEMES.map(t => html`
              <button key=${t.v}
                class=${profile.theme === t.v ? "active" : ""}
                onClick=${() => update({ theme: t.v })}
                disabled=${busy}>
                ${Icon[t.icon]()} <span style="margin-left:6px;">${t.label}</span>
              </button>
            `)}
          </div>
        </div>
      </div>

      <div class="card" style="padding:18px;">
        <h2 style="margin:0 0 14px;font-size:16px;">Финансы</h2>
        <div class="field">
          <label>Основная валюта</label>
          <select class="select" value=${profile.base_currency}
            onChange=${e => update({ base_currency: e.target.value })} disabled=${busy}>
            ${Object.entries(CURRENCIES).map(([code, c]) => html`
              <option value=${code} key=${code}>${code} — ${c.name} (${c.symbol})</option>
            `)}
          </select>
        </div>
        <div class="field" style="margin-top:14px;">
          <label>Формат сумм</label>
          <select class="select" value=${profile.number_format}
            onChange=${e => update({ number_format: e.target.value })} disabled=${busy}>
            ${NUMBER_FORMATS.map(f => html`<option value=${f.v} key=${f.v}>${f.label}</option>`)}
          </select>
        </div>
      </div>

      <div class="card" style="padding:18px;">
        <h2 style="margin:0 0 14px;font-size:16px;">Календарь</h2>
        <div class="field">
          <label>Первый день недели</label>
          <select class="select" value=${profile.first_day_of_week}
            onChange=${e => update({ first_day_of_week: Number(e.target.value) })} disabled=${busy}>
            ${WEEKDAYS.map(w => html`<option value=${w.v} key=${w.v}>${w.label}</option>`)}
          </select>
        </div>
        <div class="field" style="margin-top:14px;">
          <label>Начало финансового месяца (день)</label>
          <input class="input" type="number" min="1" max="28"
            value=${profile.financial_month_start}
            onChange=${e => update({ financial_month_start: Math.max(1, Math.min(28, Number(e.target.value) || 1)) })}
            disabled=${busy} />
          <div class="muted" style="font-size:12px;margin-top:4px;">
            Если зарплата приходит, например, 5-го числа — поставьте 5.
          </div>
        </div>
      </div>

      <div class="card" style="padding:18px;">
        <h2 style="margin:0 0 14px;font-size:16px;">Аккаунт</h2>
        <div class="muted" style="font-size:13px;">
          Email: <span style="color:var(--text);">${store.user?.email}</span>
        </div>
        <div class="muted" style="font-size:12px;margin-top:8px;">
          Чтобы выйти из аккаунта — нажмите «Выйти» в нижней части бокового меню.
        </div>
      </div>
    </div>
  `;
}
