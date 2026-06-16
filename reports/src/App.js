import { html } from "htm/preact";
import { useState } from "preact/hooks";
import { projects, monthLabel } from "./data.js";
import { rub, num, pct } from "./format.js";

// Сумма за месяц + производные метрики по одному проекту.
function totals(daily) {
  let spend = 0,
    clicks = 0,
    leads = 0,
    days = 0;
  for (const r of daily) {
    if (r.spend == null) continue;
    spend += r.spend;
    clicks += r.clicks;
    leads += r.leads;
    days++;
  }
  return {
    spend,
    clicks,
    leads,
    days,
    cpl: leads ? spend / leads : null, // цена заявки
    cpc: clicks ? spend / clicks : null, // цена перехода
    cr: clicks ? leads / clicks : null, // конверсия в заявку
  };
}

const METRICS = [
  { key: "spend", label: "Расход" },
  { key: "leads", label: "Заявки" },
  { key: "clicks", label: "Переходы" },
];

function Sparkline({ daily, metric }) {
  const vals = daily.map((r) => r[metric]).filter((v) => v != null);
  if (vals.length < 2) {
    return html`<div class="spark spark--empty"></div>`;
  }
  const W = 300,
    H = 48,
    pad = 3;
  const max = Math.max(...vals),
    min = Math.min(...vals);
  const span = max - min || 1;
  const step = W / (vals.length - 1);
  const pts = vals.map((v, i) => [
    i * step,
    H - pad - ((v - min) / span) * (H - pad * 2),
  ]);
  const line = pts
    .map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1))
    .join(" ");
  const area =
    `M0 ${H} ` +
    pts.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ") +
    ` L${W} ${H} Z`;
  return html`<svg
    class="spark"
    viewBox="0 0 ${W} ${H}"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <path class="spark__area" d=${area} />
    <path class="spark__line" d=${line} />
  </svg>`;
}

function Pill({ status }) {
  const active = status === "active";
  return html`<span class=${"pill " + (active ? "pill--active" : "pill--paused")}>
    <span class="dot"></span>${active ? "активно" : "пауза"}
  </span>`;
}

function PlanChip({ cpl, plan }) {
  if (cpl == null || !plan) return null;
  const delta = (cpl - plan) / plan;
  const good = cpl <= plan;
  const sign = delta > 0 ? "+" : "−";
  const txt = `${sign}${Math.abs(delta * 100).toFixed(0)}% к плану`;
  return html`<span
    class=${"chip " + (good ? "chip--good" : "chip--bad")}
    title=${"План цены заявки ≤ " + rub(plan)}
    >${txt}</span
  >`;
}

function Card({ p, metric }) {
  const t = totals(p.daily);
  return html`<article class="card">
    <header class="card__head">
      <div class="card__id">
        <div class="card__name">${p.name}</div>
        <div class="card__cab">Кабинет ${p.id}</div>
      </div>
      <${Pill} status=${p.status} />
    </header>

    <div class="kpis">
      <div class="kpi">
        <div class="kpi__label">Расход</div>
        <div class="kpi__value">${rub(t.spend)}</div>
      </div>
      <div class="kpi">
        <div class="kpi__label">Заявки</div>
        <div class="kpi__value">${num(t.leads)}</div>
      </div>
      <div class="kpi">
        <div class="kpi__label">Цена заявки</div>
        <div class="kpi__value">${rub(t.cpl)}</div>
        <${PlanChip} cpl=${t.cpl} plan=${p.planCpl} />
      </div>
    </div>

    <${Sparkline} daily=${p.daily} metric=${metric} />

    <div class="kpis kpis--sub">
      <div class="kpi">
        <div class="kpi__label">Переходы</div>
        <div class="kpi__value kpi__value--sm">${num(t.clicks)}</div>
      </div>
      <div class="kpi">
        <div class="kpi__label">Цена перехода</div>
        <div class="kpi__value kpi__value--sm">${rub(t.cpc)}</div>
      </div>
      <div class="kpi">
        <div class="kpi__label">Конверсия</div>
        <div class="kpi__value kpi__value--sm">${pct(t.cr)}</div>
      </div>
    </div>
  </article>`;
}

export function App() {
  const [metric, setMetric] = useState("spend");
  const active = projects.filter((p) => p.status === "active");
  const sum = active.reduce(
    (a, p) => {
      const t = totals(p.daily);
      a.spend += t.spend;
      a.leads += t.leads;
      a.clicks += t.clicks;
      return a;
    },
    { spend: 0, leads: 0, clicks: 0 }
  );
  const avgCpl = sum.leads ? sum.spend / sum.leads : null;

  return html`<div class="app">
    <div class="container">
      <header class="topbar">
        <div class="brand">
          <div class="brand__mark">◆</div>
          <div>
            <h1 class="brand__title">Отчётность по рекламе</h1>
            <div class="brand__sub">VK Ads · обновлено сегодня в 06:00</div>
          </div>
        </div>
        <div class="topbar__right">
          <span class="month">${monthLabel}</span>
          <span class="badge-demo">демо-данные</span>
        </div>
      </header>

      <section class="summary">
        <div class="summary__item">
          <div class="summary__label">Активных проектов</div>
          <div class="summary__value">${active.length}</div>
        </div>
        <div class="summary__item">
          <div class="summary__label">Расход за месяц</div>
          <div class="summary__value">${rub(sum.spend)}</div>
        </div>
        <div class="summary__item">
          <div class="summary__label">Заявок</div>
          <div class="summary__value">${num(sum.leads)}</div>
        </div>
        <div class="summary__item">
          <div class="summary__label">Средняя цена заявки</div>
          <div class="summary__value">${rub(avgCpl)}</div>
        </div>
      </section>

      <div class="toolbar">
        <div class="seg" role="group" aria-label="Метрика графика">
          ${METRICS.map(
            (m) => html`<button
              class=${"seg__btn" + (metric === m.key ? " is-on" : "")}
              onClick=${() => setMetric(m.key)}
            >
              ${m.label}
            </button>`
          )}
        </div>
        <span class="toolbar__hint">График по дням месяца</span>
      </div>

      <main class="grid">
        ${projects.map(
          (p) => html`<${Card} key=${p.id} p=${p} metric=${metric} />`
        )}
      </main>

      <footer class="foot">
        Прототип дашборда. Данные демонстрационные — при подключении VK Ads API
        цифры станут реальными, а формулы (цена заявки, цена перехода, конверсия)
        и внешний вид останутся теми же.
      </footer>
    </div>
  </div>`;
}
