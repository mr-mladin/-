import { html } from "htm/preact";
import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import { useStore } from "./store.js";
import {
  Icon, todayISO, toISO, fromISO, monthGen, relLabel,
  minRangeLabel, minToHHMM, itemsForDate, unscheduledTasks,
} from "./lib.js";
import { Modal, ConfirmModal, Toasts, TaskForm, ListForm, AuthForm } from "./components.js";

const HOUR_PX = 80;
const GUTTER = 56;
const SNAP = 5;
const MIN_DUR = 15;
const HOLD_MS = 350;
const snap = m => Math.round(m / SNAP) * SNAP;
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
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(null);
  const [editing, setEditing] = useState(null);
  const [drag, setDrag] = useState(null);
  const [listModal, setListModal] = useState(null);
  const [delList, setDelList] = useState(null);

  const innerRef = useRef(null);
  const scrollRef = useRef(null);
  const dateInputRef = useRef(null);

  const lists = useMemo(() => [...taskLists].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)), [taskLists]);
  const listById = useMemo(() => Object.fromEntries(lists.map(l => [l.id, l])), [lists]);
  const matches = (lid) => filter === "all" || (filter === "inbox" ? !lid : lid === filter);

  const dayItems = useMemo(() => itemsForDate(tasks, date).filter(i => matches(i.list_id)), [tasks, date, filter]);
  const timed = dayItems.filter(i => i.start_min !== null && i.start_min !== undefined);
  const untimed = dayItems.filter(i => i.start_min === null || i.start_min === undefined);
  const tray = useMemo(() => unscheduledTasks(tasks).filter(t => matches(t.list_id))
    .sort((a, b) => (a.done - b.done) || (a.sort_order || 0) - (b.sort_order || 0)), [tasks, filter]);

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

  useEffect(() => {
    if (!scrollRef.current) return;
    const now = new Date();
    const target = date === todayISO() ? now.getHours() * 60 + now.getMinutes() : 8 * 60;
    scrollRef.current.scrollTop = Math.max(0, (target / 60) * HOUR_PX - 120);
  }, []);

  const yToMin = (clientY) => ((clientY - innerRef.current.getBoundingClientRect().top) / HOUR_PX) * 60;
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
      setDrag(null);
      if (moved && newStart !== item.start_min) store.actions.tasks.reschedule(item, { start_min: newStart }).catch(showErr);
      else if (!moved) openEdit(item);
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
      setDrag(null);
      if (newDur !== item.duration_min) store.actions.tasks.reschedule(item, { duration_min: newDur }).catch(showErr);
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
  }

  function openEdit(item) {
    const row = item.kind === "concrete" ? tasks.find(t => t.id === item.id) : tasks.find(t => t.id === item.templateId);
    if (row) setEditing({ task: row, occ: item.kind === "occurrence" ? item : null });
  }
  const toggleDone = (item) => store.actions.tasks.toggleDone(item).catch(showErr);
  function quickSchedule(t) {
    const now = new Date();
    const start = date === todayISO() ? clamp(snap(now.getHours() * 60 + now.getMinutes() + 5), 0, 1440 - 60) : 9 * 60;
    store.actions.tasks.update(t.id, { date, start_min: start, duration_min: 60 }).catch(showErr);
  }
  function shiftDay(delta) { const d = fromISO(date); d.setDate(d.getDate() + delta); setDate(toISO(d)); }

  const laidOut = useMemo(() => layoutColumns(timed, drag), [timed, drag]);
  const d = fromISO(date);
  const rel = relLabel(date);
  const dateLabel = (rel ? rel + " · " : "") + `${d.getDate()} ${monthGen(d)}`;
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
          <div class="planner-aside-head"><span>Списки</span>
            <button class="btn-mini" title="Новый список" onClick=${() => setListModal("new")}>${Icon.plus()}</button></div>
          <div class="planner-lists">
            <button class=${"planner-list" + (filter === "all" ? " active" : "")} onClick=${() => setFilter("all")}>
              <span class="planner-list-ico" style="color:var(--accent);">${Icon.calendar()}</span>
              <span class="planner-list-name">Все задачи</span></button>
            <button class=${"planner-list" + (filter === "inbox" ? " active" : "")} onClick=${() => setFilter("inbox")}>
              <span class="planner-list-ico" style="color:#64748b;">${Icon.inbox()}</span>
              <span class="planner-list-name">Входящие</span>
              <span class="planner-list-count">${countOpen(tasks, null)}</span></button>
            ${lists.map(l => html`
              <button class=${"planner-list" + (filter === l.id ? " active" : "")} key=${l.id}
                onClick=${() => setFilter(l.id)} onDblClick=${() => setListModal(l)}>
                <span class="planner-list-ico" style=${`color:${l.color || "var(--accent)"};`}>${Icon.dot()}</span>
                <span class="planner-list-name">${l.name}</span>
                <span class="planner-list-count">${countOpen(tasks, l.id)}</span></button>`)}
          </div>
          <div class="muted small" style="margin-top:auto;padding:8px 6px;">Двойной клик по списку — изменить.</div>
        </aside>

        <div class="planner-content">
          <div class="planner-head">
            <div class="planner-nav">
              <button class="btn-mini" onClick=${() => shiftDay(-7)} title="Прошлая неделя">${Icon.left()}</button>
              <button class="planner-date" onClick=${() => { const el = dateInputRef.current; el?.showPicker ? el.showPicker() : el?.focus(); }}>
                <span class="planner-date-main">${dateLabel}</span>
                <input class="planner-date-input" type="date" ref=${dateInputRef} value=${date}
                  onInput=${e => e.target.value && setDate(e.target.value)} />
              </button>
              <button class="btn-mini" onClick=${() => shiftDay(7)} title="Следующая неделя">${Icon.right()}</button>
            </div>
            <div class="planner-head-actions">
              <button class="btn sm ghost" onClick=${() => setDate(todayISO())}>Сегодня</button>
              <button class="btn primary sm" onClick=${() => setCreating({ date, list_id: filter !== "all" && filter !== "inbox" ? filter : null })}>
                ${Icon.plus()} Задача</button>
            </div>
          </div>

          <div class="planner-week">
            ${week.map(w => html`<button key=${w.iso}
              class=${"wday" + (w.iso === date ? " active" : "") + (w.iso === todayISO() ? " today" : "")}
              onClick=${() => setDate(w.iso)}>
              <span class="wday-num">${w.day}</span><span class="wday-name">${w.short}</span></button>`)}
          </div>

          <div class="planner-body">
            <div class="planner-tray">
              <div class="planner-tray-head">${Icon.inbox()} <span>Без времени</span></div>
              ${tray.length === 0
                ? html`<div class="muted small" style="padding:8px 4px;">Нет задач без времени.</div>`
                : tray.map(t => html`
                  <div class=${"tray-task" + (t.done ? " done" : "")} key=${t.id}>
                    <button class=${"task-check" + (t.done ? " on" : "")} title="Выполнено"
                      style=${t.done ? `background:${listById[t.list_id]?.color || "var(--accent)"};border-color:${listById[t.list_id]?.color || "var(--accent)"};` : ""}
                      onClick=${() => store.actions.tasks.toggleDone({ kind: "concrete", id: t.id, done: t.done }).catch(showErr)}>${Icon.check()}</button>
                    <button class="tray-task-body" onClick=${() => setEditing({ task: t, occ: null })}>
                      <span class="tray-task-title">${t.title}</span>
                      ${t.list_id && html`<span class="tray-task-list" style=${`color:${listById[t.list_id]?.color};`}>${listById[t.list_id]?.name || ""}</span>`}
                    </button>
                    <button class="btn-mini" title="Запланировать на этот день" onClick=${() => quickSchedule(t)}>${Icon.clock()}</button>
                  </div>`)}
              <button class="btn sm ghost" style="margin-top:8px;width:100%;justify-content:center;"
                onClick=${() => setCreating({ list_id: filter !== "all" && filter !== "inbox" ? filter : null })}>
                ${Icon.plus()} Во «Входящие»</button>
            </div>

            <div class="planner-grid-scroll" ref=${scrollRef}>
              ${untimed.length > 0 && html`<div class="planner-untimed">
                ${untimed.map(i => html`<button class=${"untimed-chip" + (i.done ? " done" : "")} key=${i.key}
                  style=${`--c:${colorOf(i)};`} onClick=${() => openEdit(i)}>
                  <span class=${"task-check sm" + (i.done ? " on" : "")}
                    onClick=${e => { e.stopPropagation(); toggleDone(i); }}>${Icon.check()}</span>${i.title}</button>`)}
              </div>`}
              <div class="planner-grid" ref=${innerRef} onPointerDown=${onGridPointerDown} style=${`height:${24 * HOUR_PX}px;`}>
                ${Array.from({ length: 24 }, (_, h) => html`<div class="grid-hour" style=${`top:${h * HOUR_PX}px;`} key=${h}>
                  <span class="grid-hour-label">${String(h).padStart(2, "0")}:00</span></div>`)}
                ${isToday && html`<div class="grid-now" style=${`top:${(nowMin / 60) * HOUR_PX}px;`}>
                  <span class="grid-now-time">${minToHHMM(nowMin)}</span><span class="grid-now-dot"></span></div>`}
                ${laidOut.map(i => {
                  const top = (i._start / 60) * HOUR_PX;
                  const height = Math.max(18, (i._dur / 60) * HOUR_PX);
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
                  style=${`top:${(drag.start / 60) * HOUR_PX}px;height:${(drag.dur / 60) * HOUR_PX}px;left:calc(${GUTTER}px + 2px);width:calc(100% - ${GUTTER}px - 4px);`}>
                  <div class="grid-block-time">${minRangeLabel(drag.start, drag.dur)}</div></div>`}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    ${creating && html`<${TaskForm} defaults=${creating} onClose=${() => setCreating(null)} />`}
    ${editing && html`<${TaskForm} initial=${editing.task} occ=${editing.occ} onClose=${() => setEditing(null)} />`}
    ${listModal && html`<${ListForm} initial=${listModal === "new" ? null : listModal}
      onDelete=${listModal !== "new" ? () => { setDelList(listModal); setListModal(null); } : null}
      onClose=${() => setListModal(null)} />`}
    ${delList && html`<${ConfirmModal} title="Удалить список?"
      message="Задачи из списка переедут во «Входящие», не пропадут."
      onCancel=${() => setDelList(null)}
      onConfirm=${async () => { await store.actions.taskLists.remove(delList.id);
        if (filter === delList.id) setFilter("all"); setDelList(null); store.pushToast("Список удалён", "success"); }} />`}
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
