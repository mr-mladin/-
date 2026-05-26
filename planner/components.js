import { html } from "htm/preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { useStore } from "./store.js";
import { Icon, todayISO, toISO, fromISO, RECUR_OPTIONS } from "./lib.js";
import { minToHHMM, hhmmToMin } from "./lib.js";

const addDaysISO = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const daysBetweenISO = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 86400000);

export const COLORS = ["#0ea5e9", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#64748b"];

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

export function SettingsModal({ onClose }) {
  const store = useStore();
  const THEMES = [["auto", "Авто"], ["light", "Светлая"], ["dark", "Тёмная"]];
  return html`<${Modal} title="Настройки" onClose=${onClose}>
    <div class="set-section">
      <div class="set-label">Тема оформления</div>
      <div class="seg set-seg">
        ${THEMES.map(([v, l]) => html`<button key=${v} class=${"seg-btn" + (store.theme === v ? " on" : "")}
          onClick=${() => store.setTheme(v)}>${l}</button>`)}
      </div>
    </div>
    <div class="set-section">
      <div class="set-label">Учётная запись</div>
      <div class="set-email">${store.user?.email || ""}</div>
      <button class="btn ghost set-signout" onClick=${() => store.auth.signOut()}>${Icon.signout()} Выйти</button>
    </div>
  <//>`;
}

export function SearchModal({ onClose, onPick }) {
  const store = useStore();
  const [q, setQ] = useState("");
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = e => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const lists = store.taskLists;
  const listById = Object.fromEntries(lists.map(l => [l.id, l]));
  const term = q.trim().toLowerCase();
  const results = term
    ? store.tasks.filter(t => !t.recurrence_parent && (t.title || "").toLowerCase().includes(term))
        .sort((a, b) => (a.done - b.done)).slice(0, 60)
    : [];
  return html`
    <div class="modal-back search-back" onPointerDown=${e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div class="search-box" role="dialog">
        <div class="search-head">
          <span class="search-ico">${Icon.search()}</span>
          <input class="search-input" ref=${inputRef} placeholder="Поиск по задачам…"
            value=${q} onInput=${e => setQ(e.target.value)} />
          <button class="btn-mini" title="Закрыть" onClick=${onClose}>${Icon.close()}</button>
        </div>
        ${term && html`<div class="search-results">
          ${results.length === 0
            ? html`<div class="search-empty">Ничего не найдено</div>`
            : results.map(t => html`<button class=${"search-item" + (t.done ? " done" : "")} key=${t.id}
                onClick=${() => onPick?.(t)}>
                <span class=${"task-check sm" + (t.done ? " on" : "")}>${Icon.check()}</span>
                <span class="search-item-title">${t.title}</span>
                <span class="search-item-meta" style=${t.list_id ? `color:${listById[t.list_id]?.color};` : ""}>
                  ${t.list_id ? (listById[t.list_id]?.name || "") : "Входящие"}</span>
              </button>`)}
        </div>`}
      </div>
    </div>`;
}

export function Toasts() {
  const { toasts } = useStore();
  return html`<div class="toasts">
    ${toasts.map(t => html`<div class=${"toast " + t.type} key=${t.id}>${t.text}</div>`)}
  </div>`;
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

  const _hasStart = src.start_min !== null && src.start_min !== undefined;
  const _end = _hasStart ? src.start_min + (src.duration_min || 0) : null;
  const [title, setTitle] = useState(src.title || "");
  const [listId, setListId] = useState(src.list_id || "");
  const [date, setDate] = useState(src.date || "");
  const [startTime, setStartTime] = useState(_hasStart ? minToHHMM(src.start_min) : "");
  const [endDate, setEndDate] = useState(src.date && _end != null ? addDaysISO(src.date, Math.floor(_end / 1440)) : (src.date || ""));
  const [endTime, setEndTime] = useState(_end != null ? minToHHMM(_end % 1440) : "");
  const [recurrence, setRecurrence] = useState(src.recurrence || "");
  const [until, setUntil] = useState(src.recurrence_until || "");
  const [notes, setNotes] = useState(src.notes || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  const lists = [...taskLists].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const listColor = lists.find(l => l.id === listId)?.color;

  const sheetRef = useRef(null);
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  // Потянуть «ручку» вниз — закрыть форму (вместо кнопки «Отмена»). Шторка едет
  // за пальцем, после порога — закрывается, иначе возвращается на место.
  function onHandleDown(e) {
    const el = sheetRef.current; if (!el) return;
    const sy = e.clientY; let dy = 0;
    const move = ev => { dy = Math.max(0, ev.clientY - sy); el.style.transition = "none"; el.style.transform = `translateY(${dy}px)`; };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      if (dy > 110) { el.style.transition = "transform .2s ease-in"; el.style.transform = "translateY(100%)"; setTimeout(() => onClose(), 170); }
      else { el.style.transition = "transform .25s cubic-bezier(.2,.7,.3,1)"; el.style.transform = "translateY(0)"; }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  function changeDate(v) { setDate(v); if (!endDate || endDate < v) setEndDate(v); if (!v) { setStartTime(""); setRecurrence(""); } }
  function changeStart(v) { setStartTime(v); if (v && !endTime) { setEndTime(minToHHMM(hhmmToMin(v) + 60)); if (!endDate) setEndDate(date); } }

  function payload() {
    if (!date) return { title: title.trim(), list_id: listId || null, date: null, start_min: null, duration_min: null, recurrence: null, recurrence_until: null, notes: notes.trim() || null };
    const startMin = startTime ? hhmmToMin(startTime) : null;
    let duration = null;
    if (startMin !== null) {
      if (endTime) {
        duration = daysBetweenISO(date, endDate || date) * 1440 + hhmmToMin(endTime) - startMin;
        if (duration <= 0) duration = 60; // конец не позже начала — час по умолчанию
      } else duration = 60;
    }
    const recur = recurrence ? recurrence : null;
    return {
      title: title.trim(), list_id: listId || null, date,
      start_min: startMin, duration_min: startMin !== null ? duration : null,
      recurrence: recur, recurrence_until: recur ? (until || null) : null,
      notes: notes.trim() || null,
    };
  }
  async function submit(e) {
    e?.preventDefault();
    if (!title.trim()) { setError("Введите название задачи"); store.pushToast("Введите название задачи", "error"); return; }
    setBusy(true);
    try {
      if (editing) await store.actions.tasks.update(initial.id, payload());
      else await store.actions.tasks.create(payload());
      store.pushToast(editing ? "Задача обновлена" : "Задача добавлена", "success");
      onClose();
    } catch (e) { const m = dbHint(e.message); setError(m); store.pushToast(m, "error"); } finally { setBusy(false); }
  }
  async function run(fn, msg) {
    setBusy(true);
    try { await fn(); store.pushToast(msg, "success"); onClose(); }
    catch (e) { const m = dbHint(e.message); setError(m); store.pushToast(m, "error"); } finally { setBusy(false); }
  }

  return html`
    <div class="sheet-back" onPointerDown=${e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="sheet" ref=${sheetRef}>
        <div class="sheet-handle" onPointerDown=${onHandleDown}><span></span></div>
        <div class="sheet-title">${editing ? "Задача" : "Новая задача"}</div>
        <div class="sheet-body">
          <form onSubmit=${submit} class="form">
        ${error && html`<div class="notice error">${error}</div>`}
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

        <div class="field"><label>Начало</label>
          <div class="dt-row">
            <input class="input dt-date" type="date" value=${date} onInput=${e => changeDate(e.target.value)} />
            ${date ? html`<input class="input dt-time" type="time" value=${startTime} onInput=${e => changeStart(e.target.value)} />` : ""}
          </div>
          ${date
            ? html`<button type="button" class="btn sm ghost dt-clear" onClick=${() => changeDate("")}>Без даты</button>`
            : html`<div class="dt-note"><button type="button" class="btn sm" onClick=${() => changeDate(todayISO())}>Сегодня</button><span class="muted small">без даты — попадёт во «Входящие»</span></div>`}
        </div>

        ${date && startTime && html`
          <div class="field"><label>Конец</label>
            <div class="dt-row">
              <input class="input dt-date" type="date" value=${endDate} min=${date} onInput=${e => setEndDate(e.target.value)} />
              <input class="input dt-time" type="time" value=${endTime} onInput=${e => setEndTime(e.target.value)} />
            </div>
          </div>`}

        ${date && html`
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
        </div>
        <button class="sheet-save" type="button" disabled=${busy} onClick=${submit}
          title="Сохранить" aria-label="Сохранить">${Icon.arrowUp()}</button>
      </div>
    </div>`;
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
