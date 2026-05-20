import { html } from "htm/preact";
import { useMemo, useState } from "preact/hooks";
import { useStore } from "../lib/store.js";
import {
  formatAmount, parseAmount, toISO,
  startOfFinMonth, endOfFinMonth, shiftFinMonth, finMonthLabel,
} from "../lib/format.js";
import { Icon } from "../lib/icons.js";
import { Modal, ConfirmModal } from "../components/Modal.js";
import { AmountInput } from "../components/AmountInput.js";
import { renderIcon } from "../components/IconPicker.js";

export function BudgetsPage() {
  const store = useStore();
  const { profile, categories, operations, budgets } = store;

  const [editing, setEditing] = useState(null); // { categoryId, amount } | "new"
  const [confirmDel, setConfirmDel] = useState(null);
  const [monthOffset, setMonthOffset] = useState(0);

  const fmt = (v) => formatAmount(v, profile?.base_currency || "RUB", profile?.number_format || "space");
  const finStart = profile?.financial_month_start || 1;

  const monthAnchor = useMemo(() => shiftFinMonth(new Date(), monthOffset, finStart), [monthOffset, finStart]);
  const monthStart = startOfFinMonth(monthAnchor, finStart);
  const monthEnd = endOfFinMonth(monthAnchor, finStart);
  const startISO = toISO(monthStart);
  const endISO = toISO(monthEnd);

  // Расход по категории (включая подкатегории) за выбранный период
  function spentByCategory(catId) {
    const ids = new Set([catId, ...categories.filter(c => c.parent_id === catId).map(c => c.id)]);
    return operations
      .filter(o => o.kind === "expense" && o.date >= startISO && o.date <= endISO && o.category_id && ids.has(o.category_id))
      .reduce((s, o) => s + Number(o.amount), 0);
  }

  const monthBudgets = budgets.filter(b => b.period === "month");
  const rows = monthBudgets
    .map(b => {
      const cat = categories.find(c => c.id === b.category_id);
      if (!cat || cat.kind !== "expense") return null;
      const spent = spentByCategory(cat.id);
      const limit = Number(b.amount);
      const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
      return { budget: b, category: cat, spent, limit, pct, over: spent > limit };
    })
    .filter(Boolean)
    .sort((a, b) => b.pct - a.pct);

  const totalLimit = rows.reduce((s, r) => s + r.limit, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);

  return html`
    <div class="page-head">
      <div>
        <h1>Бюджеты</h1>
        <div class="sub">${finMonthLabel(monthStart)} • Лимит ${fmt(totalLimit)}, потрачено ${fmt(totalSpent)}</div>
      </div>
      <div class="btn-row">
        <button class="btn" onClick=${() => setMonthOffset(o => o - 1)}>${Icon.left()}</button>
        ${monthOffset !== 0 && html`<button class="btn ghost" onClick=${() => setMonthOffset(0)}>Сейчас</button>`}
        <button class="btn" onClick=${() => setMonthOffset(o => o + 1)} disabled=${monthOffset >= 0}>${Icon.right()}</button>
        <button class="btn primary" onClick=${() => setEditing("new")}>${Icon.plus()} Добавить</button>
      </div>
    </div>

    ${rows.length === 0
      ? html`<div class="card empty">
          <div class="em-title">Бюджетов пока нет</div>
          Установите лимит на категорию расходов, чтобы видеть, как идёте по плану.<br/><br/>
          <button class="btn primary" onClick=${() => setEditing("new")}>${Icon.plus()} Добавить первый бюджет</button>
        </div>`
      : html`
        <div class="row" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;">
          ${rows.map(({ budget, category, spent, limit, pct, over }) => html`
            <div class="card" style="padding:18px;" key=${budget.id}>
              <div class="between">
                <div class="flex">
                  <span class="lr-icon" style=${`color:${category.color || "var(--accent)"};background:${(category.color || "#16a34a")}1f;width:32px;height:32px;flex:0 0 32px;border-radius:9px;`}>${renderIcon(category.icon, "tag")}</span>
                  <div>
                    <div style="font-weight:600;">${category.name}</div>
                    <div class="muted" style="font-size:12px;">из ${fmt(limit)}</div>
                  </div>
                </div>
                <div class="row-actions">
                  <button class="btn-mini" title="Изменить"
                    onClick=${() => setEditing({ categoryId: category.id, amount: limit })}>${Icon.edit()}</button>
                  <button class="btn-mini" title="Удалить"
                    onClick=${() => setConfirmDel(budget)}>${Icon.trash()}</button>
                </div>
              </div>
              <div style="margin-top:14px;font-size:22px;font-weight:700;letter-spacing:-0.02em;"
                   class=${over ? "" : ""}>
                <span style=${over ? "color:var(--expense);" : ""}>${fmt(spent)}</span>
                <span class="muted" style="font-size:14px;font-weight:500;">
                  ${over ? ` • перерасход ${fmt(spent - limit)}` : ` • осталось ${fmt(limit - spent)}`}
                </span>
              </div>
              <div class=${"progress " + (over ? "over" : "expense")} style="margin-top:10px;">
                <div style=${`width:${pct}%;background:${over ? "var(--expense)" : (category.color || "var(--accent)")};`}></div>
              </div>
            </div>
          `)}
        </div>
      `}

    ${editing && html`
      <${BudgetForm}
        initial=${editing === "new" ? null : editing}
        onClose=${() => setEditing(null)}
      />
    `}
    ${confirmDel && html`
      <${ConfirmModal}
        title="Удалить бюджет?"
        message="Сами операции останутся."
        onCancel=${() => setConfirmDel(null)}
        onConfirm=${async () => { await store.actions.budgets.remove(confirmDel.id); setConfirmDel(null); store.pushToast("Бюджет удалён", "success"); }}
      />
    `}
  `;
}

function BudgetForm({ initial, onClose }) {
  const store = useStore();
  const { categories, budgets } = store;
  const editing = !!initial;
  const expenseTopCats = categories.filter(c => c.kind === "expense" && !c.parent_id && !c.archived)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const usedIds = new Set(budgets.filter(b => b.period === "month").map(b => b.category_id));
  const available = expenseTopCats.filter(c => editing && c.id === initial.categoryId ? true : !usedIds.has(c.id));

  const [categoryId, setCategoryId] = useState(initial?.categoryId || available[0]?.id || "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    const amt = parseAmount(amount);
    if (!amt || amt <= 0) { setError("Укажите сумму больше нуля"); return; }
    if (!categoryId) { setError("Выберите категорию"); return; }
    setBusy(true);
    try {
      await store.actions.budgets.upsert({ category_id: categoryId, amount: amt, period: "month" });
      store.pushToast(editing ? "Бюджет обновлён" : "Бюджет добавлен", "success");
      onClose();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return html`
    <${Modal} title=${editing ? "Изменить бюджет" : "Новый бюджет"} onClose=${onClose}
      footer=${html`
        <button class="btn ghost" onClick=${onClose}>Отмена</button>
        <button class="btn primary" disabled=${busy} onClick=${submit}>${busy ? "Сохраняю…" : "Сохранить"}</button>
      `}
    >
      <form onSubmit=${submit} style="display:flex;flex-direction:column;gap:14px;">
        <div class="field">
          <label>Категория расходов</label>
          ${available.length === 0
            ? html`<div class="notice">Все категории расходов уже имеют бюджет. Удалите ненужный, чтобы добавить новый.</div>`
            : html`
              <select class="select" value=${categoryId} onChange=${e => setCategoryId(e.target.value)} disabled=${editing}>
                ${available.map(c => html`<option value=${c.id} key=${c.id}>${c.name}</option>`)}
              </select>
            `}
        </div>
        <div class="field">
          <label>Лимит на месяц</label>
          <${AmountInput} value=${amount} onChange=${setAmount} placeholder="0,00" />
        </div>
        ${error && html`<div class="notice error">${error}</div>`}
      </form>
    <//>
  `;
}
