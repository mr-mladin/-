import { html } from "htm/preact";
import { useState, useEffect } from "preact/hooks";
import { useStore } from "./store.js";
import { Icon, todayISO, fromISO, minRangeLabel, weekdayFull, monthGen, RECUR_OPTIONS } from "./lib.js";
import { minToHHMM, hhmmToMin } from "./lib.js";

export const COLORS = ["#0ea5e9", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#64748b"];
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    // Блокируем прокрутку фона. Ширина страницы не меняется — место под полосу
    // прокрутки всегда зарезервировано через scrollbar-gutter (см. styles.css).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);
  return html`
    <div class="modal-back" onClick=${e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div class="modal" role="dialog">
        <div class="modal-head"><h3>${title}</h3>
          <button class="btn-mini" onClick=${onClose} aria-label="Закрыть">${Icon.close()}</button></div>
        <div class="modal-body">${children}</div>
        ${footer && html`<div class="modal-foot">${footer}</div>`}
      </div>
    </div>`;
}

export function ConfirmModal({ title, message, onCancel, onConfirm }) {
  return html`<${Modal} title=${title} onClose=${onCancel}
    footer=${html`
      <button class="btn ghost" onClick=${onCancel}>Отмена</button>
      <button class="btn danger" onClick=${onConfirm}>Удалить</button>`}>
    <div>${message}</div>
  <//>`;
}

export function Toasts() {
  const { toasts } = useStore();
  return html`<div class="toasts">
    ${toasts.map(t => html`<div class=${"toast " + t.type} key=${t.id}>${t.text}</div>`)}
  </div>`;
}

export function EventCard({ item, listName, color, onClose, onEdit, onToggleDone, onDelete }) {
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const d = item.occDate ? fromISO(item.occDate) : null;
  const dateLabel = d ? `${weekdayFull(d)}, ${d.getDate()} ${monthGen(d)}` : "";
  const timed = item.start_min !== null && item.start_min !== undefined;
  return html`
    <div class="modal-back" onClick=${e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div class="event-card" role="dialog" style=${`--c:${color};`}>
        <div class="event-card-head">
          <span class="event-card-bar"></span>
          <h3 class=${item.done ? "done" : ""}>${item.title}</h3>
          <button class="btn-mini" onClick=${onClose} aria-label="Закрыть">${Icon.close()}</button>
        </div>
        <div class="event-card-rows">
          ${dateLabel && html`<div class="event-card-row">${Icon.calendar()}<span>${dateLabel}</span></div>`}
          <div class="event-card-row">${Icon.clock()}<span>${timed ? minRangeLabel(item.start_min, item.duration_min) : "Без времени"}</span></div>
          ${item.recurring && html`<div class="event-card-row">${Icon.repeat()}<span>Повторяется</span></div>`}
          <div class="event-card-row">${Icon.dot()}<span>${listName || "Входящие"}</span></div>
          ${item.notes && html`<div class="event-card-row note">${Icon.note()}<span>${item.notes}</span></div>`}
        </div>
        <div class="event-card-actions">
          <button class=${"btn sm" + (item.done ? " ghost" : " primary")} onClick=${onToggleDone}>
            ${Icon.check()} ${item.done ? "Снять отметку" : "Готово"}</button>
          <button class="btn sm" onClick=${onEdit}>${Icon.edit()} Изменить</button>
          <button class="btn sm danger" onClick=${onDelete}>${Icon.trash()} Удалить</button>
        </div>
      </div>
    </div>`;
}

function durLabel(min) {
  if (min < 60) return min + " мин";
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}
function dbHint(msg) {
  if (msg && /relation|table|schema cache|does not exist/i.test(msg))
    return "Таблицы планера ещё не созданы в базе. Создайте их по инструкции и обновите страницу.";
  return msg;
}

export function TaskForm({ initial, defaults, occ, onClose }) {
  const store = useStore();
  const { taskLists } = store;
  const editing = !!initial;
  const isSeries = !!(initial && initial.recurrence);
  const src = initial || defaults || {};

  const [title, setTitle] = useState(src.title || "");
  const [listId, setListId] = useState(src.list_id || "");
  const [date, setDate] = useState(src.date || "");
  const [hasTime, setHasTime] = useState(src.start_min !== null && src.start_min !== undefined);
  const [start, setStart] = useState(minToHHMM(src.start_min ?? 9 * 60));
  const [duration, setDuration] = useState(src.duration_min || 60);
  const [recurrence, setRecurrence] = useState(src.recurrence || "");
  const [until, setUntil] = useState(src.recurrence_until || "");
  const [notes, setNotes] = useState(src.notes || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  const lists = [...taskLists].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const listColor = lists.find(l => l.id === listId)?.color;

  function payload() {
    const startMin = hasTime && date ? hhmmToMin(start) : null;
    const recur = date && recurrence ? recurrence : null;
    return {
      title: title.trim(), list_id: listId || null, date: date || null,
      start_min: startMin, duration_min: startMin !== null ? Number(duration) : null,
      recurrence: recur, recurrence_until: recur ? (until || null) : null,
      notes: notes.trim() || null,
    };
  }
  async function submit(e) {
    e?.preventDefault();
    if (!title.trim()) { setError("Введите название задачи"); return; }
    setBusy(true);
    try {
      if (editing) await store.actions.tasks.update(initial.id, payload());
      else await store.actions.tasks.create(payload());
      store.pushToast(editing ? "Задача обновлена" : "Задача добавлена", "success");
      onClose();
    } catch (e) { setError(dbHint(e.message)); } finally { setBusy(false); }
  }
  async function run(fn, msg) {
    setBusy(true);
    try { await fn(); store.pushToast(msg, "success"); onClose(); }
    catch (e) { setError(dbHint(e.message)); } finally { setBusy(false); }
  }

  return html`
    <${Modal} title=${editing ? "Задача" : "Новая задача"} onClose=${onClose}
      footer=${html`
        <button class="btn ghost" onClick=${onClose}>Отмена</button>
        <button class="btn primary" disabled=${busy} onClick=${submit}>${busy ? "Сохранение…" : "Сохранить"}</button>`}>
      <form onSubmit=${submit} class="form">
        <div class="field"><label>Название</label>
          <input class="input" placeholder="Что нужно сделать" autofocus
            value=${title} onInput=${e => setTitle(e.target.value)} /></div>

        <div class="field"><label>Список</label>
          <select class="select" value=${listId} onChange=${e => setListId(e.target.value)}>
            <option value="">Входящие</option>
            ${lists.map(l => html`<option value=${l.id} key=${l.id}>${l.name}</option>`)}
          </select>
          ${listColor && html`<div class="muted small" style="margin-top:4px;display:flex;align-items:center;gap:6px;">
            <span style=${`width:10px;height:10px;border-radius:50%;background:${listColor};display:inline-block;`}></span>
            Цвет блока в календаре</div>`}
        </div>

        <div class="field"><label>Дата</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input class="input" type="date" value=${date} onInput=${e => setDate(e.target.value)} style="flex:1;" />
            ${date
              ? html`<button type="button" class="btn sm ghost" onClick=${() => { setDate(""); setRecurrence(""); }}>Без даты</button>`
              : html`<button type="button" class="btn sm" onClick=${() => setDate(todayISO())}>Сегодня</button>`}
          </div>
          ${!date && html`<div class="muted small" style="margin-top:4px;">Без даты задача попадёт во «Входящие».</div>`}
        </div>

        ${date && html`
          <label class="field" style="flex-direction:row;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" checked=${hasTime} onChange=${e => setHasTime(e.target.checked)} /> Указать время
          </label>
          ${hasTime && html`
            <div style="display:flex;gap:12px;flex-wrap:wrap;">
              <div class="field" style="flex:1;min-width:120px;"><label>Начало</label>
                <input class="input" type="time" value=${start} onInput=${e => setStart(e.target.value)} /></div>
              <div class="field" style="flex:1;min-width:120px;"><label>Длительность</label>
                <select class="select" value=${String(duration)} onChange=${e => setDuration(Number(e.target.value))}>
                  ${DURATIONS.map(d => html`<option value=${String(d)} key=${d}>${durLabel(d)}</option>`)}
                </select>
                <div class="muted small" style="margin-top:4px;">до ${minToHHMM(hhmmToMin(start) + Number(duration))}</div>
              </div>
            </div>`}
          <div class="field"><label>Повтор</label>
            <select class="select" value=${recurrence} onChange=${e => setRecurrence(e.target.value)}>
              ${RECUR_OPTIONS.map(o => html`<option value=${o.value} key=${o.value}>${o.label}</option>`)}
            </select>
            ${recurrence && html`<div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
              <span class="muted small">до даты:</span>
              <input class="input" type="date" value=${until} onInput=${e => setUntil(e.target.value)} style="flex:1;" />
              ${until && html`<button type="button" class="btn sm ghost" onClick=${() => setUntil("")}>Без конца</button>`}
            </div>`}
          </div>`}

        <div class="field"><label>Заметка</label>
          <textarea class="input" rows="2" value=${notes} onInput=${e => setNotes(e.target.value)}></textarea></div>

        ${error && html`<div class="notice error">${error}</div>`}

        ${editing && !confirmDel && html`
          <button type="button" class="btn ghost danger" style="align-self:flex-start;"
            onClick=${() => setConfirmDel(true)}>${Icon.trash()} Удалить</button>`}
        ${editing && confirmDel && html`
          <div class="notice" style="display:flex;flex-direction:column;gap:8px;">
            <span>${isSeries ? "Удалить повторяющуюся задачу?" : "Удалить задачу?"}</span>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${occ && html`<button type="button" class="btn sm danger" disabled=${busy}
                onClick=${() => run(() => store.actions.tasks.removeOccurrence(occ), "Повторение удалено")}>Только это повторение</button>`}
              <button type="button" class="btn sm danger" disabled=${busy}
                onClick=${() => run(() => isSeries ? store.actions.tasks.removeSeries(initial.id) : store.actions.tasks.remove(initial.id), "Задача удалена")}>
                ${isSeries ? "Весь ряд" : "Удалить"}</button>
              <button type="button" class="btn sm ghost" onClick=${() => setConfirmDel(false)}>Отмена</button>
            </div>
          </div>`}
      </form>
    <//>`;
}

export function ListForm({ initial, onDelete, onClose }) {
  const store = useStore();
  const editing = !!initial;
  const [name, setName] = useState(initial?.name || "");
  const [color, setColor] = useState(initial?.color || COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e) {
    e?.preventDefault();
    if (!name.trim()) { setError("Введите название списка"); return; }
    setBusy(true);
    try {
      if (editing) await store.actions.taskLists.update(initial.id, { name: name.trim(), color });
      else await store.actions.taskLists.create({ name: name.trim(), color });
      onClose();
    } catch (e) { setError(dbHint(e.message)); } finally { setBusy(false); }
  }
  return html`
    <${Modal} title=${editing ? "Проект" : "Новый проект"} onClose=${onClose}
      footer=${html`
        <button class="btn ghost" onClick=${onClose}>Отмена</button>
        <button class="btn primary" disabled=${busy} onClick=${submit}>Сохранить</button>`}>
      <form onSubmit=${submit} class="form">
        <div class="field"><label>Название</label>
          <input class="input" autofocus placeholder="Например: Работа" value=${name} onInput=${e => setName(e.target.value)} /></div>
        <div class="field"><label>Цвет</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${COLORS.map(c => html`<button type="button" key=${c} onClick=${() => setColor(c)}
              style=${`width:28px;height:28px;border-radius:50%;border:2px solid ${color === c ? "var(--text)" : "transparent"};background:${c};cursor:pointer;`}></button>`)}
          </div></div>
        ${error && html`<div class="notice error">${error}</div>`}
        ${editing && onDelete && html`<button type="button" class="btn ghost danger" style="align-self:flex-start;"
          onClick=${onDelete}>${Icon.trash()} Удалить проект</button>`}
      </form>
    <//>`;
}

export function AuthForm() {
  const store = useStore();
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setError(""); setMsg(""); setBusy(true);
    try {
      if (mode === "signin") await store.auth.signIn(email.trim(), password);
      else { await store.auth.signUp(email.trim(), password); setMsg("Проверьте почту для подтверждения, затем войдите."); }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return html`
    <div class="auth">
      <div class="auth-card">
        <div class="auth-logo">${Icon.calendar()}</div>
        <h1>Планер</h1>
        <p class="muted">${mode === "signin" ? "Вход в планер" : "Регистрация"}</p>
        <form onSubmit=${submit} class="form" style="margin-top:16px;">
          <div class="field"><label>Эл. почта</label>
            <input class="input" type="email" value=${email} onInput=${e => setEmail(e.target.value)} required /></div>
          <div class="field"><label>Пароль</label>
            <input class="input" type="password" value=${password} onInput=${e => setPassword(e.target.value)} required /></div>
          ${error && html`<div class="notice error">${error}</div>`}
          ${msg && html`<div class="notice">${msg}</div>`}
          <button class="btn primary" disabled=${busy} type="submit">
            ${busy ? "…" : mode === "signin" ? "Войти" : "Зарегистрироваться"}</button>
        </form>
        <button class="btn ghost sm" style="margin-top:10px;"
          onClick=${() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setMsg(""); }}>
          ${mode === "signin" ? "Создать аккаунт" : "У меня уже есть аккаунт"}</button>
        <p class="muted small" style="margin-top:14px;">Вход общий с приложением «Финансы».</p>
      </div>
    </div>`;
}
