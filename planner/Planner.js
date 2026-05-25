import { html } from "htm/preact";
import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "preact/hooks";
import { useStore } from "./store.js";
import {
  Icon, todayISO, toISO, fromISO, monthGen, monthNom, relLabel,
  minRangeLabel, minToHHMM, itemsForDate,
  monthMatrix, weekRangeLabel, weekStart,
  splitEmoji, gapCaption, durHuman, doneFeedback, haptic,
} from "./lib.js";
import { Modal, ConfirmModal, Toasts, TaskForm, ListForm, AuthForm, EventCard, SettingsModal, SearchModal } from "./components.js";

const VIEWS = [["day", "День"], ["week", "Неделя"], ["month", "Месяц"]];
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
const MIN_EVENT_PX = 14;
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
  const { tasks, taskLists } = store;

  const [date, setDate] = useState(todayISO());
  const [view, setView] = useState(readView());
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(null);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [delItem, setDelItem] = useState(null);
  const [drag, setDrag] = useState(null);
  const [dnd, setDnd] = useState(null);
  const [listModal, setListModal] = useState(null);
  const [delList, setDelList] = useState(null);
  const [hourPx, setHourPx] = useState(readHourPx());
  const [projOpen, setProjOpen] = useState(false);
  const [ctx, setCtx] = useState(null);
  const [swipeId, setSwipeId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [selRange, setSelRange] = useState(null);
  const [asideOpen, setAsideOpen] = useState(false);

  const innerRef = useRef(null);
  const scrollRef = useRef(null);
  const weekScrollRef = useRef(null);
  const dateInputRef = useRef(null);
  const hourPxRef = useRef(hourPx);
  const zoomAnchor = useRef(null);
  const projRef = useRef(null);
  const swipedRef = useRef(false);
  const trayClickGuard = useRef(false);
  const lastTap = useRef({ key: null, t: 0 });

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

  // Удаление выделенных задач клавишами Delete/Backspace.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
      if (selected.size === 0) return;
      e.preventDefault();
      deleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // Выделение относится к конкретному дню — сбрасываем при смене дня/вида.
  useEffect(() => { setSelected(new Set()); setSelRange(null); }, [date, view, filter]);
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
      // На тач координаты жеста ненадёжны — масштабируем относительно центра
      // видимой области, чтобы сетка росла симметрично, без сдвига.
      const r = el.getBoundingClientRect();
      zoomAnchorAt(r.top + el.clientHeight / 2);
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
  // id задач, уже стоящих блоком в сетке текущего дня (одиночные — по id,
  // повторяющиеся — по id шаблона). Их не показываем в боковой панели.
  const gridIds = new Set(timed.map(i => (i.kind === "occurrence" ? i.templateId : i.id)));
  // Боковая панель: задачи проекта, которых нет в сетке этого дня (без времени,
  // другого дня или вовсе без даты). Без дублей повторений (только шаблоны).
  const projTasks = useMemo(() => tasks
    .filter(t => !t.recurrence_parent && matches(t.list_id))
    .sort((a, b) => (a.done - b.done)
      || ((a.date || "9999-99") < (b.date || "9999-99") ? -1 : (a.date || "9999-99") > (b.date || "9999-99") ? 1 : 0)
      || ((a.start_min ?? 1e9) - (b.start_min ?? 1e9))
      || ((a.sort_order || 0) - (b.sort_order || 0))), [tasks, filter]);
  const trayTasks = projTasks.filter(t => !gridIds.has(t.id));

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

  function startRangeSelect(e) {
    e.preventDefault();
    const anchor = clamp(yToMin(e.clientY), 0, 1440);
    const base = new Set(selected);
    const apply = (cur) => {
      const lo = Math.min(anchor, cur), hi = Math.max(anchor, cur);
      const n = new Set(base);
      for (const it of dayTl) {
        const s = it.start_min, en = s + (it.duration_min || 0);
        if (s < hi && en > lo) n.add(it.key);
      }
      setSelected(n);
      setSelRange({ lo, hi });
    };
    const move = ev => { ev.preventDefault(); apply(clamp(yToMin(ev.clientY), 0, 1440)); };
    const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); setSelRange(null); };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    apply(anchor);
  }

  function onGridPointerDown(e) {
    if (e.button !== 0 && e.pointerType !== "touch") return;
    if (e.shiftKey) { startRangeSelect(e); return; }
    const touch = e.pointerType === "touch";
    const el = e.currentTarget, pid = e.pointerId;
    const anchor = clamp(snap(yToMin(e.clientY)), 0, 1440);
    let cur = anchor, active = false, hold = null, start0 = clamp(anchor, 0, 1440 - 60);
    const beginTouch = () => {
      active = true;
      setSelected(new Set());
      try { el.setPointerCapture && el.setPointerCapture(pid); } catch (err) {}
      setDrag({ type: "create", start: start0, dur: 60 });
      if (navigator.vibrate) navigator.vibrate(12);
    };
    const beginMouse = () => {
      active = true;
      setSelected(new Set());
      setDrag({ type: "create", start: anchor, dur: 0 });
    };
    const move = ev => {
      if (!active) {
        const far = Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY);
        if (touch) { if (far > 14) finish(false); return; } // движение до долгого нажатия = прокрутка
        if (far > 6) beginMouse(); else return;
      }
      ev.preventDefault();
      if (touch) {
        start0 = clamp(snap(yToMin(ev.clientY)), 0, 1440 - 60);
        setDrag({ type: "create", start: start0, dur: 60 });
      } else {
        cur = clamp(snap(yToMin(ev.clientY)), 0, 1440);
        setDrag({ type: "create", start: Math.min(anchor, cur), dur: Math.abs(cur - anchor) });
      }
    };
    // Непассивный touchmove с preventDefault реально останавливает прокрутку
    // после долгого нажатия (touch-action, выставленный по ходу, не помогает).
    const onTouchMove = ev => { if (active) ev.preventDefault(); };
    const finish = (commit) => {
      clearTimeout(hold);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("touchmove", onTouchMove, { passive: false });
      setDrag(null);
      if (!active) { if (commit) setSelected(new Set()); return; }
      if (!commit) return;
      let start, dur;
      if (touch) { start = start0; dur = 60; }
      else { start = Math.min(anchor, cur); dur = Math.abs(cur - anchor); if (dur < MIN_DUR) dur = 60; }
      store.actions.tasks.create({ title: "", date, start_min: clamp(start, 0, 1440 - dur), duration_min: dur,
        list_id: filter !== "all" && filter !== "inbox" ? filter : null })
        .then(row => { if (row) openPreview(rowToItem(row)); }).catch(showErr);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    if (touch) document.addEventListener("touchmove", onTouchMove, { passive: false });
    if (touch) hold = setTimeout(beginTouch, HOLD_MS);
  }

  // В какой зоне находится точка: над сеткой дня или над боковой панелью.
  function dndZoneAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (el.closest(".planner-grid-scroll")) return "grid";
    if (el.closest(".planner-aside")) return "tray";
    return null;
  }

  // Одиночный тап — выделить; двойной — открыть карточку; Shift+тап — добавить
  // или убрать из выделения.
  function handleTap(item, shift) {
    if (shift) {
      setSelected(prev => { const n = new Set(prev); n.has(item.key) ? n.delete(item.key) : n.add(item.key); return n; });
      return;
    }
    const now = Date.now();
    if (lastTap.current.key === item.key && now - lastTap.current.t < 320) {
      lastTap.current = { key: null, t: 0 };
      openPreview(item);
      return;
    }
    lastTap.current = { key: item.key, t: now };
    setSelected(new Set([item.key]));
  }

  function deleteSelected() {
    const items = dayTl.filter(i => selected.has(i.key));
    if (items.length === 0) return;
    store.batch("удаление", () => {
      for (const i of items) {
        if (i.kind === "concrete") store.actions.tasks.remove(i.id).catch(showErr);
        else store.actions.tasks.removeOccurrence(i).catch(showErr);
      }
    });
    setSelected(new Set());
    store.pushToast(items.length > 1 ? `Удалено: ${items.length}` : "Задача удалена", "success");
  }

  function copyPayload(it, startMin) {
    return { title: it.title || "", notes: it.notes || null, color: it.color || null, icon: it.icon || null,
      list_id: it.list_id || null, date, start_min: startMin, duration_min: it.duration_min || 60 };
  }

  // Мобильное перемещение пилюли: только после долгого нажатия (режим
  // перемещения с пульсацией). До этого касание по пилюле = обычный скролл/тап.
  function onBlockTouch(e, item) {
    const sx = e.clientX, sy = e.clientY;
    const grab = yToMin(e.clientY) - item.start_min;
    const dur = item.duration_min || 0;
    // Уже выделенную пилюлю можно двигать сразу, без повторного удержания.
    const already = selected.has(item.key);
    let armed = false, moved = false, hold = null, newStart = item.start_min;
    const onTouchMove = ev => { if (armed) ev.preventDefault(); };
    const arm = (select) => {
      armed = true;
      if (select) { setSelected(new Set([item.key])); haptic(); }
      setDrag({ type: "move", key: item.key, start: item.start_min, dur, armed: true });
    };
    const move = ev => {
      const far = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      if (!armed) { if (far > 12) cleanup(); return; } // двинул до активации — это скролл
      if (far > 3) moved = true;
      ev.preventDefault();
      newStart = clamp(snap(yToMin(ev.clientY) - grab), 0, 1440 - dur);
      setDrag({ type: "move", key: item.key, start: newStart, dur, armed: true });
    };
    const up = () => {
      const wasArmed = armed;
      cleanup();
      setDrag(null);
      if (!wasArmed) { openPreview(item); return; }
      if (moved && newStart !== item.start_min) store.actions.tasks.reschedule(item, { start_min: newStart }).catch(showErr);
    };
    const cleanup = () => {
      clearTimeout(hold);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.removeEventListener("touchmove", onTouchMove, { passive: false });
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    if (already) arm(false);                       // уже выделена → двигаем сразу
    else hold = setTimeout(() => arm(true), 280);  // не выделена → выделяем удержанием
  }

  function onBlockPointerDown(e, item) {
    e.stopPropagation();
    if (e.button === 2) return; // правый клик — контекстное меню (карточка)
    if (e.pointerType === "touch") { onBlockTouch(e, item); return; }
    if (e.button !== 0) return;
    e.preventDefault();
    const startClientY = e.clientY, startClientX = e.clientX;
    const shift = e.shiftKey;
    const copy = e.altKey; // Option/Alt + перетаскивание — создать копию
    const grab = yToMin(e.clientY) - item.start_min;
    // Если тащим за одну из нескольких выделенных задач — двигаем всю группу.
    const group = !shift && selected.has(item.key) && selected.size > 1
      ? dayTl.filter(i => selected.has(i.key)).map(i => ({ item: i, start: i.start_min, dur: i.duration_min || 0 }))
      : null;
    let newStart = item.start_min, moved = false, delta = 0;
    const move = ev => {
      if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) > 4) moved = true;
      if (!moved) return;
      if (group) {
        delta = clamp(snap(yToMin(ev.clientY) - grab), 0, 1440) - item.start_min;
        setDrag({ type: copy ? "copyGroup" : "moveGroup", keys: group.map(g => g.item.key), delta });
        return;
      }
      // Утянули в боковую панель — задача «снимается» из сетки (плавающий ярлык).
      if (!copy && item.kind === "concrete" && dndZoneAt(ev.clientX, ev.clientY) === "tray") {
        setDrag(null);
        setDnd({ source: "grid", title: item.title, color: colorOf(item), x: ev.clientX, y: ev.clientY, zone: "tray" });
        return;
      }
      setDnd(null);
      newStart = clamp(snap(yToMin(ev.clientY) - grab), 0, 1440 - item.duration_min);
      setDrag({ type: copy ? "copy" : "move", key: item.key, start: newStart, dur: item.duration_min });
    };
    const up = (ev) => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
      setDrag(null); setDnd(null);
      if (!moved) { handleTap(item, shift); return; }
      if (copy) {
        const list = group ? group : [{ item, start: item.start_min, dur: item.duration_min || 0 }];
        const off = group ? delta : (newStart - item.start_min);
        for (const g of list) {
          const ns = clamp(g.start + off, 0, 1440 - g.dur);
          store.actions.tasks.create(copyPayload(g.item, ns)).catch(showErr);
        }
      } else if (group) {
        store.batch("перенос", () => {
          for (const g of group) {
            const ns = clamp(g.start + delta, 0, 1440 - g.dur);
            if (ns !== g.start) store.actions.tasks.reschedule(g.item, { start_min: ns }).catch(showErr);
          }
        });
      } else if (item.kind === "concrete" && dndZoneAt(ev.clientX, ev.clientY) === "tray") {
        store.actions.tasks.update(item.id, { start_min: null, duration_min: null }).catch(showErr);
      } else if (newStart !== item.start_min) {
        store.actions.tasks.reschedule(item, { start_min: newStart }).catch(showErr);
      }
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
  }

  // Перетаскивание задачи из боковой панели в сетку дня (назначить время).
  function startTrayDrag(e, t) {
    if (e.button !== 0) return;
    const touch = e.pointerType === "touch";
    const sx = e.clientX, sy = e.clientY;
    let active = false, hold = null;
    const dur = 60;
    const update = (ev) => {
      const zone = dndZoneAt(ev.clientX, ev.clientY);
      const gridMin = zone === "grid" && innerRef.current ? clamp(snap(yToMin(ev.clientY)), 0, 1440 - dur) : null;
      setDnd({ source: "tray", title: t.title, color: listById[t.list_id]?.color || "var(--accent)",
        x: ev.clientX, y: ev.clientY, zone, gridMin, dur });
    };
    const begin = (ev) => { active = true; trayClickGuard.current = true; update(ev || { clientX: sx, clientY: sy }); };
    const move = (ev) => {
      if (!active) {
        if (touch) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) { clearTimeout(hold); cleanup(); } return; }
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        begin(ev);
      }
      ev.preventDefault();
      update(ev);
    };
    const up = (ev) => {
      clearTimeout(hold); cleanup();
      if (!active) return;
      if (dndZoneAt(ev.clientX, ev.clientY) === "grid" && innerRef.current) {
        const start = clamp(snap(yToMin(ev.clientY)), 0, 1440 - dur);
        store.actions.tasks.update(t.id, { date, start_min: start, duration_min: dur }).catch(showErr);
      }
      setDnd(null);
      setTimeout(() => { trayClickGuard.current = false; }, 0);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    if (touch) hold = setTimeout(() => begin(), HOLD_MS);
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

  // Растягивание за верхний край: двигаем начало, конец остаётся на месте.
  function onResizeTopPointerDown(e, item) {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault();
    const end = item.start_min + item.duration_min;
    let newStart = item.start_min, newDur = item.duration_min;
    const move = ev => {
      newStart = clamp(snap(yToMin(ev.clientY)), 0, end - MIN_DUR);
      newDur = end - newStart;
      setDrag({ type: "resize", key: item.key, start: newStart, dur: newDur });
    };
    const up = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
      if (newStart !== item.start_min) store.actions.tasks.reschedule(item, { start_min: newStart, duration_min: newDur }).catch(showErr);
      setDrag(null);
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
  }

  function openEdit(item) {
    const row = item.kind === "concrete" ? tasks.find(t => t.id === item.id) : tasks.find(t => t.id === item.templateId);
    if (row) setEditing({ task: row, occ: item.kind === "occurrence" ? item : null });
  }
  const toggleDone = (item) => {
    doneFeedback();
    return store.actions.tasks.toggleDone(item).catch(showErr);
  };
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

  // Свайп влево/вправо по сетке дня — листание дней (как в Календаре Apple).
  // Решаем «горизонтальный жест?» по первым ~10px; вертикаль не трогаем (скролл).
  const swipeRef = useRef(null);
  function onDaySwipeStart(e) {
    if (e.touches.length !== 1 || drag) { swipeRef.current = null; return; }
    const t = e.touches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY, horiz: null };
  }
  function onDaySwipeMove(e) {
    const s = swipeRef.current;
    if (!s) return;
    if (e.touches.length !== 1) { swipeRef.current = null; return; }
    const t = e.touches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (s.horiz === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      s.horiz = Math.abs(dx) > Math.abs(dy) * 1.3;
    }
  }
  function onDaySwipeEnd(e) {
    const s = swipeRef.current; swipeRef.current = null;
    if (!s || !s.horiz) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t || Math.abs(t.clientX - s.x) < 55) return;
    const dir = t.clientX - s.x < 0 ? 1 : -1; // влево → следующий день
    shift(dir);
    haptic();
    const el = scrollRef.current;
    if (el) {
      el.classList.remove("day-slide-next", "day-slide-prev");
      void el.offsetWidth; // перезапуск анимации
      el.classList.add(dir > 0 ? "day-slide-next" : "day-slide-prev");
    }
  }
  function rowToItem(row) {
    return {
      key: row.id, kind: "concrete", id: row.id, templateId: null,
      occDate: row.date, recurring: false, done: !!row.done,
      title: row.title || "", notes: row.notes || "", color: row.color || null,
      icon: row.icon || null, list_id: row.list_id || null,
      start_min: row.start_min, duration_min: row.duration_min,
    };
  }
  function openPreview(item) { setPreview(item); }
  function handleDelete(item) {
    setPreview(null);
    if (item.recurring) { openEdit(item); return; }
    setDelItem(item);
  }

  const d = fromISO(date);
  const monthLabel = `${monthNom(d)[0].toUpperCase()}${monthNom(d).slice(1)} ${d.getFullYear()}`;
  // Подпись в шапке нужна только для недели/месяца — в режиме «День» дату
  // показывает полоса недели снизу, поэтому текст там не выводим.
  const headLabel = view === "week" ? weekRangeLabel(date) : monthLabel;
  const nowMin = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
  const isToday = date === todayISO();
  const dayTl = useMemo(() => [...timed].sort((a, b) => (a.start_min - b.start_min) || ((a.duration_min || 0) - (b.duration_min || 0))), [timed]);
  const dayGaps = useMemo(() => {
    const gaps = []; let prevEnd = null;
    for (const i of dayTl) {
      const s = i.start_min, e = s + (i.duration_min || 0);
      if (prevEnd != null && s - prevEnd >= 30) gaps.push({ start: prevEnd, mins: s - prevEnd });
      prevEnd = prevEnd == null ? e : Math.max(prevEnd, e);
    }
    return gaps;
  }, [dayTl]);

  return html`
    <div class="app">
      <div class=${"planner" + (asideOpen ? " aside-open" : "")}>
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
            ${trayTasks.length === 0
              ? html`<div class="muted small" style="padding:10px 6px;">Здесь пока нет задач.</div>`
              : trayTasks.map(t => html`
                <div class="tray-task-wrap" key=${t.id} onPointerDown=${e => startTrayDrag(e, t)}>
                  <div class=${"tray-task" + (t.done ? " done" : "")}>
                  <button class=${"task-check" + (t.done ? " on" : "")} title="Выполнено"
                    style=${t.done ? `background:${listById[t.list_id]?.color || "var(--accent)"};border-color:${listById[t.list_id]?.color || "var(--accent)"};` : ""}
                    onPointerDown=${e => e.stopPropagation()}
                    onClick=${() => toggleDone({ kind: "concrete", id: t.id, done: t.done })}>${Icon.check()}</button>
                  <button class="tray-task-body" onClick=${() => { if (trayClickGuard.current) return; setEditing({ task: t, occ: null }); }}>
                    <span class="tray-task-title">${t.title}</span>
                    <span class="tray-task-meta">
                      ${filter === "all" && t.list_id ? html`<span class="tray-task-list" style=${`color:${listById[t.list_id]?.color};`}>${listById[t.list_id]?.name} · </span>` : ""}${taskMeta(t)}</span>
                  </button>
                  ${!t.date ? html`<button class="btn-mini" title="Запланировать на этот день" onPointerDown=${e => e.stopPropagation()} onClick=${() => quickSchedule(t)}>${Icon.clock()}</button>` : ""}
                  </div>
                </div>`)}
            <button class="btn sm ghost proj-add"
              onClick=${() => setCreating({ list_id: filter !== "all" && filter !== "inbox" ? filter : null })}>
              ${Icon.plus()} Добавить задачу</button>
          </div>
        </aside>

        <div class="planner-content">
          <div class="planner-head">
            <div class="planner-nav">
              <button class="icon-btn cal-btn" title="Выбрать дату"
                onClick=${() => { const el = dateInputRef.current; el?.showPicker ? el.showPicker() : el?.focus(); }}>
                ${Icon.calendar()}
                <input class="planner-date-input" type="date" ref=${dateInputRef} value=${date}
                  onInput=${e => e.target.value && setDate(e.target.value)} />
              </button>
              <button class="btn-mini" onClick=${() => shift(-1)} title="Назад">${Icon.left()}</button>
              ${view !== "day" ? html`<span class="planner-date-main">${headLabel}</span>` : ""}
              <button class="btn-mini" onClick=${() => shift(1)} title="Вперёд">${Icon.right()}</button>
            </div>
            <div class="planner-head-actions">
              ${!isToday ? html`<button class="btn sm ghost" onClick=${() => setDate(todayISO())}>Сегодня</button>` : ""}
              <button class="btn primary sm head-add" onClick=${() => setCreating({ date, list_id: filter !== "all" && filter !== "inbox" ? filter : null })}>
                ${Icon.plus()} Задача</button>
              <button class="btn sm ghost view-cycle" title="Сменить режим"
                onClick=${() => { const i = VIEWS.findIndex(([v]) => v === view); setView(VIEWS[(i + 1) % VIEWS.length][0]); }}>
                ${(VIEWS.find(([v]) => v === view) || VIEWS[0])[1]}</button>
              <button class="icon-btn" title="Поиск" onClick=${() => setSearchOpen(true)}>${Icon.search()}</button>
              <button class="icon-btn" title="Настройки" onClick=${() => setSettingsOpen(true)}>${Icon.gear()}</button>
            </div>
          </div>

          ${view === "day" && html`<div class="planner-week">
            ${week.map(w => html`<button key=${w.iso}
              class=${"wday" + (w.iso === date ? " active" : "") + (w.iso === todayISO() ? " today" : "")}
              onClick=${() => setDate(w.iso)}>
              <span class="wday-num">${w.day}</span><span class="wday-name">${w.short}</span></button>`)}
          </div>`}

          ${view === "day" && html`<div class="planner-body">
            <div class="planner-grid-scroll" ref=${scrollRef}
              onTouchStart=${onDaySwipeStart} onTouchMove=${onDaySwipeMove} onTouchEnd=${onDaySwipeEnd}>
              <div class=${"tl" + (drag ? " busy" : "")} ref=${innerRef} onPointerDown=${onGridPointerDown} style=${`height:${24 * hourPx}px;`}>
                ${Array.from({ length: 25 }, (_, h) => html`<div class="grid-hour" style=${`top:${h * hourPx}px;`} key=${h}>
                  <span class="grid-hour-label">${String(h % 24).padStart(2, "0")}:00</span></div>`)}
                <div class="tl-spine"></div>
                ${dayGaps.map(g => {
                  const gh = (g.mins / 60) * hourPx;
                  if (gh < 42) return null;
                  return html`<div class="tl-gap" key=${"g" + g.start} style=${`top:${((g.start + g.mins / 2) / 60) * hourPx}px;`}>
                    ${gapCaption(g.mins)}</div>`;
                })}
                ${isToday && html`<div class="grid-now" style=${`top:${(nowMin / 60) * hourPx}px;`}>
                  <span class="grid-now-time">${minToHHMM(nowMin)}</span><span class="grid-now-dot"></span></div>`}
                ${selRange && html`<div class="tl-selrect"
                  style=${`top:${(selRange.lo / 60) * hourPx}px;height:${((selRange.hi - selRange.lo) / 60) * hourPx}px;`}></div>`}
                ${dayTl.map(i => {
                  let start = i.start_min, dur = i.duration_min || 0;
                  const inGroupMove = drag && drag.type === "moveGroup" && drag.keys.includes(i.key);
                  const isKeyMove = drag && drag.key === i.key && (drag.type === "move" || drag.type === "resize");
                  if (inGroupMove) start = clamp(i.start_min + drag.delta, 0, 1440 - dur);
                  else if (isKeyMove) { start = drag.start; dur = drag.dur; }
                  const dragging = inGroupMove || isKeyMove;
                  const sel = selected.has(i.key);
                  const top = (start / 60) * hourPx;
                  const height = Math.max(MIN_EVENT_PX, (dur / 60) * hourPx);
                  const density = height >= 44 ? "" : height >= 24 ? " compact" : " mini";
                  const { emoji, text } = splitEmoji(i.title);
                  const icon = i.icon || emoji;
                  const ttl = i.icon ? i.title : (text || i.title);
                  return html`<div class=${"tl-event" + density + (i.done ? " done" : "") + (dragging ? " dragging" : "") + (sel ? " sel" : "") + (drag && drag.armed && drag.key === i.key ? " armed" : "")} key=${i.key}
                    style=${`top:${top}px;height:${height}px;--c:${colorOf(i)};`}
                    onContextMenu=${e => { e.preventDefault(); e.stopPropagation(); openPreview(i); }}>
                    <div class="tl-pill" onPointerDown=${e => onBlockPointerDown(e, i)}>
                      <div class="tl-handle top" onPointerDown=${e => onResizeTopPointerDown(e, i)}></div>
                      <span class="tl-pill-icon">${icon || ""}</span>
                      <div class="tl-handle bottom" onPointerDown=${e => onResizePointerDown(e, i)}></div>
                      ${sel && html`<div class="tl-dot top" onPointerDown=${e => onResizeTopPointerDown(e, i)}></div>`}
                      ${sel && html`<div class="tl-dot bottom" onPointerDown=${e => onResizePointerDown(e, i)}></div>`}
                    </div>
                    <div class="tl-body" onPointerDown=${e => onBlockPointerDown(e, i)}>
                      <div class="tl-text">
                        <div class="tl-titlerow">
                          <div class="tl-title">${ttl}${i.recurring ? html` <span class="tl-rep">${Icon.repeat()}</span>` : ""}</div>
                          <button class=${"task-check sm" + (i.done ? " on" : "")} onPointerDown=${e => e.stopPropagation()}
                            onClick=${e => { e.stopPropagation(); toggleDone(i); }}>${Icon.check()}</button>
                        </div>
                        <div class="tl-meta">${minRangeLabel(start, dur)} (${durHuman(dur)})</div>
                      </div>
                    </div>
                  </div>`;
                })}
                ${drag && drag.type === "copy" && (() => {
                  const src = dayTl.find(x => x.key === drag.key);
                  return html`<div class="tl-ghost" style=${`top:${(drag.start / 60) * hourPx}px;height:${Math.max(MIN_EVENT_PX, (drag.dur / 60) * hourPx)}px;--c:${src ? colorOf(src) : "var(--accent)"};`}>
                    <div class="tl-ghost-pill"></div>
                    <div class="tl-ghost-label">${minRangeLabel(drag.start, drag.dur)} (${durHuman(drag.dur)})</div></div>`;
                })()}
                ${drag && drag.type === "copyGroup" && drag.keys.map(k => {
                  const it = dayTl.find(x => x.key === k);
                  if (!it) return null;
                  const ns = clamp(it.start_min + drag.delta, 0, 1440 - (it.duration_min || 0));
                  return html`<div class="tl-ghost" key=${"cg" + k} style=${`top:${(ns / 60) * hourPx}px;height:${Math.max(MIN_EVENT_PX, ((it.duration_min || 0) / 60) * hourPx)}px;--c:${colorOf(it)};`}>
                    <div class="tl-ghost-pill"></div></div>`;
                })}
                ${drag && drag.type === "create" && drag.dur > 0 && html`<div class="tl-ghost"
                  style=${`top:${(drag.start / 60) * hourPx}px;height:${Math.max(MIN_EVENT_PX, (drag.dur / 60) * hourPx)}px;`}>
                  <div class="tl-ghost-pill"></div>
                  <div class="tl-ghost-label">${minRangeLabel(drag.start, drag.dur)} (${durHuman(drag.dur)})</div></div>`}
                ${dnd && dnd.source === "tray" && dnd.zone === "grid" && dnd.gridMin !== null && html`<div class="tl-ghost"
                  style=${`top:${(dnd.gridMin / 60) * hourPx}px;height:${Math.max(MIN_EVENT_PX, (dnd.dur / 60) * hourPx)}px;--c:${dnd.color};`}>
                  <div class="tl-ghost-pill"></div>
                  <div class="tl-ghost-label">${minRangeLabel(dnd.gridMin, dnd.dur)} (${durHuman(dnd.dur)})</div></div>`}
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

        <div class="mobile-bar">
          <div class="mobile-pill">
            <button class=${"mb-btn" + (asideOpen ? " on" : "")} onClick=${() => setAsideOpen(true)}>
              ${Icon.inbox()}<span>Проекты</span></button>
            <button class=${"mb-btn" + (!asideOpen && !settingsOpen ? " on" : "")} onClick=${() => { setAsideOpen(false); setView("day"); }}>
              ${Icon.calendar()}<span>Таймлайн</span></button>
          </div>
          <button class="mobile-fab" title="Новая задача"
            onClick=${() => setCreating({ date, list_id: filter !== "all" && filter !== "inbox" ? filter : null })}>
            ${Icon.plus()}</button>
        </div>
      </div>
    </div>

    ${preview && html`<${EventCard} item=${preview}
      onClose=${() => setPreview(null)} onDelete=${() => handleDelete(preview)} />`}
    ${delItem && html`<${ConfirmModal} title="Удалить задачу?"
      message=${`«${delItem.title}» будет удалена без возможности восстановления.`}
      onCancel=${() => setDelItem(null)}
      onConfirm=${async () => { try { await store.actions.tasks.remove(delItem.id); store.pushToast("Задача удалена", "success"); }
        catch (e) { showErr(e); } setDelItem(null); }} />`}
    ${dnd && html`<div class="dnd-ghost" style=${`left:${dnd.x}px;top:${dnd.y}px;--c:${dnd.color};`}>
      <span class="dnd-ghost-dot"></span>${dnd.title}
      ${dnd.zone === "tray" ? html`<span class="dnd-ghost-hint">снять время</span>` : ""}
    </div>`}
    ${ctx && html`<div class="ctx-back" onPointerDown=${() => setCtx(null)} onContextMenu=${e => { e.preventDefault(); setCtx(null); }}>
      <div class="ctx-menu" style=${`left:${ctx.x}px;top:${ctx.y}px;`} onPointerDown=${e => e.stopPropagation()}>
        <button class="ctx-item" onClick=${() => { setListModal(ctx.list); setCtx(null); setProjOpen(false); }}>${Icon.edit()} Изменить</button>
        <button class="ctx-item danger" onClick=${() => { setDelList(ctx.list); setCtx(null); setProjOpen(false); }}>${Icon.trash()} Удалить</button>
      </div>
    </div>`}
    ${settingsOpen && html`<${SettingsModal} onClose=${() => setSettingsOpen(false)} />`}
    ${searchOpen && html`<${SearchModal} onClose=${() => setSearchOpen(false)}
      onPick=${t => { setSearchOpen(false); if (t.date) { setDate(t.date); setView("day"); } setEditing({ task: t, occ: null }); }} />`}
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
