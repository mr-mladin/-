import { html } from "htm/preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Icon } from "../lib/icons.js";
import { Modal } from "./Modal.js";
import { MONTHS_NOM, resolvePeriod, monthLabel } from "../lib/period.js";
import { toISO, fromISO } from "../lib/format.js";

const QUICK = [
  { kind: "today",      label: "Сегодня" },
  { kind: "yesterday",  label: "Вчера" },
  { kind: "thisWeek",   label: "Эта неделя" },
  { kind: "lastWeek",   label: "Прошлая неделя" },
  { kind: "thisMonth",  label: "Этот месяц" },
  { kind: "lastMonth",  label: "Прошлый месяц" },
];

const DAYS = [7, 14, 30, 90, 365];

function sameSpecificMonth(period, year, month) {
  return period?.kind === "specificMonth" && period.year === year && period.month === month;
}

function isSamePreset(period, kind, extra) {
  if (period?.kind !== kind) return false;
  if (kind === "lastDays") return period.n === extra;
  return true;
}

export function PeriodPicker({ period, onChange, operations, plannedOperations }) {
  const [open, setOpen] = useState(false);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const stripRef = useRef(null);
  const metricsRef = useRef([]);

  // Лента содержит только «актуальные» месяцы — непрерывный диапазон от самого
  // раннего месяца с операциями до самого позднего месяца с операциями или
  // запланированными операциями. Текущий месяц всегда входит в диапазон.
  // Пустые «хвосты» (месяцы без активности до/после) не показываются.
  const strip = useMemo(() => {
    const curIdx = today.getFullYear() * 12 + today.getMonth();
    let minIdx = curIdx, maxIdx = curIdx;
    const consume = (dateStr) => {
      if (!dateStr) return;
      const y = Number(dateStr.slice(0, 4));
      const m = Number(dateStr.slice(5, 7)) - 1;
      if (!Number.isFinite(y) || !Number.isFinite(m)) return;
      const idx = y * 12 + m;
      if (idx < minIdx) minIdx = idx;
      if (idx > maxIdx) maxIdx = idx;
    };
    for (const op of operations || []) consume(op?.date);
    for (const p of plannedOperations || []) { if (!p?.is_done) consume(p?.date); }
    const arr = [];
    for (let idx = minIdx; idx <= maxIdx; idx++) {
      arr.push({ year: Math.floor(idx / 12), month: idx % 12 });
    }
    return arr;
  }, [today.getFullYear(), today.getMonth(), operations, plannedOperations]);

  // Индекс для авто-центрирования: выбранный месяц, иначе текущий.
  const focalIdx = useMemo(() => {
    if (period?.kind === "specificMonth") {
      const i = strip.findIndex(m => m.year === period.year && m.month === period.month);
      if (i >= 0) return i;
    }
    return strip.findIndex(m => m.year === today.getFullYear() && m.month === today.getMonth());
  }, [strip, period]);

  // 3D-кольцо сбоку: центр обращён к нам, к краям месяца отворачиваются по оси
  // Y (rotateY) с собственной перспективой — дальняя сторона уходит вглубь,
  // ближняя крупнее, как обод колеса. perspective() задаём прямо в трансформе
  // каждого элемента — тогда 3D работает даже внутри скролл-контейнера (overflow
  // не «сплющивает» сцену). Угол ограничен ±52°, чтобы текст не выворачивался.
  function applyCurve() {
    const el = stripRef.current;
    if (!el) return;
    const half = el.clientWidth / 2;
    if (half <= 0) return;
    const viewCenter = el.scrollLeft + half;
    for (const m of metricsRef.current) {
      let t = (m.center - viewCenter) / half;
      t = Math.max(-1.5, Math.min(1.5, t));
      const abs = Math.abs(t);
      const roty = Math.max(-52, Math.min(52, t * 38));
      const scale = Math.max(0.72, 1.08 - abs * 0.14);
      const op = Math.max(0.4, 1 - abs * 0.42);
      const s = m.el.style;
      s.setProperty("--ps-roty", roty.toFixed(1) + "deg");
      s.setProperty("--ps-scale", scale.toFixed(3));
      s.setProperty("--ps-opacity", op.toFixed(2));
    }
  }

  function recomputeMetrics() {
    const el = stripRef.current;
    if (!el) return;
    const items = [...el.querySelectorAll("[data-midx]")];
    metricsRef.current = items.map(it => ({ el: it, center: it.offsetLeft + it.offsetWidth / 2 }));
    applyCurve();
  }

  // Колесо → горизонтальный скролл; на каждый скролл — пересчёт дуги (через rAF).
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    function onWheel(e) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }
    let raf = null;
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = null; applyCurve(); });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", recomputeMetrics);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", recomputeMetrics);
    };
  }, []);

  // Список месяцев изменился — пересчитать позиции.
  useEffect(() => { recomputeMetrics(); }, [strip]);

  // Центрируем фокальный месяц. scrollIntoView(inline:center) центрирует строго
  // внутри ленты независимо от offsetParent; block:nearest не даёт прокрутиться
  // самой странице по вертикали.
  useEffect(() => {
    const el = stripRef.current;
    if (!el || focalIdx < 0) return;
    const btn = el.querySelector(`[data-midx="${focalIdx}"]`);
    if (!btn) return;
    btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [focalIdx, strip]);

  return html`
    <div class="period-bar">
      <button class="period-chip" onClick=${() => setOpen(true)}>
        <span>Период</span> ${Icon.right()}
      </button>
      <div class="period-months period-ring" ref=${stripRef}>
        ${strip.map((m, i) => {
          const isCurrent = sameSpecificMonth(period, m.year, m.month);
          const otherYear = m.year !== today.getFullYear();
          return html`
            <button
              class=${"period-month" + (isCurrent ? " is-current" : "")}
              data-midx=${i}
              onClick=${() => onChange({ kind: "specificMonth", year: m.year, month: m.month })}
              title=${monthLabel(m.year, m.month)}
              key=${`${m.year}-${m.month}`}>
              ${MONTHS_NOM[m.month]}${otherYear ? html` <span class="period-month-year">${m.year}</span>` : null}
            </button>
          `;
        })}
      </div>
    </div>

    ${open && html`<${PeriodModal}
      period=${period}
      operations=${operations}
      onPick=${(p) => { onChange(p); setOpen(false); }}
      onClose=${() => setOpen(false)} />`}
  `;
}

function PeriodModal({ period, operations, onPick, onClose }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const curYear = today.getFullYear();

  const years = useMemo(() => {
    const set = new Set([curYear]);
    for (const op of operations || []) {
      if (op?.date) set.add(Number(op.date.slice(0, 4)));
    }
    return [...set].sort((a, b) => b - a);
  }, [operations, curYear]);

  const [expandedYears, setExpandedYears] = useState(() => new Set([curYear]));
  const [customStart, setCustomStart] = useState(() => period.kind === "custom" ? period.startDate : "");
  const [customEnd, setCustomEnd] = useState(() => period.kind === "custom" ? period.endDate : "");
  const [showCustom, setShowCustom] = useState(period.kind === "custom");

  function toggleYear(y) {
    setExpandedYears(s => {
      const next = new Set(s);
      if (next.has(y)) next.delete(y); else next.add(y);
      return next;
    });
  }

  function applyCustom() {
    if (!customStart || !customEnd) return;
    const s = customStart <= customEnd ? customStart : customEnd;
    const e = customStart <= customEnd ? customEnd : customStart;
    onPick({ kind: "custom", startDate: s, endDate: e });
  }

  return html`
    <${Modal} title="Период" onClose=${onClose}>
      <div class="period-modal">
        <div class="period-section">
          <div class="period-section-head">Актуальные периоды</div>
          ${QUICK.map(q => html`
            <button
              class=${"period-item" + (isSamePreset(period, q.kind) ? " is-active" : "")}
              onClick=${() => onPick({ kind: q.kind })}
              key=${q.kind}>
              <span class="period-item-ico">${Icon.dashboard()}</span>
              <span>${q.label}</span>
            </button>
          `)}
        </div>

        <div class="period-section">
          <div class="period-section-head">Последние дни</div>
          ${DAYS.map(n => html`
            <button
              class=${"period-item" + (isSamePreset(period, "lastDays", n) ? " is-active" : "")}
              onClick=${() => onPick({ kind: "lastDays", n })}
              key=${n}>
              <span class="period-item-ico">${Icon.dashboard()}</span>
              <span>Последние ${n} дней</span>
            </button>
          `)}
        </div>

        <div class="period-section">
          <button
            class=${"period-item" + (period.kind === "custom" ? " is-active" : "")}
            onClick=${() => setShowCustom(s => !s)}>
            <span class="period-item-ico">${Icon.dashboard()}</span>
            <span>Выбрать даты</span>
          </button>
          ${showCustom && html`
            <div class="period-custom">
              <div class="row cols-2">
                <div class="field">
                  <label>С</label>
                  <input class="input" type="date" value=${customStart} onInput=${e => setCustomStart(e.target.value)} />
                </div>
                <div class="field">
                  <label>По</label>
                  <input class="input" type="date" value=${customEnd} onInput=${e => setCustomEnd(e.target.value)} />
                </div>
              </div>
              <button class="btn primary sm" style="margin-top:8px;"
                      disabled=${!customStart || !customEnd}
                      onClick=${applyCustom}>Применить</button>
            </div>
          `}

          <button
            class=${"period-item" + (period.kind === "all" ? " is-active" : "")}
            onClick=${() => onPick({ kind: "all" })}>
            <span class="period-item-ico">${Icon.dashboard()}</span>
            <div class="period-item-main">
              <div>Вся история</div>
              <div class="muted" style="font-size:12px;">Все операции до конца текущего дня</div>
            </div>
          </button>
        </div>

        ${years.map(y => {
          const expanded = expandedYears.has(y);
          return html`
            <div class="period-section" key=${y}>
              <button class="period-year-head" onClick=${() => toggleYear(y)}>
                <span class="period-chev ${expanded ? "is-down" : ""}">${Icon.right()}</span>
                <span>${y}</span>
              </button>
              ${expanded && html`
                <div class="period-year-body">
                  ${MONTHS_NOM.map((name, idx) => {
                    const isFuture = y > curYear || (y === curYear && idx > today.getMonth());
                    if (isFuture) return null;
                    const isSel = sameSpecificMonth(period, y, idx);
                    return html`
                      <button
                        class=${"period-item" + (isSel ? " is-active" : "")}
                        onClick=${() => onPick({ kind: "specificMonth", year: y, month: idx })}
                        key=${`${y}-${idx}`}>
                        <span class="period-item-ico">${Icon.right()}</span>
                        <span>${name}</span>
                        ${isSel ? html`<span class="period-check">${Icon.check()}</span>` : null}
                      </button>
                    `;
                  })}
                </div>
              `}
            </div>
          `;
        })}
      </div>
    <//>
  `;
}
