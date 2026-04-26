import { html } from "htm/preact";
import { useMemo, useState } from "preact/hooks";
import { useStore } from "../lib/store.js";
import {
  formatAmount, fromISO, toISO,
  startOfFinMonth, endOfFinMonth, shiftFinMonth, finMonthLabel, monthLocative,
} from "../lib/format.js";
import { Icon } from "../lib/icons.js";
import { OperationForm } from "../components/OperationForm.js";
import { AccountForm } from "../components/AccountForm.js";
import { renderIcon } from "../components/IconPicker.js";
import { href } from "../lib/router.js";

export function DashboardPage() {
  const { profile, accounts, categories, operations } = useStore();
  const [adding, setAdding] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);

  const fmt = (v, c) => formatAmount(v, c || profile?.base_currency || "RUB", profile?.number_format || "space");
  const finStart = profile?.financial_month_start || 1;

  const monthAnchor = useMemo(() => shiftFinMonth(new Date(), monthOffset, finStart), [monthOffset, finStart]);
  const monthStart = startOfFinMonth(monthAnchor, finStart);
  const monthEnd = endOfFinMonth(monthAnchor, finStart);
  const startISO = toISO(monthStart);
  const endISO = toISO(monthEnd);

  const inRange = (op) => op.date >= startISO && op.date <= endISO;
  const monthOps = operations.filter(inRange);

  const income = sum(monthOps.filter(o => o.kind === "income"), o => o.amount);
  const expense = sum(monthOps.filter(o => o.kind === "expense"), o => o.amount);
  const diff = income - expense;

  // Доля расхода в доходе (для пропорциональной полоски).
  // Если дохода нет, но есть расход — полоска полностью красная.
  const expenseFrac = income > 0
    ? Math.min(1, expense / income)
    : (expense > 0 ? 1 : 0);

  // Прошлый период — для сравнения
  const prevAnchor = useMemo(() => shiftFinMonth(monthAnchor, -1, finStart), [monthAnchor, finStart]);
  const prevStart = startOfFinMonth(prevAnchor, finStart);
  const prevEnd = endOfFinMonth(prevAnchor, finStart);
  const prevStartISO = toISO(prevStart);
  const prevEndISO = toISO(prevEnd);
  const prevOps = operations.filter(o => o.date >= prevStartISO && o.date <= prevEndISO);
  const prevIncome = sum(prevOps.filter(o => o.kind === "income"), o => o.amount);
  const prevExpense = sum(prevOps.filter(o => o.kind === "expense"), o => o.amount);

  const expensePct = income > 0 ? Math.round((expense / income) * 100) : (expense > 0 ? 100 : 0);
  const prevExpensePct = prevIncome > 0 ? Math.round((prevExpense / prevIncome) * 100) : (prevExpense > 0 ? 100 : 0);

  // Доли для полосок (масштаб от max(income, expense) — на случай перерасхода)
  const ivMax = Math.max(income, expense, 1);
  const incomeBarPct = (income / ivMax) * 100;
  const expenseBarPct = (expense / ivMax) * 100;
  const balancePct = ivMax > 0 ? (Math.max(0, diff) / ivMax) * 100 : 0;

  const totalBalance = useMemo(() => {
    let total = 0;
    for (const a of accounts.filter(a => !a.archived)) {
      total += accountBalance(a, operations);
    }
    return total;
  }, [accounts, operations]);

  const recent = operations.slice(0, 6);

  // Топ категорий по расходам в выбранном месяце
  const topCategories = useMemo(() => {
    const byCat = new Map();
    for (const o of monthOps.filter(o => o.kind === "expense" && o.category_id)) {
      const cat = categories.find(c => c.id === o.category_id);
      const top = cat?.parent_id ? categories.find(c => c.id === cat.parent_id) || cat : cat;
      if (!top) continue;
      byCat.set(top.id, (byCat.get(top.id) || 0) + Number(o.amount));
    }
    return [...byCat.entries()]
      .map(([id, amount]) => ({ category: categories.find(c => c.id === id), amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);
  }, [monthOps, categories]);

  const noAccounts = accounts.filter(a => !a.archived).length === 0;

  return html`
    <div class="page-head">
      <div>
        <h1>Главная</h1>
        <div class="sub">${finMonthLabel(monthStart)}</div>
      </div>
      <div class="btn-row">
        <button class="btn" onClick=${() => setMonthOffset(o => o - 1)} title="Предыдущий период">${Icon.left()}</button>
        ${monthOffset !== 0 && html`<button class="btn ghost" onClick=${() => setMonthOffset(0)}>Сегодня</button>`}
        <button class="btn" onClick=${() => setMonthOffset(o => o + 1)} title="Следующий период"
                disabled=${monthOffset >= 0}>${Icon.right()}</button>
        <button class="btn primary" onClick=${() => setAdding(true)}>${Icon.plus()} Добавить</button>
      </div>
    </div>

    <div class="hero glass">
      <div class="h-cell income">
        <div class="h-label">Доход</div>
        <div class="h-value">${fmt(income)}</div>
      </div>
      <div class="h-cell expense">
        <div class="h-label">Расход</div>
        <div class="h-value">${fmt(expense)}</div>
      </div>
      <div class="h-cell diff">
        <div class="h-label">Остаток</div>
        <div class=${"h-value " + (diff < 0 ? "neg" : "pos")}>${fmt(diff)}</div>
      </div>
      <div class=${"hero-bar " + (diff < 0 ? "over" : "")}
           style=${`--expense-frac: ${(expenseFrac * 100).toFixed(2)}%;`}>
        <div class="h-bar-expense"></div>
        <div class="h-bar-balance"></div>
      </div>
    </div>

    <div class="card ive-card" style="margin-bottom:18px;">
      <div class="ive-head">
        <h2>Доходы vs Расходы</h2>
      </div>
      <div class=${"ive-pct" + (expensePct > 100 ? " over" : "")}>${expensePct}%</div>
      <div class="ive-sub">Доля расходов в ${monthLocative(monthStart)}</div>
      <div class="ive-rows">
        <div class="ive-row">
          <div class="label">Доходы</div>
          <div class="ive-bar income from-left">
            <div class="fill" style=${`width:${incomeBarPct}%;`}></div>
          </div>
          <div class="amount" style="color:var(--income);">${fmt(income)}</div>
        </div>
        <div class="ive-row">
          <div class="label">Расходы</div>
          <div class="ive-bar expense from-left">
            <div class="fill" style=${`width:${Math.min(100, expenseBarPct)}%;`}></div>
          </div>
          <div class="amount">${fmt(expense)}</div>
        </div>
        <div class="ive-row">
          <div class="label">Остаток</div>
          <div class="ive-bar balance from-right">
            <div class="fill" style=${`width:${balancePct}%;`}></div>
          </div>
          <div class="amount" style=${diff < 0 ? "color:var(--expense);" : ""}>${fmt(diff)}</div>
        </div>
      </div>
      <div class="ive-note">
        ${ivNote(expensePct, prevExpensePct, monthLocative(monthStart))}
      </div>
    </div>

    <div class="row cols-2" style="align-items:start;">
      <div class="card">
        <div class="section-head" style="padding:16px 18px 8px;">
          <h2>Счета</h2>
          <a class="more" href=${href("settings/accounts")}>Управлять</a>
        </div>
        ${noAccounts
          ? html`<div class="empty"><div class="em-title">Пока нет счетов</div>Создайте первый счёт, чтобы начать вести учёт.<br/><br/>
                  <button class="btn primary" onClick=${() => setCreatingAccount(true)}>${Icon.plus()} Создать счёт</button></div>`
          : html`
            <div class="list">
              ${accounts.filter(a => !a.archived).map(a => {
                const bal = accountBalance(a, operations);
                return html`
                  <div class="list-row" key=${a.id}>
                    <div class="lr-icon" style=${`color:${a.color || "var(--accent)"};background:${(a.color || "#16a34a")}1f;`}>${renderIcon(a.icon, "wallet")}</div>
                    <div class="lr-main">
                      <div class="lr-title">${a.name}</div>
                      <div class="lr-sub">${a.currency || "RUB"}</div>
                    </div>
                    <div class="lr-amount">${fmt(bal, a.currency)}</div>
                  </div>
                `;
              })}
              <div class="list-row" style="background:var(--bg-soft);">
                <div class="lr-main"><div class="lr-title">Всего</div></div>
                <div class="lr-amount tabular">${fmt(totalBalance)}</div>
              </div>
            </div>
          `}
      </div>

      <div class="card">
        <div class="section-head" style="padding:16px 18px 8px;">
          <h2>Топ категорий за период</h2>
          <a class="more" href=${href("operations")}>Все операции</a>
        </div>
        ${topCategories.length === 0
          ? html`<div class="empty">Нет расходов за этот период</div>`
          : html`
            <div class="list">
              ${topCategories.map(({ category, amount }) => {
                const total = topCategories.reduce((s, x) => s + x.amount, 0);
                const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
                return html`
                  <div class="list-row" key=${category.id}>
                    <span class="lr-icon" style=${`color:${category.color || "var(--accent)"};background:${(category.color || "#16a34a")}1f;`}>${renderIcon(category.icon, "tag")}</span>
                    <div class="lr-main">
                      <div class="lr-title">${category.name}</div>
                      <div class="progress" style="margin-top:6px;"><div style=${`width:${pct}%;background:${category.color || "var(--accent)"};`}></div></div>
                    </div>
                    <div class="lr-amount">${fmt(amount)}</div>
                  </div>
                `;
              })}
            </div>
          `}
      </div>
    </div>

    <div class="card" style="margin-top:18px;">
      <div class="section-head" style="padding:16px 18px 8px;">
        <h2>Последние операции</h2>
        <a class="more" href=${href("operations")}>Все операции</a>
      </div>
      ${recent.length === 0
        ? html`<div class="empty">Здесь будут появляться ваши операции</div>`
        : html`
          <div class="list">
            ${recent.map(op => {
              const acc = accounts.find(a => a.id === op.account_id);
              const cat = op.category_id ? categories.find(c => c.id === op.category_id) : null;
              const parentCat = cat?.parent_id ? categories.find(c => c.id === cat.parent_id) : null;
              const dotColor = cat?.color || (op.kind === "income" ? "var(--income)" : op.kind === "transfer" ? "var(--transfer)" : "var(--expense)");
              const iconName = op.kind === "transfer" ? "swap" : (cat?.icon || "dot");
              return html`
                <div class="list-row" key=${op.id}>
                  <span class="lr-icon" style=${`color:${dotColor};background:${dotColor}1f;`}>${renderIcon(iconName, "dot")}</span>
                  <div class="lr-main">
                    <div class="lr-title">${rowTitle(op, accounts, cat, parentCat)}</div>
                    <div class="lr-sub">${rowSub(op, acc, accounts)}</div>
                  </div>
                  <div class=${"lr-amount " + op.kind}>
                    ${op.kind === "income" ? "+" : op.kind === "expense" ? "−" : ""}${fmt(op.amount, acc?.currency)}
                  </div>
                </div>
              `;
            })}
          </div>
        `}
    </div>

    ${adding && html`<${OperationForm} onClose=${() => setAdding(false)} />`}
    ${creatingAccount && html`<${AccountForm} onClose=${() => setCreatingAccount(false)} />`}
  `;
}

function sum(arr, getter) {
  return arr.reduce((s, x) => s + Number(getter(x) || 0), 0);
}

function ivNote(curPct, prevPct, locMonth) {
  const cur = `В ${locMonth} на расходы ушло ${curPct}% от дохода.`;
  if (prevPct === 0 && curPct === 0) {
    return cur + " Данных за прошлый период пока нет.";
  }
  if (prevPct === 0) {
    return cur + " В прошлом периоде доходов ещё не было.";
  }
  const delta = curPct - prevPct;
  if (delta === 0) return cur + " Это столько же, сколько в прошлом периоде.";
  if (delta > 0) return cur + ` В прошлом периоде было ${prevPct}% — стало больше на ${delta} п.п.`;
  return cur + ` В прошлом периоде было ${prevPct}% — стало меньше на ${-delta} п.п.`;
}

function accountBalance(account, operations) {
  let bal = Number(account.initial_balance || 0);
  for (const op of operations) {
    if (op.account_id === account.id) {
      if (op.kind === "income") bal += Number(op.amount);
      else if (op.kind === "expense") bal -= Number(op.amount);
      else if (op.kind === "transfer") bal -= Number(op.amount);
    }
    if (op.to_account_id === account.id && op.kind === "transfer") {
      bal += Number(op.to_amount || op.amount);
    }
  }
  return bal;
}

function rowTitle(op, accounts, cat, parentCat) {
  if (op.kind === "transfer") {
    const from = accounts.find(a => a.id === op.account_id);
    const to = accounts.find(a => a.id === op.to_account_id);
    return `${from?.name || "?"} → ${to?.name || "?"}`;
  }
  if (cat) {
    return parentCat ? `${parentCat.name} • ${cat.name}` : cat.name;
  }
  return op.kind === "income" ? "Доход" : "Расход";
}

function rowSub(op, acc, accounts) {
  const date = formatDateShort(op.date);
  if (op.kind === "transfer") return `${date} • Перевод`;
  return `${date} • ${acc?.name || ""}${op.note ? " • " + op.note : ""}`;
}

function formatDateShort(iso) {
  if (!iso) return "";
  const d = fromISO(iso);
  if (!d) return "";
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  const months = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}
