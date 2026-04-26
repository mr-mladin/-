import { html } from "htm/preact";
import { useState } from "preact/hooks";
import { useStore } from "../lib/store.js";
import { CURRENCIES, parseAmount } from "../lib/format.js";
import { Modal } from "./Modal.js";
import { AmountInput } from "./AmountInput.js";

const COLORS = ["#16a34a", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#22c55e", "#14b8a6", "#f97316", "#6366f1", "#94a3b8"];

export function AccountForm({ initial, onClose }) {
  const store = useStore();
  const editing = !!initial;
  const [name, setName] = useState(initial?.name || "");
  const [currency, setCurrency] = useState(initial?.currency || store.profile?.base_currency || "RUB");
  const [initialBalance, setInitialBalance] = useState(initial ? String(initial.initial_balance) : "0");
  const [color, setColor] = useState(initial?.color || COLORS[0]);
  const [archived, setArchived] = useState(initial?.archived || false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Название обязательно"); return; }
    const bal = parseAmount(initialBalance);
    if (isNaN(bal)) { setError("Стартовый баланс должен быть числом"); return; }
    setBusy(true);
    try {
      const payload = { name: name.trim(), currency, initial_balance: bal, color, archived };
      if (editing) await store.actions.accounts.update(initial.id, payload);
      else await store.actions.accounts.create(payload);
      store.pushToast(editing ? "Счёт обновлён" : "Счёт создан", "success");
      onClose();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return html`
    <${Modal} title=${editing ? "Редактировать счёт" : "Новый счёт"} onClose=${onClose}
      footer=${html`
        <button class="btn ghost" onClick=${onClose}>Отмена</button>
        <button class="btn primary" disabled=${busy} onClick=${submit}>${busy ? "Сохраняю…" : "Сохранить"}</button>
      `}
    >
      <form onSubmit=${submit} style="display:flex;flex-direction:column;gap:14px;">
        <div class="field">
          <label>Название</label>
          <input class="input" placeholder="Например: Тинькофф Black"
            value=${name} onInput=${e => setName(e.target.value)} />
        </div>
        <div class="row cols-2">
          <div class="field">
            <label>Валюта</label>
            <select class="select" value=${currency} onChange=${e => setCurrency(e.target.value)}>
              ${Object.entries(CURRENCIES).map(([code, c]) => html`
                <option value=${code} key=${code}>${code} ${c.symbol}</option>
              `)}
            </select>
          </div>
          <div class="field">
            <label>Стартовый баланс</label>
            <${AmountInput} value=${initialBalance} onChange=${setInitialBalance} />
          </div>
        </div>
        <div class="field">
          <label>Цвет</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${COLORS.map(c => html`
              <button type="button" key=${c} onClick=${() => setColor(c)}
                style=${`width:28px;height:28px;border-radius:50%;border:2px solid ${color === c ? "var(--text)" : "transparent"};background:${c};cursor:pointer;`}></button>
            `)}
          </div>
        </div>
        ${editing && html`
          <label class="flex" style="cursor:pointer;">
            <span class=${"toggle " + (archived ? "on" : "")} onClick=${() => setArchived(a => !a)}></span>
            <span>В архиве (скрыт из выбора при добавлении операций)</span>
          </label>
        `}
        ${error && html`<div class="notice error">${error}</div>`}
      </form>
    <//>
  `;
}
