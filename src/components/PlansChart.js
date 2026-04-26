// Интерактивный кумулятивный график «Планы» на дашборде.
// — Сплошные линии: фактический доход и расход (накопительно с начала фин-месяца).
// — Пунктир после сегодняшнего дня: продление с учётом плановых операций.
// — Красная подсветка периода, где остаток (доход − расход) уходит в минус.
// — Hover мышью / тапом: вертикальная линия, точки, информационная панель снизу.

import { html } from "htm/preact";
import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import { useStore } from "../lib/store.js";
import { formatAmount, fromISO, toISO } from "../lib/format.js";

const PAD = { top: 14, right: 16, bottom: 24, left: 50 };
const HEIGHT = 170;

// Округлить максимум до «красивого» числа: 1k, 2.5k, 5k, 10k, ...
function niceMax(value) {
  if (value <= 0) return 1000;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const m = value / base;
  let nice;
  if (m <= 1) nice = 1;
  else if (m <= 2) nice = 2;
  else if (m <= 2.5) nice = 2.5;
  else if (m <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

function compactMoney(v, currency = "RUB") {
  const sym = currency === "RUB" ? "₽" : currency;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M ${sym}`;
  if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)}k ${sym}`;
  return `${Math.round(v)} ${sym}`;
}

// Дни между двумя датами включительно
function eachDay(start, end) {
  const days = [];
  const d = new Date(start.getTime());
  while (d <= end) {
    days.push(toISO(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

export function PlansChart({ monthStart, monthEnd }) {
  const { profile, operations, plannedOperations, accounts } = useStore();
  const numberFormat = profile?.number_format || "space";
  const baseCurrency = profile?.base_currency || "RUB";
  const fmt = (v) => formatAmount(v, baseCurrency, numberFormat);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayISO = toISO(today);

  const days = useMemo(() => eachDay(monthStart, monthEnd), [monthStart.getTime(), monthEnd.getTime()]);

  // По каждому дню — приход и уход, как фактические, так и плановые
  const dayMap = useMemo(() => {
    const m = new Map();
    days.forEach(d => m.set(d, { income: 0, expense: 0, plIncome: 0, plExpense: 0 }));

    for (const op of operations) {
      if (!m.has(op.date)) continue;
      if (op.kind === "income") m.get(op.date).income += Number(op.amount) || 0;
      else if (op.kind === "expense") m.get(op.date).expense += Number(op.amount) || 0;
      // Переводы между своими счетами не влияют на общий баланс.
    }
    for (const p of plannedOperations || []) {
      if (!m.has(p.date) || p.is_done) continue;
      if (p.kind === "income") m.get(p.date).plIncome += Number(p.amount) || 0;
      else if (p.kind === "expense") m.get(p.date).plExpense += Number(p.amount) || 0;
    }
    return m;
  }, [days, operations, plannedOperations]);

  // Кумулятивные ряды
  const series = useMemo(() => {
    const incomeSolid = []; // фактический доход накопительно (с monthStart до today)
    const expenseSolid = [];
    const incomePlan = []; // от today продолжается с плановыми
    const expensePlan = [];

    let curIn = 0, curEx = 0;
    for (const d of days) {
      const cell = dayMap.get(d);
      const isPast = d <= todayISO;
      if (isPast) {
        curIn += cell.income;
        curEx += cell.expense;
        incomeSolid.push({ date: d, value: curIn });
        expenseSolid.push({ date: d, value: curEx });
      } else {
        // Плановые добавляем в плановые ряды (продолжаем с факта на сегодня)
        curIn += cell.plIncome;
        curEx += cell.plExpense;
        incomePlan.push({ date: d, value: curIn });
        expensePlan.push({ date: d, value: curEx });
      }
    }
    return { incomeSolid, expenseSolid, incomePlan, expensePlan };
  }, [days, dayMap, todayISO]);

  // Стартовый баланс по всем активным счетам (на начало периода — упрощённо: текущий баланс)
  // На начало периода: balance0 = (initial_balance) + (income − expense + переводы) до monthStart
  // Это упрощение — хватает для индикатора.
  const startBalance = useMemo(() => {
    let total = 0;
    const startISO_ = toISO(monthStart);
    for (const a of accounts.filter(x => !x.archived)) {
      let bal = Number(a.initial_balance || 0);
      for (const op of operations) {
        if (op.date >= startISO_) continue;
        if (op.account_id === a.id) {
          if (op.kind === "income") bal += Number(op.amount);
          else if (op.kind === "expense" || op.kind === "transfer") bal -= Number(op.amount);
        }
        if (op.to_account_id === a.id && op.kind === "transfer") {
          bal += Number(op.to_amount || op.amount);
        }
      }
      total += bal;
    }
    return total;
  }, [monthStart.getTime(), accounts, operations]);

  // Размер
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = Math.max(320, Math.floor(e.contentRect.width));
        setWidth(w);
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const innerW = Math.max(60, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  // Значение по Y → пиксель
  const allValues = [
    ...series.incomeSolid.map(p => p.value),
    ...series.expenseSolid.map(p => p.value),
    ...series.incomePlan.map(p => p.value),
    ...series.expensePlan.map(p => p.value),
  ];
  const rawMax = Math.max(1, ...allValues);
  const yMax = niceMax(rawMax);

  function xFor(idx) {
    if (days.length <= 1) return PAD.left;
    return PAD.left + (idx / (days.length - 1)) * innerW;
  }
  function yFor(v) {
    return PAD.top + innerH - (v / yMax) * innerH;
  }

  function pointsToPath(points) {
    return points.map((p, i) => {
      const idx = days.indexOf(p.date);
      return `${i === 0 ? "M" : "L"}${xFor(idx).toFixed(2)},${yFor(p.value).toFixed(2)}`;
    }).join(" ");
  }

  const pathIncomeSolid = pointsToPath(series.incomeSolid);
  const pathExpenseSolid = pointsToPath(series.expenseSolid);

  // План: чтобы пунктир «начинался» из точки на сегодня — добавляем точку «сегодня» в начало
  const todayIdx = days.findIndex(d => d > todayISO) - 1;
  const incomeAtToday = series.incomeSolid.length ? series.incomeSolid[series.incomeSolid.length - 1] : null;
  const expenseAtToday = series.expenseSolid.length ? series.expenseSolid[series.expenseSolid.length - 1] : null;

  const planIncomePoints = incomeAtToday ? [incomeAtToday, ...series.incomePlan] : series.incomePlan;
  const planExpensePoints = expenseAtToday ? [expenseAtToday, ...series.expensePlan] : series.expensePlan;
  const pathIncomePlan = pointsToPath(planIncomePoints);
  const pathExpensePlan = pointsToPath(planExpensePoints);

  // Зоны нехватки: где (income − expense) + startBalance < 0
  const overSegments = useMemo(() => {
    const segs = [];
    let curStart = null;
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      const incVal = i < series.incomeSolid.length
        ? series.incomeSolid[i].value
        : (series.incomePlan[i - series.incomeSolid.length]?.value ?? 0);
      const expVal = i < series.expenseSolid.length
        ? series.expenseSolid[i].value
        : (series.expensePlan[i - series.expenseSolid.length]?.value ?? 0);
      const balance = startBalance + incVal - expVal;
      const negative = balance < 0;
      if (negative && curStart === null) curStart = i;
      if (!negative && curStart !== null) { segs.push([curStart, i - 1]); curStart = null; }
    }
    if (curStart !== null) segs.push([curStart, days.length - 1]);
    return segs;
  }, [days, series, startBalance]);

  // Hover
  const [hoverIdx, setHoverIdx] = useState(null);
  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
    const t = (x - PAD.left) / innerW;
    const idx = Math.max(0, Math.min(days.length - 1, Math.round(t * (days.length - 1))));
    setHoverIdx(idx);
  }
  function onLeave() { setHoverIdx(null); }

  // Селектируемый день: либо hover, либо сегодня
  const selectedIdx = hoverIdx ?? days.indexOf(todayISO) ;
  const safeIdx = selectedIdx >= 0 ? selectedIdx : days.length - 1;
  const selectedDate = days[safeIdx];
  const selectedCell = dayMap.get(selectedDate) || { income: 0, expense: 0, plIncome: 0, plExpense: 0 };
  const isFuture = selectedDate > todayISO;

  // Cumulative до выбранного дня (для тултипа «баланс на дату»)
  let cumIn = 0, cumEx = 0;
  for (let i = 0; i <= safeIdx; i++) {
    const c = dayMap.get(days[i]);
    if (days[i] <= todayISO) { cumIn += c.income; cumEx += c.expense; }
    else { cumIn += c.plIncome; cumEx += c.plExpense; }
  }
  const balanceAtSelected = startBalance + cumIn - cumEx;

  // Метки оси Y: 0, ¼, ½, ¾, max
  const yTicks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax];

  // Метки X: ~ каждые 5 дней (1, 5, 10, …, last)
  const xTicks = [];
  const total = days.length;
  for (let i = 0; i < total; i++) {
    const dn = Number(days[i].slice(8, 10));
    if (i === 0 || i === total - 1 || dn % 5 === 0) xTicks.push(i);
  }

  const dayLabel = (iso) => {
    const d = fromISO(iso);
    return d ? d.getDate() : "";
  };

  const hoverX = hoverIdx !== null ? xFor(hoverIdx) : null;
  const todayPos = days.indexOf(todayISO);

  return html`
    <div class="plans-chart" ref=${wrapRef}>
      <div class="pc-summary">
        <div>
          <div class="pc-label">Поступления</div>
          <div class="pc-value income">${fmt(cumIn)}</div>
        </div>
        <div>
          <div class="pc-label">Расходы</div>
          <div class="pc-value expense">${fmt(cumEx)}</div>
        </div>
        <div class="pc-summary-date">${formatDayLabel(selectedDate)}</div>
      </div>

      <svg class="pc-svg" width=${width} height=${HEIGHT}
        onMouseMove=${onMove} onMouseLeave=${onLeave}
        onTouchStart=${onMove} onTouchMove=${onMove} onTouchEnd=${onLeave}>
        <!-- Сетка по Y -->
        ${yTicks.map(t => html`
          <g key=${"yt" + t}>
            <line x1=${PAD.left} x2=${PAD.left + innerW}
              y1=${yFor(t)} y2=${yFor(t)}
              class="pc-grid" />
            <text x=${PAD.left - 8} y=${yFor(t) + 4}
              text-anchor="end" class="pc-tick">
              ${t === 0 ? "0" : compactMoney(t, baseCurrency)}
            </text>
          </g>
        `)}
        <!-- Метки по X -->
        ${xTicks.map(i => html`
          <text key=${"xt" + i} x=${xFor(i)} y=${HEIGHT - 8}
            text-anchor="middle" class="pc-tick">${dayLabel(days[i])}</text>
        `)}

        <!-- Зоны перерасхода (красная подсветка) -->
        ${overSegments.map(([a, b], i) => {
          const x1 = xFor(a);
          const x2 = xFor(b);
          return html`<rect key=${"over" + i}
            x=${x1} y=${PAD.top} width=${Math.max(2, x2 - x1)} height=${innerH}
            class="pc-over" />`;
        })}

        <!-- Линии: расход (тёмная) сначала, потом доход (зелёная) -->
        <path d=${pathExpenseSolid} class="pc-line expense solid" />
        ${pathExpensePlan && html`<path d=${pathExpensePlan} class="pc-line expense plan" />`}
        <path d=${pathIncomeSolid} class="pc-line income solid" />
        ${pathIncomePlan && html`<path d=${pathIncomePlan} class="pc-line income plan" />`}

        <!-- Линия «сегодня» -->
        ${todayPos >= 0 && html`
          <line x1=${xFor(todayPos)} x2=${xFor(todayPos)}
            y1=${PAD.top} y2=${PAD.top + innerH}
            class="pc-today" stroke-dasharray="2 4" />
        `}

        <!-- Hover guideline + точки -->
        ${hoverX !== null && html`
          <line x1=${hoverX} x2=${hoverX}
            y1=${PAD.top} y2=${PAD.top + innerH}
            class="pc-hover-line" />
          ${getValueAt(safeIdx, series, days) && html`
            <circle cx=${hoverX} cy=${yFor(getValueAt(safeIdx, series, days).income)} r="4" class="pc-dot income" />
            <circle cx=${hoverX} cy=${yFor(getValueAt(safeIdx, series, days).expense)} r="4" class="pc-dot expense" />
          `}
        `}
      </svg>

      <div class=${"pc-info " + (balanceAtSelected < 0 ? "neg" : "")}>
        <div class="pc-info-icon">●</div>
        <div class="pc-info-main">
          <div class="muted" style="font-size:12px;">Баланс на ${formatDayLabel(selectedDate)}</div>
          <div class="pc-info-bal">${fmt(balanceAtSelected)}</div>
        </div>
        <div class="pc-info-side">
          ${(selectedCell.income > 0 || selectedCell.expense > 0) && html`
            <div class="muted" style="font-size:11px;">За день</div>
            <div class="pc-info-day">
              ${selectedCell.income > 0 && html`<span class="income">+${fmt(selectedCell.income)}</span>`}
              ${selectedCell.expense > 0 && html`<span class="expense">−${fmt(selectedCell.expense)}</span>`}
            </div>
          `}
          ${isFuture && (selectedCell.plIncome > 0 || selectedCell.plExpense > 0) && html`
            <div class="muted" style="font-size:11px;">План</div>
            <div class="pc-info-day">
              ${selectedCell.plIncome > 0 && html`<span class="income">+${fmt(selectedCell.plIncome)}</span>`}
              ${selectedCell.plExpense > 0 && html`<span class="expense">−${fmt(selectedCell.plExpense)}</span>`}
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

function formatDayLabel(iso) {
  const d = fromISO(iso);
  if (!d) return "";
  const months = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function getValueAt(idx, series, days) {
  // Возвращает {income, expense} на индексе из объединённых рядов
  const solidLen = series.incomeSolid.length;
  if (idx < solidLen) {
    return {
      income: series.incomeSolid[idx].value,
      expense: series.expenseSolid[idx].value,
    };
  }
  const j = idx - solidLen;
  return {
    income: series.incomePlan[j]?.value ?? series.incomeSolid[solidLen - 1]?.value ?? 0,
    expense: series.expensePlan[j]?.value ?? series.expenseSolid[solidLen - 1]?.value ?? 0,
  };
}
