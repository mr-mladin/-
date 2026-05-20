import { html } from "htm/preact";
import { useState } from "preact/hooks";
import { useStore } from "../lib/store.js";
import { Modal } from "./Modal.js";
import { Icon } from "../lib/icons.js";
import { todayISO } from "../lib/format.js";
import { RECUR_OPTIONS, minToHHMM, hhmmToMin } from "../lib/recurrence.js";

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

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

  function buildPayload() {
    const startMin = hasTime && date ? hhmmToMin(start) : null;
    const recur = date && recurrence ? recurrence : null;
    return {
      title: title.trim(),
      list_id: listId || null,
      date: date || null,
      start_min: startMin,
      duration_min: startMin !== null ? Number(duration) : null,
      recurrence: recur,
      recurrence_until: recur ? (until || null) : null,
      notes: notes.trim() || null,
    };
  }

  async function submit(e) {
    e?.preventDefault();
    setError("");
    if (!title.trim()) { setError("Введите название задачи"); return; }
    setBusy(true);
    try {
      const payload = buildPayload();
      if (editing) await store.actions.tasks.update(initial.id, payload);
      else await store.actions.tasks.create(payload);
      store.pushToast(editing ? "Задача обновлена" : "Задача добавлена", "success");
      onClose();
    } catch (e) {
      setError(dbHint(e.message));
    } finally { setBusy(false); }
  }

  async function deleteOccurrence() {
    setBusy(true);
    try {
      await store.actions.tasks.removeOccurrence(occ);
      store.pushToast("Повторение удалено", "success");
      onClose();
    } catch (e) { setError(dbHint(e.message)); }
    finally { setBusy(false); }
  }

  async function deleteAll() {
    setBusy(true);
    try {
      if (isSeries) await store.actions.tasks.removeSeries(initial.id);
      else await store.actions.tasks.remove(initial.id);
      store.pushToast("Задача удалена", "success");
      onClose();
    } catch (e) { setError(dbHint(e.message)); }
    finally { setBusy(false); }
  }

  const listColor = lists.find(l => l.id === listId)?.color;

  return html`
    <${Modal} title=${editing ? "Задача" : "Новая задача"} onClose=${onClose}
      footer=${html`
        <button class="btn ghost" onClick=${onClose}>Отмена</button>
        <button class="btn primary" disabled=${busy} onClick=${submit}>${busy ? "Сохранение…" : "Сохранить"}</button>
      `}
    >
      <form onSubmit=${submit} style="display:flex;flex-direction:column;gap:14px;">
        <div class="field">
          <label>Название</label>
          <input class="input" placeholder="Что нужно сделать" autofocus
            value=${title} onInput=${e => setTitle(e.target.value)} />
        </div>

        <div class="field">
          <label>Список</label>
          <select class="select" value=${listId} onChange=${e => setListId(e.target.value)}>
            <option value="">Входящие</option>
            ${lists.map(l => html`<option value=${l.id} key=${l.id}>${l.name}</option>`)}
          </select>
          ${listColor && html`<div class="muted" style="font-size:12px;margin-top:4px;display:flex;align-items:center;gap:6px;">
            <span style=${`width:10px;height:10px;border-radius:50%;background:${listColor};display:inline-block;`}></span>
            Цвет блока в календаре
          </div>`}
        </div>

        <div class="field">
          <label>Дата</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input class="input" type="date" value=${date} onInput=${e => setDate(e.target.value)} style="flex:1;" />
            ${date
              ? html`<button type="button" class="btn sm ghost" onClick=${() => { setDate(""); setRecurrence(""); }}>Без даты</button>`
              : html`<button type="button" class="btn sm" onClick=${() => setDate(todayISO())}>Сегодня</button>`}
          </div>
          ${!date && html`<div class="muted" style="font-size:12px;margin-top:4px;">Без даты задача попадёт во «Входящие».</div>`}
        </div>

        ${date && html`
          <div class="field">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" checked=${hasTime} onChange=${e => setHasTime(e.target.checked)} />
              Указать время
            </label>
          </div>
          ${hasTime && html`
            <div style="display:flex;gap:12px;flex-wrap:wrap;">
              <div class="field" style="flex:1;min-width:120px;">
                <label>Начало</label>
                <input class="input" type="time" value=${start} onInput=${e => setStart(e.target.value)} />
              </div>
              <div class="field" style="flex:1;min-width:120px;">
                <label>Длительность</label>
                <select class="select" value=${String(duration)} onChange=${e => setDuration(Number(e.target.value))}>
                  ${DURATIONS.map(d => html`<option value=${String(d)} key=${d}>${durLabel(d)}</option>`)}
                </select>
                <div class="muted" style="font-size:12px;margin-top:4px;">
                  до ${minToHHMM(hhmmToMin(start) + Number(duration))}
                </div>
              </div>
            </div>
          `}

          <div class="field">
            <label>Повтор</label>
            <select class="select" value=${recurrence} onChange=${e => setRecurrence(e.target.value)}>
              ${RECUR_OPTIONS.map(o => html`<option value=${o.value} key=${o.value}>${o.label}</option>`)}
            </select>
            ${recurrence && html`
              <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
                <span class="muted" style="font-size:13px;">до даты:</span>
                <input class="input" type="date" value=${until} onInput=${e => setUntil(e.target.value)} style="flex:1;" />
                ${until && html`<button type="button" class="btn sm ghost" onClick=${() => setUntil("")}>Без конца</button>`}
              </div>
            `}
          </div>
        `}

        <div class="field">
          <label>Заметка</label>
          <textarea class="input" rows="2" placeholder="Необязательно"
            value=${notes} onInput=${e => setNotes(e.target.value)}></textarea>
        </div>

        ${error && html`<div class="notice error">${error}</div>`}

        ${editing && !confirmDel && html`
          <button type="button" class="btn ghost danger" style="align-self:flex-start;"
            onClick=${() => setConfirmDel(true)}>${Icon.trash()} Удалить</button>
        `}
        ${editing && confirmDel && html`
          <div class="notice" style="display:flex;flex-direction:column;gap:8px;">
            <span>${isSeries ? "Удалить повторяющуюся задачу?" : "Удалить задачу?"}</span>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${occ && html`<button type="button" class="btn sm danger" disabled=${busy} onClick=${deleteOccurrence}>Только это повторение</button>`}
              <button type="button" class="btn sm danger" disabled=${busy} onClick=${deleteAll}>${isSeries ? "Весь ряд" : "Удалить"}</button>
              <button type="button" class="btn sm ghost" onClick=${() => setConfirmDel(false)}>Отмена</button>
            </div>
          </div>
        `}
      </form>
    <//>
  `;
}

function durLabel(min) {
  if (min < 60) return min + " мин";
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

function dbHint(msg) {
  if (msg && /relation .* does not exist|table|schema cache/i.test(msg)) {
    return "Таблицы планера ещё не созданы в базе. Создайте их по инструкции, затем обновите страницу.";
  }
  return msg;
}
