// Общая библиотека планера: клиент Supabase, помощники дат/времени,
// логика повторяющихся задач и иконки. Самостоятельный модуль — не связан
// с финансовым приложением, только переиспользует тот же проект Supabase.

import { createClient } from "@supabase/supabase-js";
import { html } from "htm/preact";

// Тот же проект Supabase, но отдельные таблицы (task_lists, tasks).
// Общий ключ сессии "fin.auth" => общий вход с финансовым приложением.
export const SUPABASE_URL = "https://rxzjbyuxslzcnlkzdxqn.supabase.co";
export const SUPABASE_KEY = "sb_publishable_AQQdPOIOwksIkpNZ7W6KdA_Fy5f4xa3";

// Сетевой запрос с тайм-аутом и автоповтором. Без тайм-аута зависший ответ
// Supabase висит вечно (вечная крутилка / форма «Сохранение…» без конца). А без
// повтора одиночный сетевой сбой/обрыв (мобильная сеть моргнула, соединение
// сбросилось) роняет сохранение, и правка молча откатывается. Поэтому:
//  • идемпотентные запросы (GET/PATCH/DELETE/PUT = чтение, update, удаление)
//    при сетевом сбое/abort повторяем пару раз с паузой;
//  • POST (вставка) НЕ повторяем автоматически — иначе можно создать дубль;
//  • уважаем signal, который мог передать сам supabase (его отмена не повторяется).
const FETCH_TIMEOUT = 20000;
const RETRY_PAUSES = [500, 1200];
function fetchWithTimeout(input, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  const idempotent = method === "GET" || method === "PATCH" || method === "DELETE" || method === "PUT";
  const attempt = (n) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    // Свой тайм-аут-сигнал + (если есть) сигнал отмены от supabase.
    let signal = ctrl.signal;
    if (init.signal && typeof AbortSignal !== "undefined" && AbortSignal.any) {
      try { signal = AbortSignal.any([ctrl.signal, init.signal]); } catch (e) {}
    }
    return fetch(input, { ...init, signal })
      .finally(() => clearTimeout(timer))
      .catch((err) => {
        // Сам вызывающий (supabase) отменил запрос — не повторяем, пробрасываем.
        if (init.signal && init.signal.aborted) throw err;
        const netOrAbort = err && (err.name === "AbortError" || err.name === "TypeError"
          || /fetch|network|load failed|timeout|connection/i.test(err.message || ""));
        if (netOrAbort && idempotent && n < RETRY_PAUSES.length) {
          return new Promise((res) => setTimeout(res, RETRY_PAUSES[n])).then(() => attempt(n + 1));
        }
        throw err;
      });
  };
  return attempt(0);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: "planner" },
  global: { fetch: fetchWithTimeout },
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

// Человекочитаемое русское сообщение об ошибке для тостов/форм. Технический текст
// (AbortError, Load failed, Fetch is aborted и т.п.) наружу не показываем.
export function errHint(msg, action = "сохранить") {
  const m = String(msg || "");
  if (/relation|does not exist/i.test(m)) return "Таблицы планера ещё не созданы в базе.";
  if (/schema cache|could not find the .* column/i.test(m)) return "База обновляет схему. Подождите пару секунд и повторите.";
  if (/fetch|network|timeout|connect|reset|load failed|failed to fetch|networkerror|abort|signal|503|unavailable/i.test(m))
    return "Нет связи с базой. Проверьте интернет и попробуйте снова.";
  return "Не удалось " + action + ". Попробуйте ещё раз.";
}

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

// Сетка месяца: всегда 6 недель по 7 дней (Пн–Вс), с «хвостами» соседних
// месяцев. Фиксированное число строк — чтобы размер ячеек не менялся
// от месяца к месяцу (как в Apple Календаре).
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

export function durHuman(m) {
  m = Math.max(0, Math.round(m || 0));
  const h = Math.floor(m / 60), mm = m % 60;
  if (h && mm) return `${h} ч ${mm} мин`;
  if (h) return `${h} ч`;
  return `${mm} мин`;
}

// Ведущий эмодзи названия выносим в кружок-иконку пилюли. Берём первый
// графемный кластер через Intl.Segmenter — он не рвёт эмодзи на части
// (модификаторы тона кожи 🏻–🏿, ZWJ-последовательности, флаги собираются
// в один символ). Прежняя регулярка теряла тон кожи и оставляла «битый»
// остаток в названии.
export function splitEmoji(title) {
  const t = title || "";
  if (!t) return { emoji: "", text: "" };
  let first = "";
  try {
    const it = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t);
    first = it[Symbol.iterator]().next().value?.segment || "";
  } catch (e) {
    const m = t.match(/^\p{Extended_Pictographic}[‍️\p{Emoji_Modifier}\p{Extended_Pictographic}]*/u);
    first = m ? m[0] : "";
  }
  // Кружок-иконка только если первый символ — собственно эмодзи (картинка или
  // флаг), а не буква/цифра.
  if (first && /^(\p{Extended_Pictographic}|\p{Regional_Indicator})/u.test(first)) {
    return { emoji: first, text: t.slice(first.length).replace(/^\s+/, "") };
  }
  return { emoji: "", text: t };
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
    title: t.title, notes: t.notes || "", color: t.color || null, icon: t.icon || null,
    list_id: t.list_id || null, area_id: t.area_id || null, start_min: t.start_min, duration_min: t.duration_min,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
    is_event: !!t.is_event, card_bar: t.card_bar || null, card_bg: t.card_bg || null,
  };
}
// Прогресс подзадач: { done, total }.
export function subProgress(subs) {
  const a = Array.isArray(subs) ? subs : [];
  return { done: a.filter(s => s && s.done).length, total: a.length };
}
// Фон-«волны» для карточки события: SVG-плитка цвета события (или нейтральная,
// если цвет — CSS-переменная). Возвращает строку url(...) для background-image.
function hexA(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
export function waveDataUrl(color, kind) {
  const ok = typeof color === "string" && color[0] === "#" && color.length >= 7;
  const st = ok ? hexA(color, 0.26) : "rgba(100,116,139,0.26)";
  let svg;
  if (kind === "waves2") {
    // Морские свеллы: шире, выше, мягче.
    svg = `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='14'><path d='M0 9 q7 -7 14 0 t14 0' fill='none' stroke='${st}' stroke-width='1.2'/></svg>`;
  } else {
    // Лёгкая рябь.
    svg = `<svg xmlns='http://www.w3.org/2000/svg' width='20' height='10'><path d='M0 5 q5 -4 10 0 t10 0' fill='none' stroke='${st}' stroke-width='1.1'/></svg>`;
  }
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
// Видимый сегмент задачи в дне со смещением off (в днях от даты задачи). Задача
// может тянуться за полночь: в свой день обрезается на 00:00, в следующий —
// продолжается с 00:00. Возвращает {vTop,vEnd,spanTop,spanBottom,cont} или null.
function segment(start, dur, off) {
  if (start === null || start === undefined) return off === 0 ? { vTop: null, vEnd: null, spanTop: false, spanBottom: false, cont: false } : null;
  const end = start + (dur || 0);
  const ws = off * 1440, we = ws + 1440;
  const s = Math.max(start, ws), e = Math.min(end, we);
  if (e <= s) return null;
  return { vTop: s - ws, vEnd: e - ws, spanTop: off > 0, spanBottom: end > we, cont: off > 0 };
}
const pick = (a, b) => (a === null || a === undefined ? b : a);
function addDaysISO(iso, n) { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); }

function concreteItem(t, sg, dateISO) {
  return { key: t.id + (sg.cont ? "|" + dateISO : ""), kind: "concrete", id: t.id, templateId: null, occDate: t.date,
    recurring: false, done: !!t.done, ...base(t),
    vTop: sg.vTop, vEnd: sg.vEnd, spanTop: sg.spanTop, spanBottom: sg.spanBottom, cont: sg.cont };
}
// Элемент повторения. ov — строка-исключение (или null = виртуальное), occDate —
// дата самого повторения, off — смещение дня показа (0 — в свой день, 1 —
// продолжение за полночь на следующий день), keyDate — день показа (для ключа).
function recurItem(tmpl, ov, occDate, off, keyDate) {
  const start = ov ? pick(ov.start_min, tmpl.start_min) : tmpl.start_min;
  const dur = ov ? pick(ov.duration_min, tmpl.duration_min) : tmpl.duration_min;
  const sg = segment(start, dur, off);
  if (!sg) return null;
  return {
    key: tmpl.id + "|" + keyDate + (off > 0 ? "|c" : ""), kind: "occurrence", id: ov ? ov.id : null,
    templateId: tmpl.id, occDate, recurring: true, done: ov ? !!ov.done : false,
    title: ov ? pick(ov.title, tmpl.title) : tmpl.title,
    notes: (ov ? pick(ov.notes, tmpl.notes) : tmpl.notes) || "",
    color: ov ? pick(ov.color, tmpl.color) : tmpl.color,
    list_id: ov ? pick(ov.list_id, tmpl.list_id) : tmpl.list_id,
    area_id: ov ? pick(ov.area_id, tmpl.area_id) : tmpl.area_id,
    start_min: start, duration_min: dur,
    subtasks: Array.isArray(tmpl.subtasks) ? tmpl.subtasks : [],
    is_event: !!tmpl.is_event, card_bar: tmpl.card_bar || null, card_bg: tmpl.card_bg || null,
    vTop: sg.vTop, vEnd: sg.vEnd, spanTop: sg.spanTop, spanBottom: sg.spanBottom, cont: sg.cont,
  };
}

export function itemsForDate(tasks, dateISO) {
  const items = [];
  const overrides = new Map();
  for (const t of tasks) {
    if (t.recurrence_parent && t.occ_date) overrides.set(t.recurrence_parent + "|" + t.occ_date, t);
  }
  for (const t of tasks) {
    if (t.deleted_at) continue; // в корзине — в сетке дня не показываем
    if (!t.recurrence && !t.recurrence_parent) {
      if (!t.date) continue;
      const off = daysBetween(t.date, dateISO);
      if (off < 0) continue;
      const sg = segment(t.start_min, t.duration_min, off);
      if (!sg) continue;
      items.push(concreteItem(t, sg, dateISO));
      continue;
    }
    if (t.recurrence && !t.recurrence_parent) {
      // повторение, начинающееся сегодня
      if (occursOn(t, dateISO)) {
        const ov = overrides.get(t.id + "|" + dateISO);
        if (!(ov && ov.skipped)) { const it = recurItem(t, ov, dateISO, 0, dateISO); if (it) items.push(it); }
      }
      // продолжение со вчерашнего повторения (задача переходит за полночь)
      const prev = addDaysISO(dateISO, -1);
      if (occursOn(t, prev)) {
        const ovp = overrides.get(t.id + "|" + prev);
        if (!(ovp && ovp.skipped)) { const it = recurItem(t, ovp, prev, 1, dateISO); if (it) items.push(it); }
      }
    }
  }
  return items;
}

export function unscheduledTasks(tasks) {
  return tasks.filter(t => !t.recurrence_parent && !t.recurrence && !t.date && !t.deleted_at);
}

// Принадлежит ли задача/проект текущему фильтру боковой панели. Работает и над
// «сырой» задачей, и над элементом дня — нужны лишь поля list_id/area_id.
// areaOfList(list_id) → area_id проекта (или null). Спецфильтры done/trash сюда
// не попадают — у них своя логика (показ по done/deleted_at, а не по проекту).
export function matchesFilter(t, filter, areaOfList) {
  if (filter === "all") return true;
  if (filter === "inbox") return !t.list_id && !t.area_id;
  if (filter && filter.startsWith("area:")) {
    const aid = filter.slice(5);
    return t.area_id === aid || (t.list_id ? areaOfList(t.list_id) === aid : false);
  }
  return t.list_id === filter;
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

// ---------- Тактильный отклик и звук ----------
// Вибрация (хаптик) на iPhone через стандартный navigator.vibrate не работает.
// Трюк: системный «свитч»-чекбокс при переключении даёт лёгкий хаптик-«тук».
// Работает на свежих iOS, если в настройках включены «системные хаптики».
let hapticEl = null;
export function haptic() {
  try {
    if (!hapticEl) {
      const label = document.createElement("label");
      label.setAttribute("aria-hidden", "true");
      label.style.cssText = "position:fixed;left:-9999px;width:0;height:0;overflow:hidden;";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.setAttribute("switch", "");
      label.appendChild(cb);
      document.body.appendChild(label);
      hapticEl = label;
    }
    hapticEl.click();
  } catch (e) {}
}

export function doneFeedback() { haptic(); }

// ---------- Иконки ----------
const wrap = (path) => html`
  <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export const Icon = {
  plus: () => wrap(html`<path d="M12 5v14M5 12h14"/>`),
  trash: () => wrap(html`<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>`),
  close: () => wrap(html`<path d="M6 6l12 12M18 6L6 18"/>`),
  left: () => wrap(html`<path d="M15 18l-6-6 6-6"/>`),
  arrowUp: () => wrap(html`<path d="M12 19V5M5 12l7-7 7 7"/>`),
  right: () => wrap(html`<path d="M9 6l6 6-6 6"/>`),
  down: () => wrap(html`<path d="M6 9l6 6 6-6"/>`),
  // Степпер вверх-вниз (как у Apple chevron.up.chevron.down) — для пилюли выбора проекта.
  stepper: () => wrap(html`<path d="M8 10l4-4 4 4"/><path d="M8 14l4 4 4-4"/>`),
  check: () => wrap(html`<path d="M5 13l4 4L19 7"/>`),
  calendar: () => wrap(html`<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>`),
  inbox: () => wrap(html`<path d="M5 5h14l2 7v7H3v-7z"/><path d="M3 12h5l2 3h4l2-3h5"/>`),
  folder: () => wrap(html`<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`),
  restore: () => wrap(html`<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>`),
  clock: () => wrap(html`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`),
  repeat: () => wrap(html`<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`),
  dot: () => wrap(html`<circle cx="12" cy="12" r="3" fill="currentColor"/>`),
  // Чек-лист (для переключателя «Задача»): отмеченный пункт + пустой, как в Apple Reminders.
  checklist: () => wrap(html`<circle cx="5" cy="7.5" r="2.5"/><path d="M3.9 7.6l0.7 0.7 1.5-1.6"/><circle cx="5" cy="16.5" r="2.5"/><path d="M9.5 7.5H19"/><path d="M9.5 16.5H19"/>`),
  sun: () => wrap(html`<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>`),
  moon: () => wrap(html`<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>`),
  signout: () => wrap(html`<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>`),
  edit: () => wrap(html`<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>`),
  note: () => wrap(html`<path d="M4 5h16M4 10h16M4 15h10"/>`),
  search: () => wrap(html`<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>`),
  gear: () => wrap(html`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`),
};
