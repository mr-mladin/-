// Общая библиотека планера: клиент Supabase, помощники дат/времени,
// логика повторяющихся задач и иконки. Самостоятельный модуль — не связан
// с финансовым приложением, только переиспользует тот же проект Supabase.

import { createClient } from "@supabase/supabase-js";
import { html } from "htm/preact";

// Тот же проект Supabase, но отдельные таблицы (task_lists, tasks).
// Общий ключ сессии "fin.auth" => общий вход с финансовым приложением.
export const SUPABASE_URL = "https://rxzjbyuxslzcnlkzdxqn.supabase.co";
export const SUPABASE_KEY = "sb_publishable_AQQdPOIOwksIkpNZ7W6KdA_Fy5f4xa3";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: "planner" },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: "fin.auth",
    // Планер и финансы делят один ключ сессии "fin.auth". Стандартная
    // межвкладочная блокировка supabase-js (navigator.locks) при этом может
    // не освободиться и навсегда подвесить запросы (запись уходит на сервер,
    // но промис не завершается). Для приложения одного пользователя блокировка
    // не нужна — выполняем операцию сразу, без ожидания лока.
    lock: (_name, _acquireTimeout, fn) => fn(),
  },
});

// ---------- Даты ----------
export function toISO(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function todayISO() { return toISO(new Date()); }
export function fromISO(s) {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const WD_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
export function weekdayFull(d) { return WD_FULL[d.getDay()]; }
export function monthGen(d) { return MONTHS_GEN[d.getMonth()]; }
export function monthNom(d) { return MONTHS_NOM[d.getMonth()]; }

// Понедельник недели, в которую попадает дата.
export function weekStart(date) {
  const base = date instanceof Date ? new Date(date) : fromISO(date);
  const off = (base.getDay() + 6) % 7;
  base.setDate(base.getDate() - off);
  base.setHours(0, 0, 0, 0);
  return base;
}

// Подпись диапазона недели: «12–18 мая» либо «28 апр – 4 мая».
export function weekRangeLabel(date) {
  const mon = weekStart(date);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  if (mon.getMonth() === sun.getMonth()) return `${mon.getDate()}–${sun.getDate()} ${MONTHS_GEN[mon.getMonth()]}`;
  return `${mon.getDate()} ${SHORT[mon.getMonth()]} – ${sun.getDate()} ${SHORT[sun.getMonth()]}`;
}

// Сетка месяца: массив недель по 7 дней (Пн–Вс), с «хвостами» соседних месяцев.
export function monthMatrix(date) {
  const d = date instanceof Date ? date : fromISO(date);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const mon = weekStart(first);
  const month = d.getMonth();
  const today = todayISO();
  const weeks = [];
  let cur = new Date(mon);
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      const iso = toISO(cur);
      row.push({ iso, day: cur.getDate(), inMonth: cur.getMonth() === month, isToday: iso === today });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(row);
    if (w >= 4 && cur.getMonth() !== month) break;
  }
  return weeks;
}
export function relLabel(iso) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((fromISO(iso) - today) / 86400000);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Завтра";
  if (diff === -1) return "Вчера";
  return "";
}

// ---------- Время ----------
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

// ---------- Повторения ----------
export const RECUR_OPTIONS = [
  { value: "", label: "Не повторять" },
  { value: "daily", label: "Каждый день" },
  { value: "weekdays", label: "По будням (Пн–Пт)" },
  { value: "weekly", label: "Каждую неделю" },
  { value: "biweekly", label: "Каждые 2 недели" },
  { value: "monthly", label: "Каждый месяц" },
];

function daysBetween(aISO, bISO) {
  return Math.round((fromISO(bISO) - fromISO(aISO)) / 86400000);
}

export function occursOn(tmpl, dateISO) {
  if (!tmpl.recurrence || !tmpl.date) return false;
  if (dateISO < tmpl.date) return false;
  if (tmpl.recurrence_until && dateISO > tmpl.recurrence_until) return false;
  const d = fromISO(dateISO);
  const wd = d.getDay();
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
    title: t.title, notes: t.notes || "", color: t.color || null,
    list_id: t.list_id || null, start_min: t.start_min, duration_min: t.duration_min,
  };
}
function concreteItem(t) {
  return { key: t.id, kind: "concrete", id: t.id, templateId: null, occDate: t.date,
    recurring: false, done: !!t.done, ...base(t) };
}
function virtualItem(tmpl, dateISO) {
  return { key: tmpl.id + "|" + dateISO, kind: "occurrence", id: null,
    templateId: tmpl.id, occDate: dateISO, recurring: true, done: false, ...base(tmpl) };
}
function overrideItem(tmpl, ov, dateISO) {
  const pick = (a, b) => (a === null || a === undefined ? b : a);
  return {
    key: tmpl.id + "|" + dateISO, kind: "occurrence", id: ov.id,
    templateId: tmpl.id, occDate: dateISO, recurring: true, done: !!ov.done,
    title: pick(ov.title, tmpl.title), notes: pick(ov.notes, tmpl.notes) || "",
    color: pick(ov.color, tmpl.color), list_id: pick(ov.list_id, tmpl.list_id),
    start_min: pick(ov.start_min, tmpl.start_min), duration_min: pick(ov.duration_min, tmpl.duration_min),
  };
}

export function itemsForDate(tasks, dateISO) {
  const items = [];
  const overrides = new Map();
  for (const t of tasks) {
    if (t.recurrence_parent && t.occ_date) overrides.set(t.recurrence_parent + "|" + t.occ_date, t);
  }
  for (const t of tasks) {
    if (!t.recurrence && !t.recurrence_parent) {
      if (t.date === dateISO) items.push(concreteItem(t));
      continue;
    }
    if (t.recurrence && !t.recurrence_parent) {
      if (!occursOn(t, dateISO)) continue;
      const ov = overrides.get(t.id + "|" + dateISO);
      if (ov) { if (!ov.skipped) items.push(overrideItem(t, ov, dateISO)); }
      else items.push(virtualItem(t, dateISO));
    }
  }
  return items;
}

export function unscheduledTasks(tasks) {
  return tasks.filter(t => !t.recurrence_parent && !t.recurrence && !t.date);
}

// ---------- Тема ----------
export function applyTheme(mode) {
  let resolved = mode;
  if (mode === "auto") {
    resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", resolved);
  try { localStorage.setItem("planner.theme", mode); } catch (e) {}
}

// ---------- Иконки ----------
const wrap = (path) => html`
  <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export const Icon = {
  plus: () => wrap(html`<path d="M12 5v14M5 12h14"/>`),
  trash: () => wrap(html`<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>`),
  close: () => wrap(html`<path d="M6 6l12 12M18 6L6 18"/>`),
  left: () => wrap(html`<path d="M15 18l-6-6 6-6"/>`),
  right: () => wrap(html`<path d="M9 6l6 6-6 6"/>`),
  check: () => wrap(html`<path d="M5 13l4 4L19 7"/>`),
  calendar: () => wrap(html`<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>`),
  inbox: () => wrap(html`<path d="M5 5h14l2 7v7H3v-7z"/><path d="M3 12h5l2 3h4l2-3h5"/>`),
  clock: () => wrap(html`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`),
  repeat: () => wrap(html`<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`),
  dot: () => wrap(html`<circle cx="12" cy="12" r="3" fill="currentColor"/>`),
  sun: () => wrap(html`<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>`),
  moon: () => wrap(html`<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>`),
  signout: () => wrap(html`<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>`),
  edit: () => wrap(html`<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>`),
  note: () => wrap(html`<path d="M4 5h16M4 10h16M4 15h10"/>`),
};
