import { html } from "htm/preact";
import { useState, useMemo } from "preact/hooks";
import { useStore } from "../../lib/store.js";
import { CURRENCIES, formatAmount, parseAmount } from "../../lib/format.js";
import { Icon } from "../../lib/icons.js";
import { Modal, ConfirmModal } from "../../components/Modal.js";

const COLORS = ["#6366f1", "#10b981", "#0ea5e9", "#f59e0b", "#ec4899", "#8b5cf6", "#22c55e", "#ef4444", "#06b6d4", "#94a3b8"];

export function AccountsSettings() {
  const store = useStore();
  const { profile, accounts, operations } = store;
  const fmt = (v, c) => formatAmount(v, c, profile?.number_format || "space");

  const [editing, setEditing] = useState(null);   // null | "new" | account
  const [confirmDel, setConfirmDel] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const sorted = useMemo(() =>
    [...accounts].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [accounts]);

  const visible = sorted.filter(a => showArchived ? true : !a.archived);
  const visibleActive = sorted.filter(a => !a.archived);

  function balance(account) {
    let bal = Number(account.initial_balance || 0);
    for (const op of operations) {
      if (op.account_id === account.id) {
        if (op.kind === "income") bal += Number(op.amount);
        else if (op.kind === "expense" || op.kind === "transfer") bal -= Number(op.amount);
      }
      if (op.to_account_id === account.id && op.kind === "transfer") {
        bal += Number(op.to_amount || op.amount);
      }
    }
    return bal;
  }

  return html`
    <div class="card">
      <div class="section-head" style="padding:16px 18px 8px;">
        <h2>Счета</h2>
        <div class="btn-row">
          <button class="btn ghost sm" onClick=${() => setShowArchived(s => !s)}>
            ${showArchived ? "Скрыть архив" : "Показать архив"}
          </button>
          <button class="btn primary sm" onClick=${() => setEditing("new")}>${Icon.plus()} Новый счёт</button>
        </div>
      </div>
      ${visible.length === 0
        ? html`<div class="empty">
            <div class="em-title">Создайте первый счёт</div>
            Это может быть карта, наличные, депозит — что угодно.<br/><br/>
            <button class="btn primary" onClick=${() => setEditing("new")}>${Icon.plus()} Создать</button>
          </div>`
        : html`
          <div class="list">
            ${visible.map(a => {
              const bal = balance(a);
              const idx = visibleActive.findIndex(x => x.id === a.id);
              return html`
                <div class="list-row" key=${a.id}>
                  <div class="lr-icon" style=${`color:${a.color || "var(--accent)"};`}>${Icon.wallet()}</div>
                  <div class="lr-main">
                    <div class="lr-title">
                      ${a.name}
                      ${a.archived && html`<span class="chip" style="margin-left:8px;font-size:11px;">архив</span>`}
                    </div>
                    <div class="lr-sub">${a.currency || "RUB"} • стартовый ${fmt(a.initial_balance, a.currency)}</div>
                  </div>
                  <div class="lr-amount">${fmt(bal, a.currency)}</div>
                  <div class="row-actions" style="margin-left:8px;">
                    ${!a.archived && html`
                      <button class="btn-mini" title="Выше"
                        onClick=${() => store.accounts.move(a.id, -1)}
                        disabled=${idx <= 0}>${Icon.up()}</button>
                      <button class="btn-mini" title="Ниже"
                        onClick=${() => store.accounts.move(a.id, +1)}
                        disabled=${idx >= visibleActive.length - 1}>${Icon.down()}</button>
                    `}
                    <button class="btn-mini" title="Изменить" onClick=${() => setEditing(a)}>${Icon.edit()}</button>
                    <button class="btn-mini" title="Удалить" onClick=${() => setConfirmDel(a)}>${Icon.trash()}</button>
                  </div>
                </div>
              `;
            })}
          </div>
        `}
    </div>

    ${editing && html`
      <${AccountForm} initial=${editing === "new" ? null : editing} onClose=${() => setEditing(null)} />
    `}
    ${confirmDel && html`
      <${ConfirmModal}
        title="Удалить счёт?"
        message=${html`<div>Если на счёте есть операции — удалить не получится. Тогда заархивируйте его (откройте на редактирование).</div>`}
        onCancel=${() => setConfirmDel(null)}
        onConfirm=${async () => {
          try { await store.accounts.remove(confirmDel.id); store.pushToast("Счёт удалён", "success"); }
          catch (e) { store.pushToast("Сначала удалите все операции этого счёта или заархивируйте его", "error"); }
          setConfirmDel(null);
        }}
      />
    `}
  `;
}

function AccountForm({ initial, onClose }) {
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
      if (editing) await store.accounts.update(initial.id, payload);
      else await store.accounts.create(payload);
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
            <input class="input amount" inputmode="decimal" value=${initialBalance}
              onInput=${e => setInitialBalance(e.target.value)} />
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
