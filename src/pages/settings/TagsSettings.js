import { html } from "htm/preact";
import { useState, useMemo } from "preact/hooks";
import { useStore } from "../../lib/store.js";
import { Icon } from "../../lib/icons.js";
import { Modal, ConfirmModal } from "../../components/Modal.js";

export function TagsSettings() {
  const store = useStore();
  const { tags } = store;
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const sorted = useMemo(() =>
    [...tags].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [tags]);

  return html`
    <div class="card">
      <div class="section-head" style="padding:16px 18px 8px;">
        <h2>Теги</h2>
        <button class="btn primary sm" onClick=${() => setEditing("new")}>${Icon.plus()} Новый тег</button>
      </div>
      ${sorted.length === 0
        ? html`<div class="empty">
            <div class="em-title">Тегов пока нет</div>
            Тегами удобно помечать что-то поперёк категорий: «командировка», «отпуск», «здоровье».<br/><br/>
            <button class="btn primary" onClick=${() => setEditing("new")}>${Icon.plus()} Создать тег</button>
          </div>`
        : html`
          <div class="list">
            ${sorted.map((t, i) => html`
              <div class="list-row" key=${t.id}>
                <span class="lr-icon" style="background:var(--accent-soft);color:var(--accent);">${Icon.tag()}</span>
                <div class="lr-main"><div class="lr-title">${t.name}</div></div>
                <div class="row-actions">
                  <button class="btn-mini" title="Выше"
                    onClick=${() => store.tags.move(t.id, -1)}
                    disabled=${i <= 0}>${Icon.up()}</button>
                  <button class="btn-mini" title="Ниже"
                    onClick=${() => store.tags.move(t.id, +1)}
                    disabled=${i >= sorted.length - 1}>${Icon.down()}</button>
                  <button class="btn-mini" title="Изменить" onClick=${() => setEditing(t)}>${Icon.edit()}</button>
                  <button class="btn-mini" title="Удалить" onClick=${() => setConfirmDel(t)}>${Icon.trash()}</button>
                </div>
              </div>
            `)}
          </div>
        `}
    </div>

    ${editing && html`
      <${TagForm} initial=${editing === "new" ? null : editing} onClose=${() => setEditing(null)} />
    `}
    ${confirmDel && html`
      <${ConfirmModal}
        title="Удалить тег?"
        message="Тег пропадёт со всех операций, но сами операции останутся."
        onCancel=${() => setConfirmDel(null)}
        onConfirm=${async () => {
          await store.tags.remove(confirmDel.id);
          store.pushToast("Тег удалён", "success");
          setConfirmDel(null);
        }}
      />
    `}
  `;
}

function TagForm({ initial, onClose }) {
  const store = useStore();
  const editing = !!initial;
  const [name, setName] = useState(initial?.name || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) { setError("Введите название"); return; }
    setBusy(true);
    try {
      if (editing) await store.tags.update(initial.id, { name: name.trim() });
      else await store.tags.create({ name: name.trim() });
      store.pushToast(editing ? "Тег обновлён" : "Тег создан", "success");
      onClose();
    } catch (e) {
      const msg = String(e.message || "");
      if (msg.includes("duplicate")) setError("Такой тег уже есть");
      else setError(msg);
    } finally { setBusy(false); }
  }

  return html`
    <${Modal} title=${editing ? "Редактировать тег" : "Новый тег"} onClose=${onClose}
      footer=${html`
        <button class="btn ghost" onClick=${onClose}>Отмена</button>
        <button class="btn primary" disabled=${busy} onClick=${submit}>${busy ? "Сохраняю…" : "Сохранить"}</button>
      `}
    >
      <form onSubmit=${submit} style="display:flex;flex-direction:column;gap:14px;">
        <div class="field">
          <label>Название</label>
          <input class="input" value=${name} onInput=${e => setName(e.target.value)} autofocus />
        </div>
        ${error && html`<div class="notice error">${error}</div>`}
      </form>
    <//>
  `;
}
