import { html } from "htm/preact";
import { useState, useMemo } from "preact/hooks";
import { useStore } from "../lib/store.js";
import { formatAmount, parseAmount, formatDate } from "../lib/format.js";
import { Icon } from "../lib/icons.js";
import { Modal, ConfirmModal } from "../components/Modal.js";
import { AmountInput } from "../components/AmountInput.js";
import { renderIcon } from "../components/IconPicker.js";
import { navigate } from "../lib/router.js";

const COLORS = ["#16a34a", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#22c55e", "#14b8a6", "#f97316", "#6366f1"];

function balanceOf(account, operations) {
  if (!account) return 0;
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

export function GoalsPage() {
  const store = useStore();
  const { profile, goals, accounts, operations } = store;
  const fmt = (v) => formatAmount(v, profile?.base_currency || "RUB", profile?.number_format || "space");

  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const active = goals.filter(g => !g.archived).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  function progressFor(goal) {
    if (goal.account_id) {
      const acc = accounts.find(a => a.id === goal.account_id);
      return Math.max(0, balanceOf(acc, operations));
    }
    return Number(goal.current_amount || 0);
  }

  return html`
    <div class="page-head">
      <div>
        <h1>Цели накоплений</h1>
        <div class="sub">${active.length} ${active.length === 1 ? "цель" : "целей"}</div>
      </div>
      <div class="btn-row">
        <button class="btn primary" onClick=${() => setEditing("new")}>${Icon.plus()} Добавить цель</button>
      </div>
    </div>

    ${active.length === 0
      ? html`<div class="card empty">
          <div class="em-title">Цели — это про мечту с дедлайном</div>
          Заведите цель: например, отпуск или подушка безопасности.<br/><br/>
          <button class="btn primary" onClick=${() => setEditing("new")}>${Icon.plus()} Создать цель</button>
        </div>`
      : html`
        <div class="row" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;">
          ${active.map(g => {
            const acc = g.account_id ? accounts.find(a => a.id === g.account_id) : null;
            const target = Number(g.target_amount);
            const current = progressFor(g);
            const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
            const left = Math.max(0, target - current);
            return html`
              <div class="card" style="padding:18px;" key=${g.id}>
                <div class="between">
                  <div class="flex">
                    <span class="lr-icon" style=${`color:${g.color || "var(--accent)"};background:${(g.color || "#16a34a")}1f;`}>${Icon.goal()}</span>
                    <div>
                      <div style="font-weight:600;">${g.name}</div>
                      <div class="muted" style="font-size:12px;">
                        Цель ${fmt(target)}${g.due_date ? ` • до ${formatDate(g.due_date)}` : ""}
                      </div>
                    </div>
                  </div>
                  <div class="row-actions">
                    <button class="btn-mini" title="Изменить" onClick=${() => setEditing(g)}>${Icon.edit()}</button>
                    <button class="btn-mini" title="Удалить" onClick=${() => setConfirmDel(g)}>${Icon.trash()}</button>
                  </div>
                </div>
                <div style="margin-top:14px;font-size:22px;font-weight:700;letter-spacing:-0.02em;">
                  ${fmt(current)}
                  <span class="muted" style="font-size:14px;font-weight:500;"> • ${Math.round(pct)}%</span>
                </div>
                <div class="progress" style="margin-top:10px;">
                  <div style=${`width:${pct}%;background:${g.color || "var(--accent)"};`}></div>
                </div>
                <div class="between" style="margin-top:14px;">
                  <span class="muted" style="font-size:13px;">
                    ${left > 0 ? `Осталось ${fmt(left)}` : "Цель достигнута"}
                  </span>
                  ${acc
                    ? html`<span class="muted flex" style="font-size:12px;gap:4px;">${renderIcon(acc.icon, "wallet")} ${acc.name}</span>`
                    : html`<button class="btn sm ghost" onClick=${() => setEditing(g)}>Привязать счёт</button>`}
                </div>
              </div>
            `;
          })}
        </div>
      `}

    ${editing && html`
      <${GoalForm} initial=${editing === "new" ? null : editing} onClose=${() => setEditing(null)} />
    `}
    ${confirmDel && html`
      <${ConfirmModal}
        title="Удалить цель?"
        message="Сами операции и счета не пострадают."
        onCancel=${() => setConfirmDel(null)}
        onConfirm=${async () => { await store.actions.goals.remove(confirmDel.id); setConfirmDel(null); store.pushToast("Цель удалена", "success"); }}
      />
    `}
  `;
}

function GoalForm({ initial, onClose }) {
  const store = useStore();
  const { accounts } = store;
  const editing = !!initial;

  const visibleAccounts = useMemo(
    () => accounts.filter(a => !a.archived).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [accounts]
  );

  const [name, setName] = useState(initial?.name || "");
  const [target, setTarget] = useState(initial ? String(initial.target_amount) : "");
  const [accountId, setAccountId] = useState(initial?.account_id || "");
  const [dueDate, setDueDate] = useState(initial?.due_date || "");
  const [color, setColor] = useState(initial?.color || COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Дайте цели название"); return; }
    const t = parseAmount(target);
    if (!t || t <= 0) { setError("Целевая сумма должна быть больше нуля"); return; }
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        target_amount: t,
        account_id: accountId || null,
        due_date: dueDate || null,
        color,
      };
      if (editing) await store.actions.goals.update(initial.id, payload);
      else await store.actions.goals.create(payload);
      store.pushToast(editing ? "Цель обновлена" : "Цель создана", "success");
      onClose();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return html`
    <${Modal} title=${editing ? "Редактировать цель" : "Новая цель"} onClose=${onClose}
      footer=${html`
        <button class="btn ghost" onClick=${onClose}>Отмена</button>
        <button class="btn primary" disabled=${busy} onClick=${submit}>${busy ? "Сохранение…" : "Сохранить"}</button>
      `}
    >
      <form onSubmit=${submit} style="display:flex;flex-direction:column;gap:14px;">
        <div class="field">
          <label>Название</label>
          <input class="input" placeholder="Например: Отпуск в Италию"
            value=${name} onInput=${e => setName(e.target.value)} />
        </div>
        <div class="field">
          <label>Цель</label>
          <${AmountInput} value=${target} onChange=${setTarget} placeholder="0,00" />
        </div>
        <div class="field">
          <label>Счёт-копилка</label>
          ${visibleAccounts.length === 0
            ? html`<div class="notice">
                Сначала создайте счёт, на котором будет копиться сумма.
                <button type="button" class="btn sm" style="margin-left:8px;"
                  onClick=${() => { onClose(); navigate("settings/accounts"); }}>Перейти к счетам</button>
              </div>`
            : html`
              <select class="select" value=${accountId} onChange=${e => setAccountId(e.target.value)}>
                <option value="">— не привязывать —</option>
                ${visibleAccounts.map(a => html`<option value=${a.id} key=${a.id}>${a.name}</option>`)}
              </select>
              <div class="muted" style="font-size:12px;margin-top:4px;">
                Прогресс будет считаться по балансу выбранного счёта.
              </div>
            `}
        </div>
        <div class="field">
          <label>Дата (необязательно)</label>
          <input class="input" type="date" value=${dueDate} onInput=${e => setDueDate(e.target.value)} />
        </div>
        <div class="field">
          <label>Цвет</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${COLORS.map(c => html`
              <button type="button" key=${c}
                onClick=${() => setColor(c)}
                style=${`width:28px;height:28px;border-radius:50%;border:2px solid ${color === c ? "var(--text)" : "transparent"};background:${c};cursor:pointer;`}></button>
            `)}
          </div>
        </div>
        ${error && html`<div class="notice error">${error}</div>`}
      </form>
    <//>
  `;
}
