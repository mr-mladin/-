import { html } from "htm/preact";
import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "preact/hooks";
import { useStore } from "./store.js";
import {
  Icon, todayISO, toISO, fromISO, monthGen, monthNom, relLabel,
  minRangeLabel, minToHHMM, itemsForDate,
  monthMatrix, weekRangeLabel, weekStart,
} from "./lib.js";
import { Modal, ConfirmModal, Toasts, TaskForm, ListForm, AuthForm, EventCard } from "./components.js";

const VIEWS = [["month", "Месяц"], ["week", "Неделя"], ["day", "День"]];
function readView() {
  try { const v = localStorage.getItem("planner.view"); return VIEWS.some(x => x[0] === v) ? v : "day"; }
  catch (e) { return "day"; }
}

const HOUR_DEFAULT = 80;
const HOUR_MIN = 36;
const HOUR_MAX = 220;
const GUTTER = 56;
const SNAP = 5;
const MIN_DUR = 15;
const HOLD_MS = 350;
const snap = m => Math.round(m / SNAP) * SNAP;
function readHourPx() {
  try { const v = +localStorage.getItem("planner.hourPx"); return v >= HOUR_MIN && v <= HOUR_MAX ? v : HOUR_DEFAULT; }
  catch (e) { return HOUR_DEFAULT; }
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function App() {
  const store = useStore();
  if (!store.ready) return html`<div class="boot"><div class="boot-spinner"></div></div>`;
  if (!store.user) return html`<${AuthForm} /><${Toasts} />`;
  return html`<${Planner} /><${Toasts} />`;
}

function Planner() {
  const store = useStore();
  const { tasks, taskLists, theme } = store;

  const [date, setDate] = useState(todayISO());
  const [view, setView] = useState(readView());
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(null);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [delItem, setDelItem] = useState(null);
  const [drag, setDrag] = useState(null);
  const [listModal, setListModal] = useState(null);
  const [delList, setDelList] = useState(null);
  const [hourPx, setHourPx] = useState(readHourPx());
  const [projOpen, setProjOpen] = useState(false);
  const [ctx, setCtx] = useState(null);
  const [swipeId, setSwipeId] = useState(null);

  const innerRef = useRef(null);
  const scrollRef = useRef(null);
  const weekScrollRef = useRef(null);
  const dateInputRef = useRef(null);
  const hourPxRef = useRef(hourPx);
  const zoomAnchor = useRef(null);
  const projRef = useRef(null);
  const swipedRef = useRef(false);

  useEffect(() => {
    if (!projOpen) { setSwipeId(null); return; }
    const onDown = (e) => { if (projRef.current && !projRef.current.contains(e.target)) setProjOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [projOpen]);

  useEffect(() => { try { localStorage.setItem("planner.view", view); } catch (e) {} }, [view]);

  // Отмена/возврат: Cmd/Ctrl+Z — отменить, Cmd/Ctrl+Shift+Z — повторить.
  // (кроме случаев ввода текста в полях).
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.code !== "KeyZ") return;
      const t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
      e.preventDefault();
      e.shiftKey ? store.redo() : store.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { hourPxRef.current = hourPx; try { localStorage.setItem("planner.hourPx", String(hourPx)); } catch (e) {} }, [hourPx]);

  // Запоминаем точку под курсором перед зумом, чтобы после смены масштаба
  // оставить это же время дня под курсором (как в Apple Календаре).
  function zoomAnchorAt(clientY) {
    const cont = scrollRef.current, grid = innerRef.current;
    if (!cont || !grid) return;
    const yInContainer = clientY - cont.getBoundingClientRect().top;
    const timeMin = (clientY - grid.getBoundingClientRect().top) / hourPxRef.current * 60;
    zoomAnchor.current = { timeMin, yInContainer };
  }
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const cont = scrollRef.current, grid = innerRef.current;
    if (!a || !cont || !grid) return;
    zoomAnchor.current = null;
    const gridOffset = (grid.getBoundingClientRect().top - cont.getBoundingClientRect().top) + cont.scrollTop;
    cont.scrollTop = gridOffset + (a.timeMin / 60) * hourPx - a.yInContainer;
  }, [hourPx]);

  // Масштаб сетки дня жестом «щипок» на тачпаде. В Chromium/Arc это wheel с
  // зажатым Ctrl, в Safari — события gesture* со свойством scale.
  useEffect(() => {
    const el = scrollRef.current;
    if (view !== "day" || !el) return;
    let clsTimer = null;
    const markZooming = () => {
      el.classList.add("zooming");
      clearTimeout(clsTimer);
      clsTimer = setTimeout(() => el.classList.remove("zooming"), 180);
    };
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      markZooming();
      zoomAnchorAt(e.clientY);
      setHourPx(prev => clamp(Math.round(prev * Math.exp(-e.deltaY * 0.01)), HOUR_MIN, HOUR_MAX));
    };
    let base = hourPxRef.current;
    const onGStart = (e) => { e.preventDefault(); base = hourPxRef.current; };
    const onGChange = (e) => {
      e.preventDefault();
      markZooming();
      zoomAnchorAt(e.clientY);
      setHourPx(clamp(Math.round(base * e.scale), HOUR_MIN, HOUR_MAX));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGStart);
    el.addEventListener("gesturechange", onGChange);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGStart);
      el.removeEventListener("gesturechange", onGChange);
    };
  }, [view]);

  const lists = useMemo(() => [...taskLists].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)), [taskLists]);
  const listById = useMemo(() => Object.fromEntries(lists.map(l => [l.id, l])), [lists]);
  const matches = (lid) => filter === "all" || (filter === "inbox" ? !lid : lid === filter);

  const dayItems = useMemo(() => itemsForDate(tasks, date).filter(i => matches(i.list_id)), [tasks, date, filter]);
  const timed = dayItems.filter(i => i.start_min !== null && i.start_min !== undefined);
  const untimed = dayItems.filter(i => i.start_min === null || i.start_min === undefined);
  // Все задачи выбранного проекта (для боковой панели): и без времени, и
  // запланированные. Без дублей повторений (берём только шаблоны/одиночные).
  const projTasks = useMemo(() => tasks
    .filter(t => !t.recurrence_parent && matches(t.list_id))
    .sort((a, b) => (a.done - b.done)
      || ((a.date || "9999-99") < (b.date || "9999-99") ? -1 : (a.date || "9999-99") > (b.date || "9999-99") ? 1 : 0)
      || ((a.start_min ?? 1e9) - (b.start_min ?? 1e9))
      || ((a.sort_order || 0) - (b.sort_order || 0))), [tasks, filter]);

  const week = useMemo(() => {
    const base = fromISO(date);
    const off = (base.getDay() + 6) % 7;
    const mon = new Date(base); mon.setDate(base.getDate() - off);
    const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    return Array.from({ length: 7 }, (_, k) => {
      const dd = new Date(mon); dd.setDate(mon.getDate() + k);
      return { iso: toISO(dd), day: dd.getDate(), short: WD[k] };
    });
  }, [date]);

  const monthWeeks = useMemo(() => view === "month" ? monthMatrix(date) : null, [view, date]);
  const monthItems = useMemo(() => {
    if (view !== "month" || !monthWeeks) return null;
    const map = {};
    for (const wk of monthWeeks) for (const c of wk) {
      map[c.iso] = itemsForDate(tasks, c.iso).filter(i => matches(i.list_id))
        .sort((a, b) => {
          const at = a.start_min ?? 1e9, bt = b.start_min ?? 1e9;
          return at - bt;
        });
    }
    return map;
  }, [view, monthWeeks, tasks, filter]);

  const weekDays = useMemo(() => {
    if (view !== "week") return null;
    const mon = weekStart(date);
    const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    return Array.from({ length: 7 }, (_, k) => {
      const dd = new Date(mon); dd.setDate(mon.getDate() + k);
      const iso = toISO(dd);
      const items = itemsForDate(tasks, iso).filter(i => matches(i.list_id));
      const t = items.filter(i => i.start_min !== null && i.start_min !== undefined);
      return {
        iso, day: dd.getDate(), short: WD[k], isToday: iso === todayISO(),
        timed: layoutColumns(t, null),
        untimed: items.filter(i => i.start_min === null || i.start_min === undefined),
      };
    });
  }, [view, date, tasks, filter]);

  useEffect(() => {
    const el = view === "day" ? scrollRef.current : view === "week" ? weekScrollRef.current : null;
    if (!el) return;
    const now = new Date();
    const target = view === "day" && date === todayISO() ? now.getHours() * 60 + now.getMinutes() : 8 * 60;
    el.scrollTop = Math.max(0, (target / 60) * hourPx - 120);
  }, [view, date]);

  const yToMin = (clientY) => ((clientY - innerRef.current.getBoundingClientRect().top) / hourPx) * 60;
  const colorOf = (i) => i.color || listById[i.list_id]?.color || "var(--accent)";
  const showErr = (e) => store.pushToast(e.message || "Ошибка сохранения", "error");

  function onGridPointerDown(e) {
    if (e.button !== 0) return;
    const touch = e.pointerType === "touch";
    const anchor = clamp(snap(yToMin(e.clientY)), 0, 1440);
    let cur = anchor, active = false, hold = null;
    const begin = () => {
      active = true;
      setDrag({ type: "create", start: anchor, dur: 0 });
      if (touch && navigator.vibrate) navigator.vibrate(10);
    };
    const move = ev => {
      if (!active) {
        // до активации: палец поехал (скролл) — отменяем долгое нажатие
        if (touch && Math.abs(ev.clientY - e.clientY) > 8) finish(false);
        return;
      }
      ev.preventDefault();
      cur = clamp(snap(yToMin(ev.clientY)), 0, 1440);
      setDrag({ type: "create", start: Math.min(anchor, cur), dur: Math.abs(cur - anchor) });
    };
    const finish = (commit) => {
      clearTimeout(hold);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      setDrag(null);
      if (!active || !commit) return;
      const start = Math.min(anchor, cur); let dur = Math.abs(cur - anchor);
      if (dur < MIN_DUR) dur = 60;
      setCreating({ date, start_min: clamp(start, 0, 1440 - dur), duration_min: dur,
        list_id: filter !== "all" && filter !== "inbox" ? filter : null });
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    // На тач — создаём только по долгому нажатию (обычный тап/скролл ничего не делает).
    // Мышью — сразу, как было (клик-и-тянуть).
    if (touch) hold = setTimeout(begin, HOLD_MS);
    else { e.preventDefault(); begin(); }
  }

  function onBlockPointerDown(e, item) {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault();
    const startClientY = e.clientY;
    const grab = yToMin(e.clientY) - item.start_min;
    let newStart = item.start_min, moved = false;
    const move = ev => {
      if (Math.abs(ev.clientY - startClientY) > 4) moved = true;
      newStart = clamp(snap(yToMin(ev.clientY) - grab), 0, 1440 - item.duration_min);
      setDrag({ type: "move", key: item.key, start: newStart, dur: item.duration_min });
    };
    const up = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
      if (moved && newStart !== item.start_min) store.actions.tasks.reschedule(item, { start_min: newStart }).catch(showErr);
      setDrag(null);
      if (!moved) openPreview(item);
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
  }

  function onResizePointerDown(e, item) {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault();
    let newDur = item.duration_min;
    const move = ev => { newDur = clamp(snap(yToMin(ev.clientY) - item.start_min), MIN_DUR, 1440 - item.start_min);
      setDrag({ type: "resize", key: item.key, start: item.start_min, dur: newDur }); };
    const up = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
      if (newDur !== item.duration_min) store.actions.tasks.reschedule(item, { duration_min: newDur }).catch(showErr);
      setDrag(null);
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
  }

  function openEdit(item) {
    const row = item.kind === "concrete" ? tasks.find(t => t.id === item.id) : tasks.find(t => t.id === item.templateId);
    if (row) setEditing({ task: row, occ: item.kind === "occurrence" ? item : null });
  }
  const toggleDone = (item) => store.actions.tasks.toggleDone(item).catch(showErr);
  function taskMeta(t) {
    if (!t.date) return "без времени";
    const dd = fromISO(t.date);
    const base = relLabel(t.date) || `${dd.getDate()} ${monthGen(dd)}`;
    return t.start_min !== null && t.start_min !== undefined ? `${base}, ${minToHHMM(t.start_min)}` : base;
  }
  function quickSchedule(t) {
    const now = new Date();
    const start = date === todayISO() ? clamp(snap(now.getHours() * 60 + now.getMinutes() + 5), 0, 1440 - 60) : 9 * 60;
    store.actions.tasks.update(t.id, { date, start_min: start, duration_min: 60 }).catch(showErr);
  }
  // Свайп влево по строке проекта (тач) открывает кнопки «Изменить/Удалить».
  function projSwipe(e, l) {
    if (e.pointerType !== "touch") return;
    const el = e.currentTarget;
    const startX = e.clientX, startY = e.clientY;
    const wasOpen = swipeId === l.id;
    let decided = false, horiz = false, dx = 0;
    const move = (ev) => {
      const mx = ev.clientX - startX, my = ev.clientY - startY;
      if (!decided) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        decided = true; horiz = Math.abs(mx) > Math.abs(my);
        if (!horiz) { cleanup(); return; }
        swipedRef.current = true;
      }
      ev.preventDefault();
      dx = clamp((wasOpen ? -132 : 0) + mx, -132, 0);
      el.style.transform = `translateX(${dx}px)`;
    };
    const up = () => {
      cleanup();
      if (!horiz) return;
      el.style.transform = "";
      setSwipeId(dx < -50 ? l.id : null);
      setTimeout(() => { swipedRef.current = false; }, 0);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  }
  function selectProj(l) {
    if (swipedRef.current) { swipedRef.current = false; return; }
    if (swipeId === l.id) { setSwipeId(null); return; }
    setFilter(l.id); setProjOpen(false);
  }
  function shift(delta) {
    const d = fromISO(date);
    if (view === "month") d.setMonth(d.getMonth() + delta);
    else if (view === "week") d.setDate(d.getDate() + delta * 7);
    else d.setDate(d.getDate() + delta);
    setDate(toISO(d));
  }
  function openDay(iso) { setDate(iso); setView("day"); }
  function openPreview(item) { setPreview(item); }
  function previewToggle() {
    if (!preview) return;
    toggleDone(preview);
    setPreview(p => p && { ...p, done: !p.done });
  }
  function handleDelete(item) {
    setPreview(null);
    if (item.recurring) { openEdit(item); return; }
    setDelItem(item);
  }

  const laidOut = useMemo(() => layoutColumns(timed, drag), [timed, drag]);
  const d = fromISO(date);
  const rel = relLabel(date);
  const dayLabel = (rel ? rel + " · " : "") + `${d.getDate()} ${monthGen(d)}`;
  const monthLabel = `${monthNom(d)[0].toUpperCase()}${monthNom(d).slice(1)} ${d.getFullYear()}`;
  const headLabel = view === "month" ? monthLabel : view === "week" ? weekRangeLabel(date) : dayLabel;
  const nowMin = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
  const isToday = date === todayISO();

  return html`
    <div class="app">
      <header class="topbar">
        <div class="brand">${Icon.calendar()} <span>Планер</span></div>
        <div class="topbar-actions">
          <button class="btn-mini" title="Тема"
            onClick=${() => store.setTheme(theme === "dark" ? "light" : "dark")}>
            ${theme === "dark" ? Icon.sun() : Icon.moon()}</button>
          <span class="muted small">${store.user?.email}</span>
          <button class="btn-mini" title="Выйти" onClick=${() => store.auth.signOut()}>${Icon.signout()}</button>
        </div>
      </header>

      <div class="planner">
        <aside class="planner-aside">
          <div class=${"proj-select" + (projOpen ? " open" : "")} ref=${projRef}>
            <button class="proj-current" onClick=${() => setProjOpen(o => !o)}>
              <span class="proj-current-ico" style=${`color:${filter === "all" ? "var(--accent)" : filter === "inbox" ? "#64748b" : (listById[filter]?.color || "var(--accent)")};`}>
                ${filter === "all" ? Icon.calendar() : filter === "inbox" ? Icon.inbox() : Icon.dot()}</span>
              <span class="proj-current-name">${filter === "all" ? "Все задачи" : filter === "inbox" ? "Входящие" : (listById[filter]?.name || "Проект")}</span>
              <span class="proj-caret">${Icon.right()}</span>
            </button>
            <div class="proj-menu">
              <button class=${"proj-opt" + (filter === "all" ? " active" : "")} onClick=${() => { setFilter("all"); setProjOpen(false); }}>
                <span class="proj-opt-ico" style="color:var(--accent);">${Icon.calendar()}</span>
                <span class="proj-opt-name">Все задачи</span></button>
              <button class=${"proj-opt" + (filter === "inbox" ? " active" : "")} onClick=${() => { setFilter("inbox"); setProjOpen(false); }}>
                <span class="proj-opt-ico" style="color:#64748b;">${Icon.inbox()}</span>
                <span class="proj-opt-name">Входящие</span>
                <span class="proj-opt-count">${countOpen(tasks, null)}</span></button>
              ${lists.map(l => html`
                <div class=${"proj-row" + (swipeId === l.id ? " swipe-open" : "")} key=${l.id}>
                  <div class="proj-row-actions">
                    <button class="edit" title="Изменить" onClick=${() => { setListModal(l); setSwipeId(null); setProjOpen(false); }}>${Icon.edit()}</button>
                    <button class="del" title="Удалить" onClick=${() => { setDelList(l); setSwipeId(null); setProjOpen(false); }}>${Icon.trash()}</button>
                  </div>
                  <button class=${"proj-opt" + (filter === l.id ? " active" : "")}
                    onPointerDown=${e => projSwipe(e, l)} onClick=${() => selectProj(l)}
                    onContextMenu=${e => { e.preventDefault(); setSwipeId(null); setCtx({ list: l, x: e.clientX, y: e.clientY }); }}>
                    <span class="proj-opt-ico" style=${`color:${l.color || "var(--accent)"};`}>${Icon.dot()}</span>
                    <span class="proj-opt-name">${l.name}</span>
                    <span class="proj-opt-count">${countOpen(tasks, l.id)}</span></button>
                </div>`)}
              <button class="proj-opt proj-opt-new" onClick=${() => { setListModal("new"); setProjOpen(false); }}>
                <span class="proj-opt-ico">${Icon.plus()}</span>
                <span class="proj-opt-name">Новый проект</span></button>
            </div>
          </div>

          <div class="proj-tasks">
            ${projTasks.length === 0
              ? html`<div class="muted small" style="padding:10px 6px;">Здесь пока нет задач.</div>`
              : projTasks.map(t => html`
                <div class=${"tray-task" + (t.done ? " done" : "")} key=${t.id}>
                  <button class=${"task-check" + (t.done ? " on" : "")} title="Выполнено"
                    style=${t.done ? `background:${listById[t.list_id]?.color || "var(--accent)"};border-color:${listById[t.list_id]?.color || "var(--accent)"};` : ""}
                    onClick=${() => store.actions.tasks.toggleDone({ kind: "concrete", id: t.id, done: t.done }).catch(showErr)}>${Icon.check()}</button>
                  <button class="tray-task-body" onClick=${() => setEditing({ task: t, occ: null })}>
                    <span class="tray-task-title">${t.title}</span>
                    <span class="tray-task-meta">
                      ${filter === "all" && t.list_id ? html`<span class="tray-task-list" style=${`color:${listById[t.list_id]?.color};`}>${listById[t.list_id]?.name} · </span>` : ""}${taskMeta(t)}</span>
                  </button>
                  ${!t.date ? html`<button class="btn-mini" title="Запланировать на этот день" onClick=${() => quickSchedule(t)}>${Icon.clock()}</button>` : ""}
                </div>`)}
            <button class="btn sm ghost proj-add"
              onClick=${() => setCreating({ list_id: filter !== "all" && filter !== "inbox" ? filter : null })}>
              ${Icon.plus()} Добавить задачу</button>
          </div>
        </aside>

        <div class="planner-content">
          <div class="planner-head">
            <div class="planner-nav">
              <button class="btn-mini" onClick=${() => shift(-1)} title="Назад">${Icon.left()}</button>
              <button class="planner-date" onClick=${() => { const el = dateInputRef.current; el?.showPicker ? el.showPicker() : el?.focus(); }}>
                <span class="planner-date-main">${headLabel}</span>
                <input class="planner-date-input" type="date" ref=${dateInputRef} value=${date}
                  onInput=${e => e.target.value && setDate(e.target.value)} />
              </button>
              <button class="btn-mini" onClick=${() => shift(1)} title="Вперёд">${Icon.right()}</button>
            </div>
            <div class="seg">
              ${VIEWS.map(([v, label]) => html`<button key=${v}
                class=${"seg-btn" + (view === v ? " on" : "")} onClick=${() => setView(v)}>${label}</button>`)}
            </div>
            <div class="planner-head-actions">
              <button class="btn sm ghost" onClick=${() => setDate(todayISO())}>Сегодня</button>
              <button class="btn primary sm" onClick=${() => setCreating({ date, list_id: filter !== "all" && filter !== "inbox" ? filter : null })}>
                ${Icon.plus()} Задача</button>
            </div>
          </div>

          ${view === "day" && html`<div class="planner-week">
            ${week.map(w => html`<button key=${w.iso}
              class=${"wday" + (w.iso === date ? " active" : "") + (w.iso === todayISO() ? " today" : "")}
              onClick=${() => setDate(w.iso)}>
              <span class="wday-num">${w.day}</span><span class="wday-name">${w.short}</span></button>`)}
          </div>`}

          ${view === "day" && html`<div class="planner-body">
            <div class="planner-grid-scroll" ref=${scrollRef}>
              ${untimed.length > 0 && html`<div class="planner-untimed">
                ${untimed.map(i => html`<button class=${"untimed-chip" + (i.done ? " done" : "")} key=${i.key}
                  style=${`--c:${colorOf(i)};`} onClick=${() => openPreview(i)}>
                  <span class=${"task-check sm" + (i.done ? " on" : "")}
                    onClick=${e => { e.stopPropagation(); toggleDone(i); }}>${Icon.check()}</span>${i.title}</button>`)}
              </div>`}
              <div class="planner-grid" ref=${innerRef} onPointerDown=${onGridPointerDown} style=${`height:${24 * hourPx}px;`}>
                ${Array.from({ length: 24 }, (_, h) => html`<div class="grid-hour" style=${`top:${h * hourPx}px;`} key=${h}>
                  <span class="grid-hour-label">${String(h).padStart(2, "0")}:00</span></div>`)}
                ${isToday && html`<div class="grid-now" style=${`top:${(nowMin / 60) * hourPx}px;`}>
                  <span class="grid-now-time">${minToHHMM(nowMin)}</span><span class="grid-now-dot"></span></div>`}
                ${laidOut.map(i => {
                  const top = (i._start / 60) * hourPx;
                  const height = Math.max(18, (i._dur / 60) * hourPx);
                  const colW = `(100% - ${GUTTER}px) / ${i._cols}`;
                  const showTime = height >= 40;
                  return html`<div class=${"grid-block" + (i.done ? " done" : "") + (drag && drag.key === i.key ? " dragging" : "")} key=${i.key}
                    style=${`top:${top}px;height:${height}px;left:calc(${GUTTER}px + (${colW}) * ${i._col} + 2px);width:calc(${colW} - 4px);--c:${colorOf(i)};`}
                    onPointerDown=${e => onBlockPointerDown(e, i)}>
                    <button class=${"task-check sm" + (i.done ? " on" : "")} onPointerDown=${e => e.stopPropagation()}
                      onClick=${e => { e.stopPropagation(); toggleDone(i); }}>${Icon.check()}</button>
                    <div class="grid-block-text">
                      <div class="grid-block-title">${i.recurring ? html`<span class="grid-block-rep">${Icon.repeat()}</span>` : ""}${i.title}</div>
                      ${showTime && html`<div class="grid-block-time">${Icon.clock()}${minRangeLabel(i._start, i._dur)}</div>`}</div>
                    <div class="grid-block-resize" onPointerDown=${e => onResizePointerDown(e, i)}></div>
                  </div>`;
                })}
                ${drag && drag.type === "create" && drag.dur > 0 && html`<div class="grid-block ghost"
                  style=${`top:${(drag.start / 60) * hourPx}px;height:${(drag.dur / 60) * hourPx}px;left:calc(${GUTTER}px + 2px);width:calc(100% - ${GUTTER}px - 4px);`}>
                  <div class="grid-block-time">${minRangeLabel(drag.start, drag.dur)}</div></div>`}
              </div>
            </div>
          </div>`}

          ${view === "week" && html`<div class="week-scroll" ref=${weekScrollRef}>
            <div class="week-head">
              <div class="week-gutter-cell"></div>
              ${weekDays.map(wd => html`<button key=${wd.iso}
                class=${"week-day-head" + (wd.iso === todayISO() ? " today" : "")} onClick=${() => openDay(wd.iso)}>
                <span class="week-day-name">${wd.short}</span>
                <span class="week-day-num">${wd.day}</span></button>`)}
            </div>
            ${weekDays.some(wd => wd.untimed.length) && html`<div class="week-allday">
              <div class="week-gutter-cell small">весь<br/>день</div>
              ${weekDays.map(wd => html`<div class="week-allday-cell" key=${wd.iso}>
                ${wd.untimed.slice(0, 3).map(i => html`<button class="week-chip" key=${i.key}
                  style=${`--c:${colorOf(i)};`} onClick=${() => openPreview(i)}>${i.title}</button>`)}
                ${wd.untimed.length > 3 && html`<button class="week-more" onClick=${() => openDay(wd.iso)}>+${wd.untimed.length - 3}</button>`}
              </div>`)}
            </div>`}
            <div class="week-grid" style=${`height:${24 * hourPx}px;`}>
              ${Array.from({ length: 24 }, (_, h) => html`<div class="grid-hour" style=${`top:${h * hourPx}px;`} key=${h}>
                <span class="grid-hour-label">${String(h).padStart(2, "0")}:00</span></div>`)}
              ${weekDays.map((wd, di) => html`<div class="week-col" key=${wd.iso}
                style=${`left:calc(${GUTTER}px + (100% - ${GUTTER}px) / 7 * ${di});width:calc((100% - ${GUTTER}px) / 7);`}
                onClick=${() => openDay(wd.iso)}>
                ${wd.isToday && html`<div class="grid-now col" style=${`top:${(nowMin / 60) * hourPx}px;`}><span class="grid-now-dot"></span></div>`}
                ${wd.timed.map(i => {
                  const top = (i._start / 60) * hourPx;
                  const height = Math.max(16, (i._dur / 60) * hourPx);
                  const sub = `100% / ${i._cols}`;
                  return html`<button class=${"week-block" + (i.done ? " done" : "")} key=${i.key}
                    style=${`top:${top}px;height:${height}px;left:calc((${sub}) * ${i._col});width:calc((${sub}) - 2px);--c:${colorOf(i)};`}
                    onClick=${e => { e.stopPropagation(); openPreview(i); }}>
                    <span class="week-block-title">${i.title}</span></button>`;
                })}
              </div>`)}
            </div>
          </div>`}

          ${view === "month" && html`<div class="month">
            <div class="month-weekdays">
              ${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(n => html`<div key=${n}>${n}</div>`)}
            </div>
            <div class="month-weeks">
              ${monthWeeks.map((wk, wi) => html`<div class="month-week" key=${wi}>
                ${wk.map(c => {
                  const its = monthItems[c.iso] || [];
                  return html`<div class=${"month-cell" + (c.inMonth ? "" : " out") + (c.iso === date ? " sel" : "")}
                    key=${c.iso} onClick=${() => openDay(c.iso)}>
                    <div class=${"month-cell-num" + (c.isToday ? " today" : "")}>${c.day}</div>
                    <div class="month-cell-items">
                      ${its.slice(0, 3).map(i => html`<button class=${"month-chip" + (i.done ? " done" : "")} key=${i.key}
                        style=${`--c:${colorOf(i)};`} onClick=${e => { e.stopPropagation(); openPreview(i); }}>
                        ${(i.start_min !== null && i.start_min !== undefined) ? html`<span class="month-chip-dot"></span>` : ""}
                        <span class="month-chip-title">${i.title}</span></button>`)}
                      ${its.length > 3 && html`<div class="month-more">ещё ${its.length - 3}</div>`}
                    </div>
                  </div>`;
                })}
              </div>`)}
            </div>
          </div>`}
        </div>
      </div>
    </div>

    ${preview && html`<${EventCard} item=${preview}
      listName=${preview.list_id ? listById[preview.list_id]?.name : ""} color=${colorOf(preview)}
      onClose=${() => setPreview(null)} onEdit=${() => { openEdit(preview); setPreview(null); }}
      onToggleDone=${previewToggle} onDelete=${() => handleDelete(preview)} />`}
    ${delItem && html`<${ConfirmModal} title="Удалить задачу?"
      message=${`«${delItem.title}» будет удалена без возможности восстановления.`}
      onCancel=${() => setDelItem(null)}
      onConfirm=${async () => { try { await store.actions.tasks.remove(delItem.id); store.pushToast("Задача удалена", "success"); }
        catch (e) { showErr(e); } setDelItem(null); }} />`}
    ${ctx && html`<div class="ctx-back" onPointerDown=${() => setCtx(null)} onContextMenu=${e => { e.preventDefault(); setCtx(null); }}>
      <div class="ctx-menu" style=${`left:${ctx.x}px;top:${ctx.y}px;`} onPointerDown=${e => e.stopPropagation()}>
        <button class="ctx-item" onClick=${() => { setListModal(ctx.list); setCtx(null); setProjOpen(false); }}>${Icon.edit()} Изменить</button>
        <button class="ctx-item danger" onClick=${() => { setDelList(ctx.list); setCtx(null); setProjOpen(false); }}>${Icon.trash()} Удалить</button>
      </div>
    </div>`}
    ${creating && html`<${TaskForm} defaults=${creating} onClose=${() => setCreating(null)} />`}
    ${editing && html`<${TaskForm} initial=${editing.task} occ=${editing.occ} onClose=${() => setEditing(null)} />`}
    ${listModal && html`<${ListForm} initial=${listModal === "new" ? null : listModal}
      onDelete=${listModal !== "new" ? () => { setDelList(listModal); setListModal(null); } : null}
      onClose=${() => setListModal(null)} />`}
    ${delList && html`<${ConfirmModal} title="Удалить проект?"
      message="Задачи из проекта переедут во «Входящие», не пропадут."
      onCancel=${() => setDelList(null)}
      onConfirm=${async () => { await store.actions.taskLists.remove(delList.id);
        if (filter === delList.id) setFilter("all"); setDelList(null); store.pushToast("Проект удалён", "success"); }} />`}
  `;
}

function layoutColumns(items, drag) {
  const eff = items.map(i => drag && drag.key === i.key
    ? { ...i, _start: drag.start, _dur: drag.dur }
    : { ...i, _start: i.start_min, _dur: i.duration_min });
  const sorted = eff.sort((a, b) => (a._start - b._start) || (a._dur - b._dur));
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const colEnds = [];
    cluster.forEach(it => {
      let c = colEnds.findIndex(end => end <= it._start);
      if (c === -1) { c = colEnds.length; colEnds.push(0); }
      colEnds[c] = it._start + it._dur; it._col = c;
    });
    cluster.forEach(it => { it._cols = colEnds.length; });
    cluster = []; clusterEnd = -1;
  };
  sorted.forEach(it => {
    if (cluster.length && it._start >= clusterEnd) flush();
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it._start + it._dur);
  });
  flush();
  return sorted;
}

function countOpen(tasks, listId) {
  const n = tasks.filter(t => !t.recurrence_parent && !t.done && (listId ? t.list_id === listId : !t.list_id)).length;
  return n || "";
}
