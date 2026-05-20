// Логика повторяющихся задач планера.
// Шаблон повтора — строка в `tasks` с непустым `recurrence` и якорной датой `date`.
// Повторения на конкретный день генерируются «на лету».
// Если пользователь меняет/выполняет/удаляет одно повторение — создаётся
// override-строка (recurrence_parent = id шаблона, occ_date = дата повторения).

import { fromISO } from "./format.js";

export const RECUR_OPTIONS = [
  { value: "", label: "Не повторять" },
  { value: "daily", label: "Каждый день" },
  { value: "weekdays", label: "По будням (Пн–Пт)" },
  { value: "weekly", label: "Каждую неделю" },
  { value: "biweekly", label: "Каждые 2 недели" },
  { value: "monthly", label: "Каждый месяц" },
];

export function recurLabel(rule) {
  const o = RECUR_OPTIONS.find(x => x.value === (rule || ""));
  return o ? o.label : "";
}

function daysBetween(aISO, bISO) {
  return Math.round((fromISO(bISO) - fromISO(aISO)) / 86400000);
}

// Происходит ли повторение шаблона в указанный день?
export function occursOn(tmpl, dateISO) {
  if (!tmpl.recurrence || !tmpl.date) return false;
  if (dateISO < tmpl.date) return false;
  if (tmpl.recurrence_until && dateISO > tmpl.recurrence_until) return false;
  const d = fromISO(dateISO);
  const wd = d.getDay(); // 0 = вс
  switch (tmpl.recurrence) {
    case "daily": return true;
    case "weekdays": return wd >= 1 && wd <= 5;
    case "weekly": return daysBetween(tmpl.date, dateISO) % 7 === 0;
    case "biweekly": return daysBetween(tmpl.date, dateISO) % 14 === 0;
    case "monthly": return fromISO(tmpl.date).getDate() === d.getDate();
    default: return false;
  }
}

function base(t) {
  return {
    title: t.title,
    notes: t.notes || "",
    color: t.color || null,
    list_id: t.list_id || null,
    start_min: t.start_min,
    duration_min: t.duration_min,
  };
}

function concreteItem(t) {
  return {
    key: t.id, kind: "concrete", id: t.id, templateId: null, occDate: t.date,
    recurring: false, done: !!t.done, ...base(t),
  };
}

function virtualItem(tmpl, dateISO) {
  return {
    key: tmpl.id + "|" + dateISO, kind: "occurrence", id: null,
    templateId: tmpl.id, occDate: dateISO, recurring: true, done: false, ...base(tmpl),
  };
}

function overrideItem(tmpl, ov, dateISO) {
  const pick = (a, b) => (a === null || a === undefined ? b : a);
  return {
    key: tmpl.id + "|" + dateISO, kind: "occurrence", id: ov.id,
    templateId: tmpl.id, occDate: dateISO, recurring: true, done: !!ov.done,
    title: pick(ov.title, tmpl.title),
    notes: pick(ov.notes, tmpl.notes) || "",
    color: pick(ov.color, tmpl.color),
    list_id: pick(ov.list_id, tmpl.list_id),
    start_min: pick(ov.start_min, tmpl.start_min),
    duration_min: pick(ov.duration_min, tmpl.duration_min),
  };
}

// Все элементы (разовые + повторения) на конкретный день.
export function itemsForDate(tasks, dateISO) {
  const items = [];
  const overrides = new Map();
  for (const t of tasks) {
    if (t.recurrence_parent && t.occ_date) {
      overrides.set(t.recurrence_parent + "|" + t.occ_date, t);
    }
  }
  for (const t of tasks) {
    if (!t.recurrence && !t.recurrence_parent) {
      if (t.date === dateISO) items.push(concreteItem(t));
      continue;
    }
    if (t.recurrence && !t.recurrence_parent) {
      if (!occursOn(t, dateISO)) continue;
      const ov = overrides.get(t.id + "|" + dateISO);
      if (ov) {
        if (ov.skipped) continue;
        items.push(overrideItem(t, ov, dateISO));
      } else {
        items.push(virtualItem(t, dateISO));
      }
    }
  }
  return items;
}

// Незапланированные задачи (без даты) — «Входящие» и содержимое списков.
export function unscheduledTasks(tasks) {
  return tasks.filter(t => !t.recurrence_parent && !t.recurrence && !t.date);
}

// ---- Время ----
export function minToHHMM(m) {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  return String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

export function hhmmToMin(s) {
  const [h, m] = String(s || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minRangeLabel(start, dur) {
  if (start === null || start === undefined) return "";
  return minToHHMM(start) + "–" + minToHHMM(start + (dur || 0));
}
