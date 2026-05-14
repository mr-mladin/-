// Список операций с фильтрами и группировкой по дням.
// Используется как основной контент главной страницы.

import { html } from "htm/preact";
import { useMemo, useState } from "preact/hooks";
import { useStore } from "../lib/store.js";
import { formatAmount, formatDateRelative, parseAmount } from "../lib/format.js";
import { Icon } from "../lib/icons.js";
import { OperationForm } from "./OperationForm.js";
import { ConfirmModal } from "./Modal.js";
import { renderIcon } from "./IconPicker.js";

const EMPTY_FILTERS = {
  search: "",
  kind: "",
  accountId: "",
  categoryId: "",
  tagId: "",
  dateFrom: "",
  dateTo: "",
  amountFrom: "",
  amountTo: "",
};

export function OperationsList() {
  const store = useStore();
  const { profile, accounts, categories, tags, operations, operationTags, selectedAccountId } = store;

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });

  const fmt = (v, c) => formatAmount(v, c || profile?.base_currency || "RUB", profile?.number_format || "space");

  const tagsByOp = useMemo(() => {
    const m = new Map();
    for (const ot of operationTags) {
      if (!m.has(ot.operation_id)) m.set(ot.operation_id, []);
      m.get(ot.operation_id).push(ot.tag_id);
    }
    return m;
  }, [operationTags]);

  const filtered = useMemo(() => {
    const f = filters;
    const search = f.search.trim().toLowerCase();
    const amountFrom = f.amountFrom ? parseAmount(f.amountFrom) : null;
    const amountTo = f.amountTo ? parseAmount(f.amountTo) : null;
    return operations.filter(op => {
      if (selectedAccountId && op.account_id !== selectedAccountId && op.to_account_id !== selectedAccountId) return false;
      if (f.kind && op.kind !== f.kind) return false;
      if (f.accountId && op.account_id !== f.accountId && op.to_account_id !== f.accountId) return false;
      if (f.categoryId) {
        const cat = categories.find(c => c.id === op.category_id);
        if (!cat) return false;
        if (cat.id !== f.categoryId && cat.parent_id !== f.categoryId) return false;
      }
      if (f.tagId) {
        const t = tagsByOp.get(op.id) || [];
        if (!t.includes(f.tagId)) return false;
      }
      if (f.dateFrom && op.date < f.dateFrom) return false;
      if (f.dateTo && op.date > f.dateTo) return false;
      if (amountFrom !== null && Number(op.amount) < amountFrom) return false;
      if (amountTo !== null && Number(op.amount) > amountTo) return false;
      if (search) {
        const cat = op.category_id ? categories.find(c => c.id === op.category_id) : null;
        const acc = accounts.find(a => a.id === op.account_id);
        const hay = [
          op.note, cat?.name, acc?.name,
          ...(tagsByOp.get(op.id) || []).map(id => tags.find(t => t.id === id)?.name)
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [operations, filters, accounts, categories, tags, tagsByOp, selectedAccountId]);

  const totalIncome = filtered.filter(o => o.kind === "income").reduce((s, o) => s + Number(o.amount), 0);
  const totalExpense = filtered.filter(o => o.kind === "expense").reduce((s, o) => s + Number(o.amount), 0);

  const grouped = useMemo(() => {
    const m = new Map();
    for (const op of filtered) {
      if (!m.has(op.date)) m.set(op.date, []);
      m.get(op.date).push(op);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const setF = (k, v) => setFilters(p => ({ ...p, [k]: v }));
  const hasFilter = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  async function remove(op) {
    await store.actions.operations.remove(op.id);
    setConfirmDel(null);
    store.pushToast("Операция удалена", "success");
  }

  return html`
    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div class="between" style="margin-bottom:${showFilters ? "12px" : "0"};">
        <div class="flex" style="gap:14px;flex-wrap:wrap;align-items:baseline;">
          <h2 style="margin:0;font-size:17px;letter-spacing:-0.01em;">Операции</h2>
          <span class="muted" style="font-size:13px;">
            ${filtered.length} ${plural(filtered.length, "операция", "операции", "операций")}
            ${totalIncome > 0 ? html` • <span class="income">+${fmt(totalIncome)}</span>` : null}
            ${totalExpense > 0 ? html` • <span class="expense">−${fmt(totalExpense)}</span>` : null}
          </span>
        </div>
        <div class="btn-row">
          <button class=${"btn sm " + (showFilters ? "primary" : "")} onClick=${() => setShowFilters(s => !s)}>
            ${Icon.filter()} Фильтры${hasFilter ? " •" : ""}
          </button>
          <button class="btn primary sm" onClick=${() => setAdding(true)}>${Icon.plus()} Добавить</button>
        </div>
      </div>

      ${showFilters && html`
        <div class="filter-bar">
          <div style="position:relative;">
            <input class="input" placeholder="Поиск…"
                   value=${filters.search} onInput=${e => setF("search", e.target.value)}
                   style="padding-left:36px;" />
            <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-mute);">${Icon.search()}</span>
          </div>
          <select class="select" value=${filters.kind} onChange=${e => setF("kind", e.target.value)}>
            <option value="">Все типы</option>
            <option value="income">Доходы</option>
            <option value="expense">Расходы</option>
            <option value="transfer">Переводы</option>
          </select>
          <select class="select" value=${filters.accountId} onChange=${e => setF("accountId", e.target.value)}>
            <option value="">Все счета</option>
            ${accounts.map(a => html`<option value=${a.id} key=${a.id}>${a.name}</option>`)}
          </select>
          <select class="select" value=${filters.categoryId} onChange=${e => setF("categoryId", e.target.value)}>
            <option value="">Все категории</option>
            ${categories.filter(c => !c.parent_id).map(p => html`
              <option value=${p.id} key=${p.id}>${p.name}</option>
            `)}
          </select>
          <select class="select" value=${filters.tagId} onChange=${e => setF("tagId", e.target.value)}>
            <option value="">Все теги</option>
            ${tags.map(t => html`<option value=${t.id} key=${t.id}>${t.name}</option>`)}
          </select>
          ${hasFilter && html`
            <button class="btn ghost clear-btn sm" onClick=${() => setFilters({ ...EMPTY_FILTERS })}>${Icon.close()} Сбросить</button>
          `}
        </div>
        <div class="row cols-2" style="margin-top:10px;">
          <div class="row cols-2">
            <div class="field">
              <label>Дата с</label>
              <input class="input" type="date" value=${filters.dateFrom} onInput=${e => setF("dateFrom", e.target.value)} />
            </div>
            <div class="field">
              <label>Дата по</label>
              <input class="input" type="date" value=${filters.dateTo} onInput=${e => setF("dateTo", e.target.value)} />
            </div>
          </div>
          <div class="row cols-2">
            <div class="field">
              <label>Сумма от</label>
              <input class="input" inputmode="decimal" placeholder="0"
                value=${filters.amountFrom} onInput=${e => setF("amountFrom", e.target.value)} />
            </div>
            <div class="field">
              <label>Сумма до</label>
              <input class="input" inputmode="decimal" placeholder="∞"
                value=${filters.amountTo} onInput=${e => setF("amountTo", e.target.value)} />
            </div>
          </div>
        </div>
      `}
    </div>

    ${grouped.length === 0
      ? html`<div class="card empty">
          <div class="em-title">Пока пусто</div>
          ${hasFilter ? "Под фильтры ничего не подошло." : "Добавьте первую операцию."}<br/><br/>
          <button class="btn primary" onClick=${() => setAdding(true)}>${Icon.plus()} Добавить операцию</button>
        </div>`
      : grouped.map(([date, ops]) => html`
          <div class="card" style="margin-bottom:14px;" key=${date}>
            <div class="section-head" style="padding:14px 18px 4px;">
              <h2 style="font-size:14px;font-weight:600;color:var(--text-soft);">${formatDateRelative(date)}</h2>
              <span class="muted tabular">${dayTotal(ops, fmt)}</span>
            </div>
            <div class="list">
              ${ops.map(op => {
                const acc = accounts.find(a => a.id === op.account_id);
                const toAcc = op.to_account_id ? accounts.find(a => a.id === op.to_account_id) : null;
                const cat = op.category_id ? categories.find(c => c.id === op.category_id) : null;
                const parentCat = cat?.parent_id ? categories.find(c => c.id === cat.parent_id) : null;
                const opTagIds = tagsByOp.get(op.id) || [];
                const dotColor = cat?.color || (op.kind === "income" ? "var(--income)" : op.kind === "transfer" ? "var(--transfer)" : "var(--expense)");
                const iconName = op.kind === "transfer" ? "swap" : (cat?.icon || "dot");

                let title;
                if (op.kind === "transfer") title = `${acc?.name || "?"} → ${toAcc?.name || "?"}`;
                else if (cat) title = parentCat ? `${parentCat.name} • ${cat.name}` : cat.name;
                else title = op.kind === "income" ? "Доход" : "Расход";

                let sub;
                if (op.kind === "transfer") sub = "Перевод между счетами";
                else sub = acc?.name || "";

                return html`
                  <div class="list-row clickable" key=${op.id}
                       onClick=${() => setEditing(op)}
                       style="cursor:pointer;">
                    <span class="lr-icon" style=${`color:${dotColor};background:${dotColor}1f;`}>${renderIcon(iconName, "dot")}</span>
                    <div class="lr-main">
                      <div class="lr-title">${title}</div>
                      <div class="lr-sub">
                        ${sub}${op.note ? ` • ${op.note}` : ""}
                        ${opTagIds.length > 0 && html`
                          <span style="margin-left:6px;">
                            ${opTagIds.map(tid => {
                              const t = tags.find(x => x.id === tid);
                              return t ? html`<span class="chip tag" style="margin-left:4px;font-size:11px;padding:2px 8px;" key=${tid}>${t.name}</span>` : null;
                            })}
                          </span>
                        `}
                      </div>
                    </div>
                    <div class=${"lr-amount " + op.kind}>
                      ${op.kind === "income" ? "+" : op.kind === "expense" ? "−" : ""}${fmt(op.amount, acc?.currency)}
                    </div>
                    <div class="row-actions" style="margin-left:8px;" onClick=${e => e.stopPropagation()}>
                      <button class="btn-mini" title="Удалить" onClick=${() => setConfirmDel(op)}>${Icon.trash()}</button>
                    </div>
                  </div>
                `;
              })}
            </div>
          </div>
        `)}

    ${adding && html`<${OperationForm} onClose=${() => setAdding(false)} />`}
    ${editing && html`<${OperationForm} initial=${editing} onClose=${() => setEditing(null)} />`}
    ${confirmDel && html`
      <${ConfirmModal}
        title="Удалить операцию?"
        message="Действие нельзя отменить."
        onCancel=${() => setConfirmDel(null)}
        onConfirm=${() => remove(confirmDel)}
      />
    `}
  `;
}

function dayTotal(ops, fmt) {
  const inc = ops.filter(o => o.kind === "income").reduce((s, o) => s + Number(o.amount), 0);
  const exp = ops.filter(o => o.kind === "expense").reduce((s, o) => s + Number(o.amount), 0);
  if (inc && exp) return `+${fmt(inc)} • −${fmt(exp)}`;
  if (inc) return `+${fmt(inc)}`;
  if (exp) return `−${fmt(exp)}`;
  return "";
}

function plural(n, one, few, many) {
  const m100 = n % 100;
  const m10 = n % 10;
  if (m100 >= 11 && m100 <= 14) return many;
  if (m10 === 1) return one;
  if (m10 >= 2 && m10 <= 4) return few;
  return many;
}
