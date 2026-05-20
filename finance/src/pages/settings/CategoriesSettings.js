import { html } from "htm/preact";
import { useState, useMemo } from "preact/hooks";
import { useStore } from "../../lib/store.js";
import { Icon } from "../../lib/icons.js";
import { Modal, ConfirmModal } from "../../components/Modal.js";
import { IconPicker, renderIcon } from "../../components/IconPicker.js";

const COLORS = ["#16a34a", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#22c55e", "#14b8a6", "#f97316", "#6366f1", "#94a3b8"];

export function CategoriesSettings() {
  const store = useStore();
  const { categories } = store;
  const [kind, setKind] = useState("expense");
  const [editing, setEditing] = useState(null);    // null | { parentId? } | category
  const [confirmDel, setConfirmDel] = useState(null);

  const tree = useMemo(() => {
    const inKind = categories.filter(c => c.kind === kind && !c.archived);
    const parents = inKind.filter(c => !c.parent_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const childrenOf = (id) => inKind.filter(c => c.parent_id === id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return { parents, childrenOf };
  }, [categories, kind]);

  return html`
    <div class="card">
      <div class="section-head" style="padding:16px 18px 8px;">
        <div class="seg">
          <button class=${kind === "expense" ? "active" : ""} onClick=${() => setKind("expense")}>Расходы</button>
          <button class=${kind === "income" ? "active" : ""} onClick=${() => setKind("income")}>Доходы</button>
        </div>
        <button class="btn primary sm" onClick=${() => setEditing({ kind })}>${Icon.plus()} Категория</button>
      </div>

      ${tree.parents.length === 0
        ? html`<div class="empty">
            <div class="em-title">Категорий пока нет</div>
            Создайте первую категорию для ${kind === "expense" ? "расходов" : "доходов"}.<br/><br/>
            <button class="btn primary" onClick=${() => setEditing({ kind })}>${Icon.plus()} Добавить</button>
          </div>`
        : html`
          <div class="list">
            ${tree.parents.map((p, i) => html`
              <${CategoryRow}
                key=${p.id} cat=${p} idx=${i}
                total=${tree.parents.length}
                children=${tree.childrenOf(p.id)}
                onEdit=${(c) => setEditing(c)}
                onDelete=${(c) => setConfirmDel(c)}
                onAddChild=${(parent) => setEditing({ kind, parentId: parent.id })}
              />
            `)}
          </div>
        `}
    </div>

    ${editing && html`
      <${CategoryForm}
        initial=${editing.id ? editing : null}
        defaultKind=${editing.kind || kind}
        defaultParentId=${editing.parentId || null}
        onClose=${() => setEditing(null)}
      />
    `}
    ${confirmDel && html`
      <${ConfirmModal}
        title="Удалить категорию?"
        message=${html`<div>Подкатегории удалятся вместе с ней. У операций в этой категории «категория» обнулится — операции останутся.</div>`}
        onCancel=${() => setConfirmDel(null)}
        onConfirm=${async () => {
          try { await store.actions.categories.remove(confirmDel.id); store.pushToast("Категория удалена", "success"); }
          catch (e) { store.pushToast("Не удалось удалить", "error"); }
          setConfirmDel(null);
        }}
      />
    `}
  `;
}

function CategoryRow({ cat, idx, total, children, onEdit, onDelete, onAddChild }) {
  const store = useStore();
  return html`
    <div>
      <div class="list-row clickable" onClick=${() => onEdit(cat)} style="cursor:pointer;">
        <span class="lr-icon" style=${`color:${cat.color || "var(--accent)"};background:${(cat.color || "#16a34a")}1f;`}>${renderIcon(cat.icon, "tag")}</span>
        <div class="lr-main"><div class="lr-title">${cat.name}</div></div>
        <div class="row-actions" onClick=${e => e.stopPropagation()}>
          <button class="btn-mini" title="Подкатегория" onClick=${() => onAddChild(cat)}>${Icon.plus()}</button>
          <button class="btn-mini" title="Выше"
            onClick=${() => store.actions.categories.move(cat.id, -1)}
            disabled=${idx <= 0}>${Icon.up()}</button>
          <button class="btn-mini" title="Ниже"
            onClick=${() => store.actions.categories.move(cat.id, +1)}
            disabled=${idx >= total - 1}>${Icon.down()}</button>
          <button class="btn-mini" title="Удалить" onClick=${() => onDelete(cat)}>${Icon.trash()}</button>
        </div>
      </div>
      ${children.length > 0 && html`
        <div style="padding-left:32px;">
          ${children.map((c, i) => html`
            <div class="list-row clickable" key=${c.id}
                 onClick=${() => onEdit(c)} style="cursor:pointer;">
              <span class="lr-icon" style=${`color:${c.color || "var(--accent)"};background:${(c.color || "#16a34a")}1f;width:28px;height:28px;flex:0 0 28px;`}>${renderIcon(c.icon, "tag")}</span>
              <div class="lr-main"><div class="lr-title">${c.name}</div></div>
              <div class="row-actions" onClick=${e => e.stopPropagation()}>
                <button class="btn-mini" title="Выше"
                  onClick=${() => store.actions.categories.move(c.id, -1)}
                  disabled=${i <= 0}>${Icon.up()}</button>
                <button class="btn-mini" title="Ниже"
                  onClick=${() => store.actions.categories.move(c.id, +1)}
                  disabled=${i >= children.length - 1}>${Icon.down()}</button>
                <button class="btn-mini" title="Удалить" onClick=${() => onDelete(c)}>${Icon.trash()}</button>
              </div>
            </div>
          `)}
        </div>
      `}
    </div>
  `;
}

function CategoryForm({ initial, defaultKind, defaultParentId, onClose }) {
  const store = useStore();
  const { categories } = store;
  const editing = !!initial;
  const [name, setName] = useState(initial?.name || "");
  const [kind, setKind] = useState(initial?.kind || defaultKind || "expense");
  const [parentId, setParentId] = useState(initial?.parent_id || defaultParentId || "");
  const [color, setColor] = useState(initial?.color || COLORS[0]);
  const [icon, setIcon] = useState(initial?.icon || "tag");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Возможные родители: только категории того же типа без родителя, и не сам себе.
  const possibleParents = categories.filter(c =>
    c.kind === kind && !c.parent_id && !c.archived && (editing ? c.id !== initial.id : true)
  ).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Введите название"); return; }
    setBusy(true);
    try {
      const payload = { name: name.trim(), kind, parent_id: parentId || null, color, icon };
      if (editing) await store.actions.categories.update(initial.id, payload);
      else await store.actions.categories.create(payload);
      store.pushToast(editing ? "Категория обновлена" : "Категория создана", "success");
      onClose();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return html`
    <${Modal} title=${editing ? "Редактировать категорию" : (parentId ? "Новая подкатегория" : "Новая категория")} onClose=${onClose}
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
        ${!editing && !defaultParentId && html`
          <div class="field">
            <label>Тип</label>
            <div class=${"seg " + kind} style="align-self:flex-start;">
              <button type="button" class=${kind === "expense" ? "active" : ""} onClick=${() => { setKind("expense"); setParentId(""); }}>Расход</button>
              <button type="button" class=${kind === "income" ? "active" : ""} onClick=${() => { setKind("income"); setParentId(""); }}>Доход</button>
            </div>
          </div>
        `}
        <div class="field">
          <label>Родительская категория</label>
          <select class="select" value=${parentId} onChange=${e => setParentId(e.target.value)}>
            <option value="">— нет, верхний уровень —</option>
            ${possibleParents.map(p => html`<option value=${p.id} key=${p.id}>${p.name}</option>`)}
          </select>
        </div>
        <div class="field">
          <label>Иконка</label>
          <${IconPicker} value=${icon} onChange=${setIcon} />
        </div>
        <div class="field">
          <label>Цвет</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            ${COLORS.map(c => html`
              <button type="button" key=${c} onClick=${() => setColor(c)}
                style=${`width:28px;height:28px;border-radius:50%;border:2px solid ${color === c ? "var(--text)" : "transparent"};background:${c};cursor:pointer;`}></button>
            `)}
            <label class="custom-color" title="Выбрать свой цвет"
              style=${`width:28px;height:28px;border-radius:50%;border:2px solid ${COLORS.includes(color) ? "transparent" : "var(--text)"};background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red);cursor:pointer;display:inline-block;position:relative;`}>
              <input type="color" value=${color}
                onInput=${e => setColor(e.target.value)}
                style="position:absolute;inset:0;opacity:0;cursor:pointer;border:none;" />
            </label>
            <input class="input" style="width:96px;padding:6px 10px;font-family:var(--font-mono);font-size:13px;"
              value=${color} onInput=${e => {
                const v = e.target.value.trim();
                if (/^#?[0-9a-fA-F]{6}$/.test(v)) setColor(v.startsWith("#") ? v : "#" + v);
                else setColor(v);
              }} />
          </div>
        </div>
        ${error && html`<div class="notice error">${error}</div>`}
      </form>
    <//>
  `;
}
