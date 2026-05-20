import { html } from "htm/preact";
import { useMemo, useState } from "preact/hooks";
import { useStore } from "../lib/store.js";
import { formatAmount, fromISO } from "../lib/format.js";
import { Icon } from "../lib/icons.js";
import { OperationForm } from "../components/OperationForm.js";
import { PlansChart } from "../components/PlansChart.js";
import { OperationsList } from "../components/OperationsList.js";
import { PeriodPicker } from "../components/PeriodPicker.js";
import { resolvePeriod, previousPeriod, defaultPeriod } from "../lib/period.js";

export function DashboardPage() {
  const { profile, accounts, operations, selectedAccountId } = useStore();
  const [adding, setAdding] = useState(false);
  const [period, setPeriod] = useState(() => defaultPeriod());

  const fmt = (v, c) => formatAmount(v, c || profile?.base_currency || "RUB", profile?.number_format || "space");
  const weekStart = profile?.week_start === 0 ? 0 : 1;

  const range = useMemo(() => resolvePeriod(period, new Date(), weekStart), [period, weekStart]);
  const prevRange = useMemo(() => previousPeriod(range.startISO, range.endISO), [range.startISO, range.endISO]);

  const matchesAccount = (op) => {
    if (!selectedAccountId) return true;
    return op.account_id === selectedAccountId || op.to_account_id === selectedAccountId;
  };

  const inRange = (op) => op.date >= range.startISO && op.date <= range.endISO;
  const monthOps = operations.filter(op => inRange(op) && matchesAccount(op));

  const income = sum(monthOps.filter(o => o.kind === "income"), o => o.amount);
  const expense = sum(monthOps.filter(o => o.kind === "expense"), o => o.amount);
  const diff = income - expense;

  const prevOps = operations.filter(o => o.date >= prevRange.startISO && o.date <= prevRange.endISO && matchesAccount(o));
  const prevIncome = sum(prevOps.filter(o => o.kind === "income"), o => o.amount);
  const prevExpense = sum(prevOps.filter(o => o.kind === "expense"), o => o.amount);

  const expensePct = income > 0 ? Math.round((expense / income) * 100) : (expense > 0 ? 100 : 0);
  const prevExpensePct = prevIncome > 0 ? Math.round((prevExpense / prevIncome) * 100) : (prevExpense > 0 ? 100 : 0);

  const ivMax = Math.max(income, expense, 1);
  const incomeBarPct = (income / ivMax) * 100;
  const expenseBarPct = (expense / ivMax) * 100;
  const balancePct = ivMax > 0 ? (Math.max(0, diff) / ivMax) * 100 : 0;

  const selectedAccount = selectedAccountId ? accounts.find(a => a.id === selectedAccountId) : null;
  const subLabel = selectedAccount ? `${range.label} • ${selectedAccount.name}` : range.label;

  const startDate = fromISO(range.startISO) || new Date();
  const endDate = fromISO(range.endISO) || new Date();
  const rangeDays = Math.round((endDate - startDate) / 86400000) + 1;
  const chartShowable = rangeDays > 0 && rangeDays <= 400;

  return html`
    <div class="page-head dash-head">
      <${PeriodPicker} period=${period} onChange=${setPeriod} operations=${operations} />
      <div class="btn-row">
        <button class="btn primary" onClick=${() => setAdding(true)}>${Icon.plus()} Добавить</button>
      </div>
    </div>
    <div class="dash-sub muted">${subLabel}</div>

    <div class="row cols-2" style="align-items:stretch;margin-bottom:18px;">
      <div class="card ive-card">
        <div class="ive-head">
          <h2>Доходы vs Расходы</h2>
        </div>
        <div class=${"ive-pct" + (expensePct > 100 ? " over" : "")}>${expensePct}%</div>
        <div class="ive-sub">Доля расходов ${range.locative}</div>
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
          ${noteText(expensePct, prevExpensePct, range.locative)}
        </div>
      </div>

      <div class="card" style="padding:18px 20px;">
        <div class="section-head" style="margin-bottom:8px;">
          <h2>Динамика и планы</h2>
          <span class="more">${chartShowable ? "Наведите курсор" : ""}</span>
        </div>
        ${chartShowable
          ? html`<${PlansChart} monthStart=${startDate} monthEnd=${endDate} />`
          : html`<div class="muted" style="padding:24px 4px;font-size:13px;">
              График доступен для периодов до года. Сузьте период, чтобы увидеть динамику.
            </div>`}
      </div>
    </div>

    <${OperationsList} rangeStart=${range.startISO} rangeEnd=${range.endISO} rangeLabel=${range.label} />

    ${adding && html`<${OperationForm} onClose=${() => setAdding(false)} />`}
  `;
}

function sum(arr, getter) {
  return arr.reduce((s, x) => s + Number(getter(x) || 0), 0);
}

function noteText(curPct, prevPct, loc) {
  const cur = `${capitalize(loc)} на расходы ушло ${curPct}% от дохода.`;
  if (prevPct === 0 && curPct === 0) return cur + " Данных за прошлый период пока нет.";
  if (prevPct === 0) return cur + " В прошлом периоде доходов ещё не было.";
  const delta = curPct - prevPct;
  if (delta === 0) return cur + " Это столько же, сколько в прошлом периоде.";
  if (delta > 0) return cur + ` В прошлом периоде было ${prevPct}% — стало больше на ${delta} п.п.`;
  return cur + ` В прошлом периоде было ${prevPct}% — стало меньше на ${-delta} п.п.`;
}

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
