import { html } from "htm/preact";
import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "preact/hooks";
import { useStore } from "./store.js";
import {
  Icon, todayISO, toISO, fromISO, monthGen, monthNom, relLabel,
  minRangeLabel, minToHHMM, itemsForDate,
  monthMatrix, weekRangeLabel, weekStart,
  durHuman, doneFeedback, haptic,
} from "./lib.js";
import { ConfirmModal, Toasts, TaskEditor, ListForm, AuthForm, SettingsModal, SearchModal } from "./components.js";

const VIEWS = [["day", "День"], ["week", "Неделя"], ["month", "Месяц"]];
const WD_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
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
  // Дата, выбранная свайпом, до завершения анимации переезда: полоса недели и
  // вибрация реагируют на неё мгновенно, пока сетка ещё доезжает.
  const [pendingDate, setPendingDate] = useState(null);
  const dateRef = useRef(todayISO());
  dateRef.current = date;
  const [view, setView] = useState(readView());
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(null);
  const [editing, setEditing] = useState(null);
  const [drag, setDrag] = useState(null);
  const [dnd, setDnd] = useState(null);
  const [openSubs, setOpenSubs] = useState(() => new Set()); // ключи задач с раскрытыми подзадачами в сетке
  const toggleSubs = (key) => setOpenSubs(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const [titleEdit, setTitleEdit] = useState(null); // { key, value } — встроенная правка названия в сетке
  const [subEdit, setSubEdit] = useState(null);     // { key, subId, value } — встроенная правка подзадачи
  const [listModal, setListModal] = useState(null);
  const [delList, setDelList] = useState(null);
  const [hourPx, setHourPx] = useState(readHourPx());
  // Соседние дни карусели рисуем только во время горизонтального свайпа —
  // иначе зум (масштаб сетки) тормозил бы из-за перерисовки сразу трёх дней.
  const [peek, setPeek] = useState(false);
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
  const trackRef = useRef(null);
  const keepScrollRef = useRef(false);
  const pendingRecenterRef = useRef(false);
  const commitFinalizeRef = useRef(null);
  const peekTimerRef = useRef(null);
  const weekScrollRef = useRef(null);
  const dateInputRef = useRef(null);
  const hourPxRef = useRef(hourPx);
  const zoomAnchor = useRef(null);
  const zoomFocus = useRef(null);   // точка под пальцами при зуме (фиксируем её)
  const zoomingRef = useRef(false); // идёт изменение масштаба
  const swipingRef = useRef(false); // идёт горизонтальный свайп дней
  const projRef = useRef(null);
  const asideRef = useRef(null);
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
  useEffect(() => () => clearTimeout(peekTimerRef.current), []); // не оставлять таймер при размонтировании

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

  // Снять выделение кликом в любое место вне капсулы (даже по названию, заметке,
  // пустой области). Слушаем в фазе захвата, чтобы ловить и события, у которых
  // дочерние обработчики останавливают всплытие (название, подзадачи).
  useEffect(() => {
    if (selected.size === 0) return;
    const onDown = (e) => { const t = e.target; if (!(t && t.closest && t.closest(".tl-pill"))) setSelected(new Set()); };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [selected]);
  useEffect(() => { hourPxRef.current = hourPx; try { localStorage.setItem("planner.hourPx", String(hourPx)); } catch (e) {} }, [hourPx]);

  // Запоминаем точку под курсором перед зумом, чтобы после смены масштаба
  // оставить это же время дня под курсором (как в Apple Календаре).
  function computeAnchor(clientY) {
    const cont = scrollRef.current, grid = innerRef.current;
    if (!cont || !grid) return null;
    const yInContainer = clientY - cont.getBoundingClientRect().top;
    const timeMin = (clientY - grid.getBoundingClientRect().top) / hourPxRef.current * 60;
    return { timeMin, yInContainer };
  }
  function zoomAnchorAt(clientY) { zoomAnchor.current = computeAnchor(clientY); }
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
    const onGStart = (e) => {
      e.preventDefault();
      if (swipingRef.current) return; // идёт свайп — зум не начинаем
      zoomingRef.current = true;
      base = hourPxRef.current;
      clearTimeout(peekTimerRef.current); setPeek(false); // зум — без соседних дней (легче)
    };
    const onGChange = (e) => {
      e.preventDefault();
      if (swipingRef.current || !zoomingRef.current) return;
      markZooming();
      // Фиксируем точку под пальцами (захвачена в touchstart на два пальца);
      // если её нет — масштабируем относительно центра видимой области.
      const r = el.getBoundingClientRect();
      zoomAnchor.current = zoomFocus.current || computeAnchor(r.top + el.clientHeight / 2);
      setHourPx(clamp(Math.round(base * e.scale), HOUR_MIN, HOUR_MAX));
    };
    const onGEnd = () => { zoomingRef.current = false; zoomFocus.current = null; };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGStart);
    el.addEventListener("gesturechange", onGChange);
    el.addEventListener("gestureend", onGEnd);
    return () => {
      clearTimeout(clsTimer);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGStart);
      el.removeEventListener("gesturechange", onGChange);
      el.removeEventListener("gestureend", onGEnd);
    };
  }, [view]);

  const lists = useMemo(() => [...taskLists].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)), [taskLists]);
  const listById = useMemo(() => Object.fromEntries(lists.map(l => [l.id, l])), [lists]);
  const matches = (lid) => filter === "all" || (filter === "inbox" ? !lid : lid === filter);

  const dayItems = useMemo(() => itemsForDate(tasks, date).filter(i => matches(i.list_id)), [tasks, date, filter]);
  const timed = dayItems.filter(i => i.start_min !== null && i.start_min !== undefined);
  // Задачи этого дня без времени — показываем в зоне «весь день» над сеткой.
  const allDay = dayItems.filter(i => i.start_min === null || i.start_min === undefined);
  const allDayIds = new Set(allDay.map(i => (i.kind === "occurrence" ? i.templateId : i.id)));
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
  const trayTasks = projTasks.filter(t => !gridIds.has(t.id) && !allDayIds.has(t.id));

  const week = useMemo(() => {
    const base = fromISO(pendingDate || date);
    const off = (base.getDay() + 6) % 7;
    const mon = new Date(base); mon.setDate(base.getDate() - off);
    const WD = WD_SHORT;
    return Array.from({ length: 7 }, (_, k) => {
      const dd = new Date(mon); dd.setDate(mon.getDate() + k);
      return { iso: toISO(dd), day: dd.getDate(), short: WD[k] };
    });
  }, [date, pendingDate]);

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
    const WD = WD_SHORT;
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
    if (keepScrollRef.current) { keepScrollRef.current = false; return; } // свайп дня — оставляем позицию
    const el = view === "day" ? scrollRef.current : view === "week" ? weekScrollRef.current : null;
    if (!el) return;
    const now = new Date();
    const target = view === "day" && date === todayISO() ? now.getHours() * 60 + now.getMinutes() : 8 * 60;
    // Ставим позицию после раскладки (двойной rAF) — иначе на старте iOS высота
    // ещё не финальная и прокрутка встаёт криво (пустые места сверху/снизу).
    const apply = () => {
      let off = 0; // высота зоны «весь день» + отступ сетки — чтобы «сейчас» вставало точно
      if (view === "day" && innerRef.current) off = (innerRef.current.getBoundingClientRect().top - el.getBoundingClientRect().top) + el.scrollTop;
      el.scrollTop = Math.max(0, off + (target / 60) * hourPx - 120);
    };
    apply();
    const id = requestAnimationFrame(() => requestAnimationFrame(apply));
    return () => cancelAnimationFrame(id);
  }, [view, date]);

  // После переключения дня свайпом лента уехала к соседней панели — мгновенно
  // (до отрисовки) возвращаем её в центр, где уже отрисован новый текущий день.
  useLayoutEffect(() => {
    if (!pendingRecenterRef.current) return;
    pendingRecenterRef.current = false;
    const track = trackRef.current;
    if (track) {
      track.style.transition = "none";
      track.style.transform = "translateX(-100%)";
      void track.offsetWidth;
      track.style.transition = "";
      track.style.transform = "";
    }
    schedulePeekOff(); // соседние дни прячем с задержкой (для листания подряд)
  }, [date]);

  const yToMin = (clientY) => ((clientY - innerRef.current.getBoundingClientRect().top) / hourPx) * 60;
  const colorOf = (i) => i.color || listById[i.list_id]?.color || "var(--accent)";
  const showErr = (e) => store.pushToast(e.message || "Ошибка сохранения", "error");
  // Цель правки: у повтора — шаблон, иначе сама задача.
  const taskTargetId = (i) => i.recurring ? i.templateId : i.id;
  // Фокус + каретка в конец при появлении поля встроенной правки.
  const focusEnd = (el) => { if (el && !el._fe) { el._fe = true; el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} } };
  // Смещение каретки по точке клика (чтобы курсор встал туда, куда кликнули).
  function caretOffsetFromClick(e) {
    try {
      if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(e.clientX, e.clientY); return r ? r.startOffset : null; }
      if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(e.clientX, e.clientY); return p ? p.offset : null; }
    } catch (_) {}
    return null;
  }
  function startTitleEdit(i, caret) { setSubEdit(null); setTitleEdit({ key: i.key, value: i.title || "", caret }); }
  function commitTitle(i) {
    const e = titleEdit; if (!e || e.key !== i.key) return;
    const v = e.value.trim(); setTitleEdit(null);
    if (v && v !== (i.title || "")) store.actions.tasks.update(taskTargetId(i), { title: v }).catch(showErr);
  }
  function startSubEdit(i, s) { setTitleEdit(null); setSubEdit({ key: i.key, subId: s.id, value: s.title || "" }); }
  function commitSubEdit(i) {
    const e = subEdit; if (!e || e.key !== i.key) return;
    const v = e.value.trim(); const sid = e.subId; setSubEdit(null);
    if (v) store.actions.tasks.updateSub(taskTargetId(i), sid, { title: v }).catch(showErr);
  }

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
      // Непассивный слушатель добавляем только после активации создания — чтобы
      // обычная вертикальная прокрутка оставалась быстрой (без ожидания JS).
      document.addEventListener("touchmove", onTouchMove, { passive: false });
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
    if (touch) hold = setTimeout(beginTouch, HOLD_MS);
  }

  // В какой зоне находится точка: над сеткой дня или над боковой панелью.
  function dndZoneAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (el.closest(".allday")) return "allday";
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
  function onBlockTouch(e, item, tapAction) {
    const sx = e.clientX, sy = e.clientY;
    const grab = yToMin(e.clientY) - item.start_min;
    const dur = item.duration_min || 0;
    // Уже выделенную пилюлю можно двигать сразу, без повторного удержания.
    const already = selected.has(item.key);
    let armed = false, moved = false, hold = null, newStart = item.start_min;
    const onTouchMove = ev => { if (armed) ev.preventDefault(); };
    const arm = (select) => {
      armed = true;
      document.addEventListener("touchmove", onTouchMove, { passive: false });
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
      if (!wasArmed) { (tapAction || (() => openPreview(item)))(); return; }
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
    if (already) arm(false);                       // уже выделена → двигаем сразу
    else hold = setTimeout(() => arm(true), 280);  // не выделена → выделяем удержанием
  }

  function onBlockPointerDown(e, item, tapAction) {
    e.stopPropagation();
    if (e.button === 2) return; // правый клик — контекстное меню (карточка)
    if (e.pointerType === "touch") { onBlockTouch(e, item, tapAction); return; }
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
      // Утянули в боковую панель или в зону «весь день» — задача «снимается» из
      // сетки (плавающий ярлык + подсветка зоны-приёмника).
      const z = !copy && item.kind === "concrete" ? dndZoneAt(ev.clientX, ev.clientY) : null;
      if (z === "tray" || z === "allday") {
        setDrag(null);
        setDnd({ source: "grid", title: item.title, color: colorOf(item), x: ev.clientX, y: ev.clientY, zone: z });
        return;
      }
      setDnd(null);
      newStart = clamp(snap(yToMin(ev.clientY) - grab), 0, 1440 - item.duration_min);
      setDrag({ type: copy ? "copy" : "move", key: item.key, start: newStart, dur: item.duration_min });
    };
    const up = (ev) => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
      setDrag(null); setDnd(null);
      if (!moved) { (tapAction || (() => handleTap(item, shift)))(); return; }
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
      } else if (item.kind === "concrete" && (() => { const z = dndZoneAt(ev.clientX, ev.clientY); return z === "tray" || z === "allday"; })()) {
        // В боковую панель или в зону «весь день» — снимаем время (день остаётся).
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
    const d = fromISO(dateRef.current);
    if (view === "month") d.setMonth(d.getMonth() + delta);
    else if (view === "week") d.setDate(d.getDate() + delta * 7);
    else d.setDate(d.getDate() + delta);
    dateRef.current = toISO(d); // синхронно — чтобы листать дни подряд без потери шага
    setDate(dateRef.current);
  }
  function openDay(iso) { setDate(iso); setView("day"); }

  // Шторка проектов: тянем за пальцем от края экрана. От левого края — открываем,
  // от правого (когда открыта) — закрываем. Лента едет вместе с пальцем, после
  // отпускания мягко доезжает (медленно).
  function edgeSwipe(e, mode) {
    const el = asideRef.current;
    if (!el) return;
    const sx = e.touches[0].clientX, sy = e.touches[0].clientY;
    const W = window.innerWidth;
    const base = mode === "open" ? -W : 0;
    let decided = null, cur = base, lastX = sx, lastT = performance.now(), vx = 0;
    const move = ev => {
      const t = ev.touches[0]; if (!t) return;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (decided === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        decided = Math.abs(dx) > Math.abs(dy);
        if (!decided) { cleanup(); return; } // вертикаль — это прокрутка, не шторка
      }
      const now = performance.now();
      if (now > lastT) vx = (t.clientX - lastX) / (now - lastT);
      lastX = t.clientX; lastT = now;
      cur = Math.max(-W, Math.min(0, base + dx));
      el.style.transition = "none";
      el.style.transform = `translateX(${cur}px)`;
    };
    const end = () => {
      cleanup();
      if (decided !== true) return;
      let open;
      if (vx > 0.2) open = true;        // флик вправо — открыть
      else if (vx < -0.2) open = false; // флик влево — закрыть
      else if (mode === "open") open = (cur + W) > 8;  // сдвинул хоть чуть-чуть — открываем
      else open = !((-cur) > 8);                        // сдвинул хоть чуть-чуть — закрываем
      el.style.transition = "transform .5s cubic-bezier(.22,1,.3,1)";
      el.style.transform = `translateX(${open ? 0 : -W}px)`;
      setAsideOpen(open);
      const onEnd = () => { el.removeEventListener("transitionend", onEnd); el.style.transition = ""; el.style.transform = ""; };
      el.addEventListener("transitionend", onEnd);
    };
    const cleanup = () => {
      document.removeEventListener("touchmove", move, { passive: true });
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", end);
    };
    document.addEventListener("touchmove", move, { passive: true });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", end);
  }
  function onAsideSwipeStart(e) {
    if (e.touches.length !== 1) return;
    if (e.touches[0].clientX < window.innerWidth - 26) return; // только от правого края
    edgeSwipe(e, "close");
  }
  // Соседние дни оставляем смонтированными ещё немного после свайпа — чтобы при
  // быстром листании подряд не перерисовывать их каждый раз (без рывков).
  function schedulePeekOff() {
    clearTimeout(peekTimerRef.current);
    peekTimerRef.current = setTimeout(() => setPeek(false), 700);
  }

  // Свайп по сетке дня — карусель «как в Apple»: лента из трёх дней (вчера/
  // сегодня/завтра) едет за пальцем с лёгким сопротивлением, соседний день виден
  // сразу. Переключение — по короткому свайпу или быстрому флику. Можно листать
  // дни подряд: новый свайп мгновенно завершает предыдущий переход.
  function onDaySwipeStart(e) {
    // Два пальца — это зум: фиксируем точку под пальцами и не начинаем свайп.
    if (e.touches.length === 2) {
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomFocus.current = computeAnchor(midY);
      return;
    }
    if (e.touches.length !== 1 || drag || zoomingRef.current) return;
    // Свайп от левого края → выезжает шторка проектов (свайп в центре — дни).
    if (!asideOpen && e.touches[0].clientX < 26) {
      edgeSwipe(e, "open");
      return;
    }
    const track = trackRef.current;
    if (!track) return;
    // Идёт анимация прошлого перехода — мгновенно её завершаем (листание подряд).
    if (commitFinalizeRef.current) commitFinalizeRef.current();
    const sx = e.touches[0].clientX, sy = e.touches[0].clientY;
    const W = scrollRef.current ? scrollRef.current.getBoundingClientRect().width : window.innerWidth;
    let horiz = null, dx = 0, lastX = sx, lastT = performance.now(), vx = 0, peeked = false;
    const move = ev => {
      // Появился второй палец или начался зум — прерываем свайп.
      if (ev.touches.length > 1 || zoomingRef.current) { swipingRef.current = false; cancelBack(); return; }
      const t = ev.touches[0]; if (!t) return;
      dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if (horiz === null && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        horiz = Math.abs(dx) > Math.abs(dy) * 0.7;
        if (!horiz) { cleanup(); return; } // вертикаль — отдаём прокрутке, снимаем слушатель
      }
      if (!horiz) return;
      ev.preventDefault(); // жёстко гасим вертикальную прокрутку — никакой диагонали
      if (!peeked) { peeked = true; clearTimeout(peekTimerRef.current); setPeek(true); swipingRef.current = true; } // показать соседние дни
      const now = performance.now();
      if (now > lastT) vx = (t.clientX - lastX) / (now - lastT);
      lastX = t.clientX; lastT = now;
      track.style.transition = "none";
      track.style.transform = `translateX(calc(-100% + ${dx}px))`;
    };
    const cleanup = () => {
      document.removeEventListener("touchmove", move, { passive: false });
      document.removeEventListener("touchend", finish);
      document.removeEventListener("touchcancel", finish);
    };
    // Прервать свайп (начался зум/второй палец) — вернуть ленту в центр.
    const cancelBack = () => {
      cleanup();
      setPeek(false);
      track.style.transition = "transform .2s cubic-bezier(.16,1,.3,1)";
      void track.offsetWidth;
      track.style.transform = "translateX(-100%)";
      const onB = () => { track.removeEventListener("transitionend", onB); track.style.transition = ""; track.style.transform = ""; };
      track.addEventListener("transitionend", onB);
    };
    const finish = () => {
      cleanup();
      swipingRef.current = false;
      if (!horiz) return;
      const commit = Math.abs(dx) > Math.min(42, W * 0.11) || Math.abs(vx) > 0.18;
      if (!commit) {
        track.style.transition = "transform .25s cubic-bezier(.16,1,.3,1)";
        void track.offsetWidth; // reflow — чтобы возврат анимировался, а не прыгал
        track.style.transform = "translateX(-100%)";
        const onBack = () => { track.removeEventListener("transitionend", onBack); track.style.transition = ""; track.style.transform = ""; schedulePeekOff(); };
        track.addEventListener("transitionend", onBack);
        return;
      }
      const dir = dx < 0 ? 1 : -1; // влево → следующий день
      // Подсветку дня вверху и вибрацию даём сразу — «попал в другой день».
      const td = fromISO(dateRef.current); td.setDate(td.getDate() + dir);
      setPendingDate(toISO(td));
      haptic();
      const finalize = () => {
        if (commitFinalizeRef.current !== finalize) return;
        commitFinalizeRef.current = null;
        track.removeEventListener("transitionend", finalize);
        keepScrollRef.current = true;
        pendingRecenterRef.current = true;
        shift(dir);
        setPendingDate(null);
      };
      commitFinalizeRef.current = finalize;
      // Быстрый флик — короткая «снаппи» анимация (для быстрого листания подряд),
      // медленный осознанный свайп — плавнее.
      const durMs = Math.abs(vx) > 0.3 ? 440 : 600;
      track.style.transition = `transform ${durMs}ms cubic-bezier(.25,.46,.45,.94)`;
      void track.offsetWidth; // reflow — иначе Safari прыгает мгновенно вместо анимации
      track.style.transform = `translateX(${dir > 0 ? "-200%" : "0%"})`;
      track.addEventListener("transitionend", finalize);
    };
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", finish);
    document.addEventListener("touchcancel", finish);
  }
  function rowToItem(row) {
    return {
      key: row.id, kind: "concrete", id: row.id, templateId: null,
      occDate: row.date, recurring: false, done: !!row.done,
      title: row.title || "", notes: row.notes || "", color: row.color || null,
      icon: row.icon || null, list_id: row.list_id || null,
      start_min: row.start_min, duration_min: row.duration_min,
      subtasks: Array.isArray(row.subtasks) ? row.subtasks : [],
    };
  }
  function openPreview(item) { openEdit(item); }

  const d = fromISO(date);
  const monthLabel = `${monthNom(d)[0].toUpperCase()}${monthNom(d).slice(1)} ${d.getFullYear()}`;
  // Подпись в шапке нужна только для недели/месяца — в режиме «День» дату
  // показывает полоса недели снизу, поэтому текст там не выводим.
  const headLabel = view === "week" ? weekRangeLabel(date) : monthLabel;
  const nowMin = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
  const isToday = date === todayISO();
  const dayTl = useMemo(() => [...timed].sort((a, b) => (a.vTop - b.vTop) || ((a.vEnd - a.vTop) - (b.vEnd - b.vTop))), [timed]);

  // ---- Встроенный редактор: где монтировать (одно из трёх мест) ----
  const edTask = editing?.task || null;
  const closeEditor = () => { setEditing(null); setCreating(null); };
  const editorEl = (editing || creating)
    ? html`<${TaskEditor} key=${editing ? "e" + editing.task.id : "c"}
        initial=${editing ? editing.task : undefined}
        occ=${editing ? editing.occ : undefined}
        defaults=${creating || undefined}
        onClose=${closeEditor} />`
    : null;
  // В сетке дня — привязка к минуте начала задачи (для повторов — к позиции
  // конкретного повторения на текущем дне).
  const edGridMin = view === "day"
    ? (editing && editing.occ && editing.occ.start_min != null ? editing.occ.start_min
      : editing && edTask && edTask.date === date && edTask.start_min != null ? edTask.start_min
      : creating && creating.date === date && creating.start_min != null ? creating.start_min
      : null)
    : null;
  // В боковой панели — для задач без даты/времени (если они в текущей панели).
  const edPanel = (editing && edTask && !edTask.date && trayTasks.some(t => t.id === edTask.id))
    || (creating && !creating.date);
  // Плавающая карточка — всё остальное (другой день, не «День», и т.п.).
  const edFloat = !!(editing || creating) && edGridMin == null && !edPanel;

  const prevDate = (() => { const x = fromISO(date); x.setDate(x.getDate() - 1); return toISO(x); })();
  const nextDate = (() => { const x = fromISO(date); x.setDate(x.getDate() + 1); return toISO(x); })();
  // Статичная (без жестов) панель соседнего дня — для предпросмотра в карусели.
  function dayStaticPane(pd) {
    const items = itemsForDate(tasks, pd)
      .filter(i => i.vTop !== null && i.vTop !== undefined)
      .sort((a, b) => (a.vTop - b.vTop) || ((a.vEnd - a.vTop) - (b.vEnd - b.vTop)));
    const td = pd === todayISO();
    return html`<div class="tl tl-static" style=${`height:${24 * hourPx}px;`}>
      ${Array.from({ length: 25 }, (_, h) => html`<div class="grid-hour" style=${`top:${h * hourPx}px;`} key=${h}>
        <span class="grid-hour-label">${String(h % 24).padStart(2, "0")}:00</span></div>`)}
      <div class="tl-spine"></div>
      ${td && html`<div class="grid-now" style=${`top:${(nowMin / 60) * hourPx}px;`}>
        <span class="grid-now-time">${minToHHMM(nowMin)}</span><span class="grid-now-dot"></span></div>`}
      ${items.map(i => {
        const top = (i.vTop / 60) * hourPx;
        const height = Math.max(MIN_EVENT_PX, ((i.vEnd - i.vTop) / 60) * hourPx);
        const density = height >= 44 ? "" : height >= 24 ? " compact" : " mini";
        return html`<div class=${"tl-event" + density + (i.done ? " done" : "") + (i.spanTop ? " span-top" : "") + (i.spanBottom ? " span-bottom" : "")} key=${i.key}
          style=${`top:${top}px;height:${height}px;--c:${colorOf(i)};`}>
          <div class="tl-pill"><span class=${"tl-pill-check" + (i.done ? " on" : "")}>${Icon.check()}</span></div>
          <div class="tl-body"><div class="tl-text">
            <div class="tl-titlerow">
              <div class="tl-title">${i.title}${i.recurring ? html` <span class="tl-rep">${Icon.repeat()}</span>` : ""}</div>
            </div>
            <div class="tl-meta">${minRangeLabel(i.start_min, i.duration_min || 0)} (${durHuman(i.duration_min || 0)})</div>
          </div></div>
        </div>`;
      })}
    </div>`;
  }

  return html`
    <div class="app">
      <div class=${"planner" + (asideOpen ? " aside-open" : "")}>
        <aside class="planner-aside" ref=${asideRef} onTouchStart=${onAsideSwipeStart}>
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
              : trayTasks.map(t => (editing && edTask && !edTask.date && edTask.id === t.id)
                ? html`<div key=${t.id}>${editorEl}</div>`
                : html`
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
            ${creating && !creating.date && editorEl}
            ${!(creating && !creating.date) && html`<button class="btn sm ghost proj-add"
              onClick=${() => setCreating({ list_id: filter !== "all" && filter !== "inbox" ? filter : null })}>
              ${Icon.plus()} Добавить задачу</button>`}
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
              ${view !== "day" ? html`<span class="planner-date-main">${headLabel}</span>` : ""}
            </div>
            <div class="planner-head-actions">
              ${!isToday ? html`<button class="btn sm ghost" onClick=${() => setDate(todayISO())}>Сегодня</button>` : ""}
              <button class="btn sm ghost view-cycle" title="Сменить режим"
                onClick=${() => { const i = VIEWS.findIndex(([v]) => v === view); setView(VIEWS[(i + 1) % VIEWS.length][0]); }}>
                ${(VIEWS.find(([v]) => v === view) || VIEWS[0])[1]}</button>
              <button class="icon-btn" title="Поиск" onClick=${() => setSearchOpen(true)}>${Icon.search()}</button>
              <button class="icon-btn" title="Настройки" onClick=${() => setSettingsOpen(true)}>${Icon.gear()}</button>
            </div>
          </div>

          ${view === "day" && html`<div class="planner-week">
            ${week.map(w => html`<button key=${w.iso}
              class=${"wday" + (w.iso === (pendingDate || date) ? " active" : "") + (w.iso === todayISO() ? " today" : "")}
              onClick=${() => setDate(w.iso)}>
              <span class="wday-num">${w.day}</span><span class="wday-name">${w.short}</span></button>`)}
          </div>`}

          ${view === "day" && html`<div class="planner-body">
            <div class="planner-grid-scroll" ref=${scrollRef} onTouchStart=${onDaySwipeStart}>
              <div class=${"allday" + (allDay.length === 0 ? " empty" : "") + (dnd && dnd.zone === "allday" ? " drop" : "")}>
                ${allDay.map(i => html`
                  <div class=${"allday-item" + (i.done ? " done" : "")} key=${i.key}
                    onPointerDown=${e => { if (i.id) startTrayDrag(e, i); }}>
                    <button class=${"allday-check" + (i.done ? " on" : "")} type="button" title="Выполнено"
                      style=${`border-color:${colorOf(i)};color:${colorOf(i)};`}
                      onClick=${() => { if (trayClickGuard.current) return; toggleDone(i); }}>${Icon.check()}</button>
                    ${titleEdit && titleEdit.key === i.key
                      ? html`<input class="allday-edit" value=${titleEdit.value}
                          ref=${el => { if (el && !el._fe) { el._fe = true; el.focus(); const n = el.value.length; const c = titleEdit.caret; const pos = (c == null || c > n) ? n : c; try { el.setSelectionRange(pos, pos); } catch (e) {} } }}
                          onInput=${e => setTitleEdit({ key: i.key, value: e.target.value, caret: titleEdit.caret })}
                          onKeyDown=${e => { if (e.key === "Enter") { e.preventDefault(); commitTitle(i); } else if (e.key === "Escape") { e.preventDefault(); setTitleEdit(null); } }}
                          onBlur=${() => commitTitle(i)} />`
                      : html`<span class="allday-title" onClick=${e => { e.stopPropagation(); if (trayClickGuard.current) return; startTitleEdit(i, caretOffsetFromClick(e)); }}>${i.title}</span>`}
                  </div>`)}
                ${allDay.length === 0 ? html`<span class="allday-hint">Весь день</span>` : ""}
              </div>
              <div class="tl-track" ref=${trackRef}>
              <div class="tl-pane">${peek ? dayStaticPane(prevDate) : null}</div>
              <div class="tl-pane">
              <div class=${"tl" + (drag ? " busy" : "")} ref=${innerRef} onPointerDown=${onGridPointerDown} style=${`height:${24 * hourPx}px;`}>
                ${Array.from({ length: 25 }, (_, h) => html`<div class="grid-hour" style=${`top:${h * hourPx}px;`} key=${h}>
                  <span class="grid-hour-label">${String(h % 24).padStart(2, "0")}:00</span></div>`)}
                <div class="tl-spine"></div>
                ${isToday && html`<div class="grid-now" style=${`top:${(nowMin / 60) * hourPx}px;`}>
                  <span class="grid-now-time">${minToHHMM(nowMin)}</span><span class="grid-now-dot"></span></div>`}
                ${selRange && html`<div class="tl-selrect"
                  style=${`top:${(selRange.lo / 60) * hourPx}px;height:${((selRange.hi - selRange.lo) / 60) * hourPx}px;`}></div>`}
                ${edGridMin != null && html`<div class="ed-anchor" style=${`top:${(edGridMin / 60) * hourPx}px;`}>${editorEl}</div>`}
                ${dayTl.map(i => {
                  // Переходящая через полночь задача рисуется сегментом дня и не
                  // перетаскивается/не тянется (правка — через карточку по тапу).
                  const spanning = i.spanTop || i.spanBottom || i.cont;
                  let vTop = i.vTop, vDur = i.vEnd - i.vTop;
                  const inGroupMove = drag && drag.type === "moveGroup" && drag.keys.includes(i.key);
                  const isKeyMove = drag && drag.key === i.key && (drag.type === "move" || drag.type === "resize");
                  if (inGroupMove) vTop = clamp(i.start_min + drag.delta, 0, 1440 - vDur);
                  else if (isKeyMove) { vTop = drag.start; vDur = drag.dur; }
                  const dragging = inGroupMove || isKeyMove;
                  const sel = selected.has(i.key);
                  const top = (vTop / 60) * hourPx;
                  const height = Math.max(MIN_EVENT_PX, (vDur / 60) * hourPx);
                  const density = height >= 44 ? "" : height >= 24 ? " compact" : " mini";
                  const down = spanning ? (e => e.stopPropagation()) : (e => onBlockPointerDown(e, i));
                  const tap = spanning ? (e => { e.stopPropagation(); openPreview(i); }) : null;
                  return html`<div class=${"tl-event" + density + (i.done ? " done" : "") + (dragging ? " dragging" : "") + (sel ? " sel" : "") + (drag && drag.armed && drag.key === i.key ? " armed" : "") + (i.spanTop ? " span-top" : "") + (i.spanBottom ? " span-bottom" : "") + (openSubs.has(i.key) ? " subs-open" : "")} key=${i.key}
                    style=${`top:${top}px;height:${height}px;--c:${colorOf(i)};`}
                    onContextMenu=${e => { e.preventDefault(); e.stopPropagation(); openPreview(i); }}>
                    <div class="tl-pill" onPointerDown=${down} onClick=${tap}>
                      ${!spanning && html`<div class="tl-handle top" onPointerDown=${e => onResizeTopPointerDown(e, i)}></div>`}
                      <button class=${"tl-pill-check" + (i.done ? " on" : "")} type="button" title="Выполнено"
                        onPointerDown=${e => e.stopPropagation()}
                        onClick=${e => { e.stopPropagation(); toggleDone(i); }}>${Icon.check()}</button>
                      ${!spanning && html`<div class="tl-handle bottom" onPointerDown=${e => onResizePointerDown(e, i)}></div>`}
                      ${sel && !spanning && html`<div class="tl-dot top" onPointerDown=${e => onResizeTopPointerDown(e, i)}></div>`}
                      ${sel && !spanning && html`<div class="tl-dot bottom" onPointerDown=${e => onResizePointerDown(e, i)}></div>`}
                    </div>
                    <div class="tl-body" onPointerDown=${e => e.stopPropagation()}>
                      <div class="tl-text">
                        <div class="tl-titlerow">
                          ${titleEdit && titleEdit.key === i.key
                            ? html`<input class="tl-title-edit" value=${titleEdit.value}
                                ref=${el => { if (el && !el._fe) { el._fe = true; el.focus(); const n = el.value.length; const c = titleEdit.caret; const pos = (c == null || c > n) ? n : c; try { el.setSelectionRange(pos, pos); } catch (e) {} } }}
                                style=${`width:${Math.max(titleEdit.value.length + 1, 4)}ch;`}
                                onInput=${e => setTitleEdit({ key: i.key, value: e.target.value, caret: titleEdit.caret })}
                                onKeyDown=${e => { if (e.key === "Enter") { e.preventDefault(); commitTitle(i); } else if (e.key === "Escape") { e.preventDefault(); setTitleEdit(null); } }}
                                onBlur=${() => commitTitle(i)} />`
                            : html`<div class="tl-title"
                                onPointerDown=${e => { if (!spanning) onBlockPointerDown(e, i, () => startTitleEdit(i, caretOffsetFromClick(e))); }}
                                onClick=${e => { if (spanning) { e.stopPropagation(); startTitleEdit(i, caretOffsetFromClick(e)); } }}>${i.title}${i.recurring ? html` <span class="tl-rep">${Icon.repeat()}</span>` : ""}</div>`}
                        </div>
                        <div class="tl-meta">${minRangeLabel(dragging ? vTop : i.start_min, dragging ? vDur : (i.duration_min || 0))} (${durHuman(dragging ? vDur : (i.duration_min || 0))})</div>
                        ${(i.subtasks && i.subtasks.length && !spanning) ? html`
                          <div class="tl-subs" onPointerDown=${e => e.stopPropagation()}>
                            <button class=${"tl-subs-chip" + (openSubs.has(i.key) ? " open" : "")} type="button"
                              onClick=${e => { e.stopPropagation(); toggleSubs(i.key); }}>
                              <span class="tl-subs-box">${Icon.check()}</span>
                              <span class="tl-subs-count">${i.subtasks.filter(s => s.done).length}/${i.subtasks.length}</span>
                              <span class="tl-subs-chev">${Icon.right()}</span>
                            </button>
                            <div class=${"tl-subs-wrap" + (openSubs.has(i.key) ? " open" : "")}>
                              <div class="tl-subs-list">
                                ${i.subtasks.map(s => html`
                                  <div class=${"tl-subs-item" + (s.done ? " done" : "")} key=${s.id}>
                                    <button class=${"task-check sm" + (s.done ? " on" : "")} type="button"
                                      style=${`border-color:${colorOf(i)};${s.done ? `background:${colorOf(i)};` : ""}`}
                                      onClick=${e => { e.stopPropagation(); store.actions.tasks.toggleSub(i.recurring ? i.templateId : i.id, s.id).catch(showErr); }}>${Icon.check()}</button>
                                    ${subEdit && subEdit.key === i.key && subEdit.subId === s.id
                                      ? html`<input class="tl-subs-edit" ref=${focusEnd} value=${subEdit.value}
                                          onInput=${e => setSubEdit({ key: i.key, subId: s.id, value: e.target.value })}
                                          onKeyDown=${e => { if (e.key === "Enter") { e.preventDefault(); commitSubEdit(i); } else if (e.key === "Escape") { e.preventDefault(); setSubEdit(null); } }}
                                          onBlur=${() => commitSubEdit(i)} />`
                                      : html`<span class="tl-subs-title" onClick=${e => { e.stopPropagation(); startSubEdit(i, s); }}>${s.title}</span>`}
                                  </div>`)}
                              </div>
                            </div>
                          </div>` : ""}
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
              <div class="tl-pane">${peek ? dayStaticPane(nextDate) : null}</div>
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

        <button class="mobile-fab" title="Новая задача"
          onClick=${() => setCreating({ date, list_id: filter !== "all" && filter !== "inbox" ? filter : null,
            start_min: clamp((isToday ? Math.round(nowMin / 30) * 30 : 540), 0, 1380), duration_min: 60 })}>
          ${Icon.plus()}</button>
      </div>
    </div>

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
    ${edFloat && html`<div class="ed-float-back" onPointerDown=${e => { if (e.target === e.currentTarget) closeEditor(); }}>${editorEl}</div>`}
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
    : { ...i, _start: i.vTop, _dur: i.vEnd - i.vTop });
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
