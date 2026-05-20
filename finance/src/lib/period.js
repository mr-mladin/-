// Помощник для работы с периодами на странице.
// Период — объект формы { kind, ... }. Возвращаемая форма: { startISO, endISO, label, locative }.

import { toISO, fromISO, formatDate, startOfWeek } from "./format.js";

const MONTHS_NOM = [
  "Январь","Февраль","Март","Апрель","Май","Июнь",
  "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь",
];
const MONTHS_LOC = [
  "январе","феврале","марте","апреле","мае","июне",
  "июле","августе","сентябре","октябре","ноябре","декабре",
];

function startOfDay(d) {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

export function monthLabel(year, month) {
  return `${MONTHS_NOM[month]} ${year}`;
}

export function defaultPeriod(today = new Date()) {
  return { kind: "specificMonth", year: today.getFullYear(), month: today.getMonth() };
}

export function resolvePeriod(p, today = new Date(), weekStart = 1) {
  today = startOfDay(today);
  const todayISO = toISO(today);

  switch (p.kind) {
    case "today":
      return { startISO: todayISO, endISO: todayISO, label: "Сегодня", locative: "сегодня" };

    case "yesterday": {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      const yISO = toISO(y);
      return { startISO: yISO, endISO: yISO, label: "Вчера", locative: "вчера" };
    }

    case "thisWeek": {
      const s = startOfWeek(today, weekStart);
      const e = new Date(s); e.setDate(e.getDate() + 6);
      return { startISO: toISO(s), endISO: toISO(e), label: "Эта неделя", locative: "на этой неделе" };
    }

    case "lastWeek": {
      const s = startOfWeek(today, weekStart);
      s.setDate(s.getDate() - 7);
      const e = new Date(s); e.setDate(e.getDate() + 6);
      return { startISO: toISO(s), endISO: toISO(e), label: "Прошлая неделя", locative: "на прошлой неделе" };
    }

    case "thisMonth": {
      const s = new Date(today.getFullYear(), today.getMonth(), 1);
      const e = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return {
        startISO: toISO(s), endISO: toISO(e),
        label: monthLabel(s.getFullYear(), s.getMonth()),
        locative: `в ${MONTHS_LOC[s.getMonth()]}`,
      };
    }

    case "lastMonth": {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const e = new Date(today.getFullYear(), today.getMonth(), 0);
      return {
        startISO: toISO(s), endISO: toISO(e),
        label: monthLabel(s.getFullYear(), s.getMonth()),
        locative: `в ${MONTHS_LOC[s.getMonth()]}`,
      };
    }

    case "lastDays": {
      const n = Math.max(1, Number(p.n) || 7);
      const s = new Date(today); s.setDate(s.getDate() - (n - 1));
      return {
        startISO: toISO(s), endISO: todayISO,
        label: `Последние ${n} дней`, locative: `за последние ${n} дней`,
      };
    }

    case "specificMonth": {
      const s = new Date(p.year, p.month, 1);
      const e = new Date(p.year, p.month + 1, 0);
      return {
        startISO: toISO(s), endISO: toISO(e),
        label: monthLabel(p.year, p.month),
        locative: `в ${MONTHS_LOC[p.month]}`,
      };
    }

    case "custom": {
      const s = p.startDate || todayISO;
      const e = p.endDate || todayISO;
      return {
        startISO: s, endISO: e,
        label: `${formatDate(s)} – ${formatDate(e)}`,
        locative: "за выбранный период",
      };
    }

    case "all":
      return {
        startISO: "0000-01-01", endISO: todayISO,
        label: "Вся история", locative: "за всё время",
      };

    default:
      return resolvePeriod(defaultPeriod(today), today, weekStart);
  }
}

// Период такой же длины, идущий непосредственно ДО заданного.
export function previousPeriod(startISO, endISO) {
  const s = fromISO(startISO);
  const e = fromISO(endISO);
  if (!s || !e) return { startISO, endISO };
  const days = Math.round((e - s) / 86400000) + 1;
  const newEnd = new Date(s); newEnd.setDate(newEnd.getDate() - 1);
  const newStart = new Date(newEnd); newStart.setDate(newStart.getDate() - days + 1);
  return { startISO: toISO(newStart), endISO: toISO(newEnd) };
}

export { MONTHS_NOM, MONTHS_LOC };
