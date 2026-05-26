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

// Встроенный редактор задачи (вместо модальной формы). Рендерит карточку без
// собственного позиционирования — обёртку/место задаёт родитель (в сетке дня
// карточка «прирастает» к задаче, в боковой панели раскрывается на месте).
// Иерархия: Название → Заметки → Подзадачи → Проект → Начало → Конец → Повтор.
export function TaskEditor({ initial, defaults, occ, onClose }) {
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
  const [subtasks, setSubtasks] = useState(Array.isArray(src.subtasks) ? src.subtasks.map(s => ({ ...s })) : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notesOpen, setNotesOpen] = useState(!!(src.notes && src.notes.trim()));
  const [subOpen, setSubOpen] = useState(false);
  const [projOpen, setProjOpen] = useState(false);
  const [repOpen, setRepOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const lists = [...taskLists].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const list = lists.find(l => l.id === listId);
  const dotColor = list?.color || "var(--text-mute)";
  const subDone = subtasks.filter(s => s.done).length;

  const cardRef = useRef(null);
  const titleRef = useRef(null);
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    // Клик вне карточки — закрыть (без сохранения изменений-черновика).
    const onDown = e => { if (cardRef.current && !cardRef.current.contains(e.target)) onClose?.(); };
    setTimeout(() => document.addEventListener("pointerdown", onDown), 0);
    if (!editing) setTimeout(() => titleRef.current?.focus(), 30);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [onClose, editing]);

  function changeDate(v) { setDate(v); if (!endDate || endDate < v) setEndDate(v); if (!v) { setStartTime(""); setRecurrence(""); } }
  function changeStart(v) { setStartTime(v); if (v && !endTime) { setEndTime(minToHHMM(hhmmToMin(v) + 60)); if (!endDate) setEndDate(date); } }

  // ---- Подзадачи ----
  const newSub = () => ({ id: "s-" + Math.random().toString(36).slice(2), title: "", done: false });
  function addSub() { setSubtasks(p => [...p, newSub()]); setSubOpen(true); }
  function setSub(id, patch) { setSubtasks(p => p.map(s => s.id === id ? { ...s, ...patch } : s)); }
  function delSub(id) { setSubtasks(p => p.filter(s => s.id !== id)); }

  function payload() {
    const cleanSubs = subtasks.map(s => ({ id: s.id, title: (s.title || "").trim(), done: !!s.done })).filter(s => s.title);
    if (!date) return { title: title.trim(), list_id: listId || null, date: null, start_min: null, duration_min: null, recurrence: null, recurrence_until: null, notes: notes.trim() || null, subtasks: cleanSubs };
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
      notes: notes.trim() || null, subtasks: cleanSubs,
    };
  }
  async function save() {
    if (!title.trim()) { setError("Введите название задачи"); titleRef.current?.focus(); return; }
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

  const recurLabel = (RECUR_OPTIONS.find(o => o.value === recurrence) || RECUR_OPTIONS[0]).label;

  return html`
    <div class="ed-card" ref=${cardRef} onPointerDown=${e => e.stopPropagation()}>
      <div class="ed-top">
        <button class="ed-cancel" type="button" title="Отмена" aria-label="Отмена" onClick=${onClose}>${Icon.close()}</button>
        <button class="ed-save" type="button" title="Сохранить" aria-label="Сохранить" disabled=${busy} onClick=${save}>${Icon.check()}</button>
      </div>

      ${error && html`<div class="ed-error">${error}</div>`}

      <input class="ed-title" ref=${titleRef} placeholder="Название задачи"
        value=${title} onInput=${e => setTitle(e.target.value)}
        onKeyDown=${e => { if (e.key === "Enter") { e.preventDefault(); save(); } }} />

      ${notesOpen
        ? html`<textarea class="ed-notes" rows="2" placeholder="Заметка" autofocus
            value=${notes} onInput=${e => setNotes(e.target.value)}></textarea>`
        : html`<button class="ed-add" type="button" onClick=${() => setNotesOpen(true)}>${Icon.note()} Заметка</button>`}

      <div class="ed-sub">
        ${subtasks.length === 0
          ? html`<button class="ed-add" type="button" onClick=${addSub}>${Icon.check()} Добавить подзадачу</button>`
          : html`
            <button class=${"ed-sub-chip" + (subOpen ? " open" : "")} type="button" onClick=${() => setSubOpen(o => !o)}>
              <span class="ed-sub-badge">${Icon.check()}</span>
              <span>${subDone}/${subtasks.length}</span>
              <span class="ed-chev">${Icon.right()}</span>
            </button>`}
        ${subOpen && subtasks.length > 0 && html`
          <div class="ed-sub-list">
            ${subtasks.map(s => html`
              <div class=${"ed-sub-item" + (s.done ? " done" : "")} key=${s.id}>
                <button class=${"task-check sm" + (s.done ? " on" : "")} type="button"
                  style=${s.done ? `background:${dotColor};border-color:${dotColor};` : ""}
                  onClick=${() => setSub(s.id, { done: !s.done })}>${Icon.check()}</button>
                <input class="ed-sub-input" placeholder="Подзадача" value=${s.title}
                  onInput=${e => setSub(s.id, { title: e.target.value })}
                  onKeyDown=${e => { if (e.key === "Enter") { e.preventDefault(); addSub(); } }} />
                <button class="ed-sub-del" type="button" title="Убрать" onClick=${() => delSub(s.id)}>${Icon.close()}</button>
              </div>`)}
            <button class="ed-add sm" type="button" onClick=${addSub}>${Icon.plus()} Ещё подзадача</button>
          </div>`}
      </div>

      <div class="ed-field">
        <button class="ed-proj" type="button" onClick=${() => setProjOpen(o => !o)}>
          <span class="ed-dot" style=${`background:${dotColor};`}></span>
          <span class="ed-proj-name">${list ? list.name : "Входящие"}</span>
        </button>
        ${projOpen && html`
          <div class="ed-menu">
            <button class=${"ed-menu-item" + (!listId ? " sel" : "")} type="button"
              onClick=${() => { setListId(""); setProjOpen(false); }}>
              <span class="ed-dot" style="background:var(--text-mute);"></span> Входящие</button>
            ${lists.map(l => html`<button class=${"ed-menu-item" + (listId === l.id ? " sel" : "")} type="button" key=${l.id}
              onClick=${() => { setListId(l.id); setProjOpen(false); }}>
              <span class="ed-dot" style=${`background:${l.color};`}></span> ${l.name}</button>`)}
          </div>`}
      </div>

      ${date ? html`
        <div class="ed-dt"><span class="ed-dt-label">Начало</span>
          <input class="ed-input dt-date" type="date" value=${date} onInput=${e => changeDate(e.target.value)} />
          <input class="ed-input dt-time" type="time" value=${startTime} onInput=${e => changeStart(e.target.value)} />
          <button class="ed-dt-clear" type="button" title="Без даты" onClick=${() => changeDate("")}>${Icon.close()}</button>
        </div>
        ${startTime ? html`
          <div class="ed-dt"><span class="ed-dt-label">Конец</span>
            <input class="ed-input dt-date" type="date" value=${endDate} min=${date} onInput=${e => setEndDate(e.target.value)} />
            <input class="ed-input dt-time" type="time" value=${endTime} onInput=${e => setEndTime(e.target.value)} />
          </div>` : ""}`
        : html`<button class="ed-add" type="button" onClick=${() => changeDate(todayISO())}>${Icon.calendar()} Назначить дату</button>`}

      ${date && html`
        <div class="ed-field">
          <button class="ed-proj" type="button" onClick=${() => setRepOpen(o => !o)}>
            <span class="ed-rep-ico">${Icon.repeat()}</span>
            <span class="ed-proj-name">${recurLabel}</span>
          </button>
          ${repOpen && html`
            <div class="ed-menu">
              ${RECUR_OPTIONS.map(o => html`<button class=${"ed-menu-item" + (recurrence === o.value ? " sel" : "")} type="button" key=${o.value}
                onClick=${() => { setRecurrence(o.value); setRepOpen(false); }}>${o.label}</button>`)}
            </div>`}
          ${recurrence && html`<div class="ed-until">
            <span>до</span>
            <input class="ed-input dt-date" type="date" value=${until} onInput=${e => setUntil(e.target.value)} />
            ${until && html`<button class="ed-dt-clear" type="button" onClick=${() => setUntil("")}>${Icon.close()}</button>`}
          </div>`}
        </div>`}

      ${editing && !confirmDel && html`
        <button class="ed-del" type="button" onClick=${() => setConfirmDel(true)}>${Icon.trash()} Удалить задачу</button>`}
      ${editing && confirmDel && html`
        <div class="ed-confirm">
          <span>${isSeries ? "Удалить повторяющуюся задачу?" : "Удалить задачу?"}</span>
          <div class="ed-confirm-row">
            ${occ && html`<button class="btn sm danger" type="button" disabled=${busy}
              onClick=${() => run(() => store.actions.tasks.removeOccurrence(occ), "Повторение удалено")}>Только это повторение</button>`}
            <button class="btn sm danger" type="button" disabled=${busy}
              onClick=${() => run(() => isSeries ? store.actions.tasks.removeSeries(initial.id) : store.actions.tasks.remove(initial.id), "Задача удалена")}>
              ${isSeries ? "Весь ряд" : "Удалить"}</button>
            <button class="btn sm ghost" type="button" onClick=${() => setConfirmDel(false)}>Отмена</button>
          </div>
        </div>`}
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
