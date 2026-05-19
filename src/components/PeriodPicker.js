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

export function PeriodPicker({ period, onChange, operations }) {
  const [open, setOpen] = useState(false);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const stripRef = useRef(null);

  const strip = useMemo(() => {
    const arr = [];
    for (let i = 9; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      arr.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    return arr;
  }, [today.getFullYear(), today.getMonth()]);

  // Индекс «фокального» месяца: выбранный или, если выбран нестандартный
  // период, — текущий (последний в ленте). Эффект «выпуклой линзы» будет
  // строиться от него: чем дальше месяц — тем меньше и бледнее.
  const selectedIdx = period?.kind === "specificMonth"
    ? strip.findIndex(m => m.year === period.year && m.month === period.month)
    : -1;
  const focalIdx = selectedIdx >= 0 ? selectedIdx : strip.length - 1;

  // Колесо мыши на ленте — горизонтальный скролл.
  // Не перехватываем колесо, если лента не нуждается в прокрутке
  // (иначе на широких экранах пользователь не сможет пролистать страницу).
  function onWheel(e) {
    const el = stripRef.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth + 2) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }

  // При смене фокального месяца плавно подкручиваем ленту, чтобы он оказался по центру.
  useEffect(() => {
    const container = stripRef.current;
    if (!container) return;
    const btn = container.querySelector(`[data-midx="${focalIdx}"]`);
    if (!btn) return;
    const target = btn.offsetLeft - container.clientWidth / 2 + btn.offsetWidth / 2;
    container.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [focalIdx]);

  return html`
    <div class="period-bar">
      <button class="period-chip" onClick=${() => setOpen(true)}>
        <span>Период</span> ${Icon.right()}
      </button>
      <div class="period-months" ref=${stripRef} onWheel=${onWheel}>
        ${strip.map((m, i) => {
          const prev = i > 0 ? strip[i - 1] : null;
          const yearChanged = prev && prev.year !== m.year;
          const isCurrent = sameSpecificMonth(period, m.year, m.month);
          const dist = Math.abs(i - focalIdx);
          // «Линза» — фокальный месяц крупнее, дальние мельче. Базовый scale
          // умеренный, чтобы при hover-ховере соседние месяца не накладывались.
          const scale = Math.max(0.8, 1.18 - dist * 0.085);
          const opacity = Math.max(0.62, 1 - dist * 0.08);
          const style = `--ps-scale: ${scale.toFixed(3)}; --ps-opacity: ${opacity.toFixed(2)};`;
          return html`
            ${yearChanged ? html`<span class="period-divider" aria-hidden="true">·</span>` : null}
            <button
              class=${"period-month" + (isCurrent ? " is-current" : "")}
              data-midx=${i}
              style=${style}
              onClick=${() => onChange({ kind: "specificMonth", year: m.year, month: m.month })}
              title=${monthLabel(m.year, m.month)}
              key=${`${m.year}-${m.month}`}>
              ${MONTHS_NOM[m.month]} <span class="period-month-year">${String(m.year).slice(-2)}</span>
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
