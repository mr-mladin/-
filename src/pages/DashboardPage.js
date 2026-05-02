import { html } from "htm/preact";
import { useMemo, useState } from "preact/hooks";
import { useStore } from "../lib/store.js";
import {
  formatAmount, toISO,
  startOfFinMonth, endOfFinMonth, shiftFinMonth, finMonthLabel, monthLocative,
} from "../lib/format.js";
import { Icon } from "../lib/icons.js";
import { OperationForm } from "../components/OperationForm.js";
import { AccountForm } from "../components/AccountForm.js";
import { renderIcon } from "../components/IconPicker.js";
import { PlansChart } from "../components/PlansChart.js";
import { OperationsList } from "../components/OperationsList.js";

export function DashboardPage() {
  const { profile, accounts, operations } = useStore();
  const [adding, setAdding] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
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

  const noAccounts = accounts.filter(a => !a.archived).length === 0;

  return html`
    <div class="dash-grid">
      <aside class="dash-rail">
        <div class="rail-head">
          <h2>Счета</h2>
          <button class="btn-mini" title="Новый счёт"
            onClick=${() => setCreatingAccount(true)}>${Icon.plus()}</button>
        </div>
        ${noAccounts
          ? html`<div class="muted" style="padding:14px 4px;font-size:13px;">
              Создайте первый счёт, чтобы начать вести учёт.<br/><br/>
              <button class="btn primary sm" onClick=${() => setCreatingAccount(true)}>${Icon.plus()} Создать счёт</button>
            </div>`
          : html`
            <div class="rail-list">
              ${accounts.filter(a => !a.archived).map(a => {
                const bal = accountBalance(a, operations);
                return html`
                  <button class="rail-acc" key=${a.id} onClick=${() => setEditingAccount(a)}>
                    <span class="rail-acc-icon" style=${`color:${a.color || "var(--accent)"};`}>${renderIcon(a.icon, "wallet")}</span>
                    <span class="rail-acc-main">
                      <span class="rail-acc-name">${a.name}</span>
                    </span>
                    <span class=${"rail-acc-bal " + (bal < 0 ? "neg" : "pos")}>${fmt(bal, a.currency)}</span>
                  </button>
                `;
              })}
              <div class="rail-total">
                <span>Всего</span>
                <span class="tabular">${fmt(totalBalance)}</span>
              </div>
            </div>
          `}
      </aside>

      <main class="dash-main">
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

        <div class="row cols-2" style="align-items:stretch;margin-bottom:18px;">
          <div class="card ive-card">
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

          <div class="card" style="padding:18px 20px;">
            <div class="section-head" style="margin-bottom:8px;">
              <h2>Динамика и планы</h2>
              <span class="more">Наведите курсор</span>
            </div>
            <${PlansChart} monthStart=${monthStart} monthEnd=${monthEnd} />
          </div>
        </div>

        <${OperationsList} />
      </main>
    </div>

    ${adding && html`<${OperationForm} onClose=${() => setAdding(false)} />`}
    ${creatingAccount && html`<${AccountForm} onClose=${() => setCreatingAccount(false)} />`}
    ${editingAccount && html`<${AccountForm} initial=${editingAccount} onClose=${() => setEditingAccount(null)} />`}
  `;
}

function sum(arr, getter) {
  return arr.reduce((s, x) => s + Number(getter(x) || 0), 0);
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

function ivNote(curPct, prevPct, locMonth) {
  const cur = `В ${locMonth} на расходы ушло ${curPct}% от дохода.`;
  if (prevPct === 0 && curPct === 0) return cur + " Данных за прошлый период пока нет.";
  if (prevPct === 0) return cur + " В прошлом периоде доходов ещё не было.";
  const delta = curPct - prevPct;
  if (delta === 0) return cur + " Это столько же, сколько в прошлом периоде.";
  if (delta > 0) return cur + ` В прошлом периоде было ${prevPct}% — стало больше на ${delta} п.п.`;
  return cur + ` В прошлом периоде было ${prevPct}% — стало меньше на ${-delta} п.п.`;
}
