import { html } from "htm/preact";
import { useState } from "preact/hooks";
import { useStore } from "../lib/store.js";
import { formatAmount, parseAmount, formatDate } from "../lib/format.js";
import { Icon } from "../lib/icons.js";
import { Modal, ConfirmModal } from "../components/Modal.js";

const COLORS = ["#6366f1", "#10b981", "#0ea5e9", "#f59e0b", "#ec4899", "#8b5cf6", "#22c55e", "#ef4444", "#06b6d4"];

export function GoalsPage() {
  const store = useStore();
  const { profile, goals } = store;
  const fmt = (v) => formatAmount(v, profile?.base_currency || "RUB", profile?.number_format || "space");

  const [editing, setEditing] = useState(null);     // null | "new" | goal
  const [contributing, setContributing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const active = goals.filter(g => !g.archived).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  return html`
    <div class="page-head">
      <div>
        <h1>Цели накоплений</h1>
        <div class="sub">${active.length} ${active.length === 1 ? "цель" : "целей"}</div>
      </div>
      <div class="btn-row">
        <button class="btn primary" onClick=${() => setEditing("new")}>${Icon.plus()} Добавить цель</button>
      </div>
    </div>

    ${active.length === 0
      ? html`<div class="card empty">
          <div class="em-title">Цели — это про мечту с дедлайном</div>
          Заведите цель: например, отпуск или подушка безопасности.<br/><br/>
          <button class="btn primary" onClick=${() => setEditing("new")}>${Icon.plus()} Создать цель</button>
        </div>`
      : html`
        <div class="row" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;">
          ${active.map(g => {
            const target = Number(g.target_amount);
            const current = Number(g.current_amount || 0);
            const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
            const left = Math.max(0, target - current);
            return html`
              <div class="card" style="padding:18px;" key=${g.id}>
                <div class="between">
                  <div class="flex">
                    <span class="lr-icon" style=${`color:${g.color || "var(--accent)"};background:${(g.color || "#6366f1")}1f;`}>${Icon.goal()}</span>
                    <div>
                      <div style="font-weight:600;">${g.name}</div>
                      <div class="muted" style="font-size:12px;">
                        Цель ${fmt(target)}${g.due_date ? ` • до ${formatDate(g.due_date)}` : ""}
                      </div>
                    </div>
                  </div>
                  <div class="row-actions">
                    <button class="btn-mini" title="Изменить" onClick=${() => setEditing(g)}>${Icon.edit()}</button>
                    <button class="btn-mini" title="Удалить" onClick=${() => setConfirmDel(g)}>${Icon.trash()}</button>
                  </div>
                </div>
                <div style="margin-top:14px;font-size:22px;font-weight:700;letter-spacing:-0.02em;">
                  ${fmt(current)}
                  <span class="muted" style="font-size:14px;font-weight:500;"> • ${Math.round(pct)}%</span>
                </div>
                <div class="progress" style="margin-top:10px;">
                  <div style=${`width:${pct}%;background:${g.color || "var(--accent)"};`}></div>
                </div>
                <div class="between" style="margin-top:14px;">
                  <span class="muted" style="font-size:13px;">Осталось ${fmt(left)}</span>
                  <button class="btn sm" onClick=${() => setContributing(g)}>${Icon.plus()} Пополнить</button>
                </div>
              </div>
            `;
          })}
        </div>
      `}

    ${editing && html`
      <${GoalForm} initial=${editing === "new" ? null : editing} onClose=${() => setEditing(null)} />
    `}
    ${contributing && html`
      <${ContributeForm} goal=${contributing} onClose=${() => setContributing(null)} />
    `}
    ${confirmDel && html`
      <${ConfirmModal}
        title="Удалить цель?"
        message="Сами операции и счета не пострадают."
        onCancel=${() => setConfirmDel(null)}
        onConfirm=${async () => { await store.goals.remove(confirmDel.id); setConfirmDel(null); store.pushToast("Цель удалена", "success"); }}
      />
    `}
  `;
}

function GoalForm({ initial, onClose }) {
  const store = useStore();
  const editing = !!initial;
  const [name, setName] = useState(initial?.name || "");
  const [target, setTarget] = useState(initial ? String(initial.target_amount) : "");
  const [current, setCurrent] = useState(initial ? String(initial.current_amount || 0) : "0");
  const [dueDate, setDueDate] = useState(initial?.due_date || "");
  const [color, setColor] = useState(initial?.color || COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Дайте цели название"); return; }
    const t = parseAmount(target);
    const c = parseAmount(current);
    if (!t || t <= 0) { setError("Целевая сумма должна быть больше нуля"); return; }
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        target_amount: t,
        current_amount: isNaN(c) ? 0 : c,
        due_date: dueDate || null,
        color,
      };
      if (editing) await store.goals.update(initial.id, payload);
      else await store.goals.create(payload);
      store.pushToast(editing ? "Цель обновлена" : "Цель создана", "success");
      onClose();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return html`
    <${Modal} title=${editing ? "Редактировать цель" : "Новая цель"} onClose=${onClose}
      footer=${html`
        <button class="btn ghost" onClick=${onClose}>Отмена</button>
        <button class="btn primary" disabled=${busy} onClick=${submit}>${busy ? "Сохранение…" : "Сохранить"}</button>
      `}
    >
      <form onSubmit=${submit} style="display:flex;flex-direction:column;gap:14px;">
        <div class="field">
          <label>Название</label>
          <input class="input" placeholder="Например: Отпуск в Италию"
            value=${name} onInput=${e => setName(e.target.value)} />
        </div>
        <div class="row cols-2">
          <div class="field">
            <label>Цель</label>
            <input class="input amount" inputmode="decimal" placeholder="0,00"
              value=${target} onInput=${e => setTarget(e.target.value)} />
          </div>
          <div class="field">
            <label>Уже накоплено</label>
            <input class="input amount" inputmode="decimal" placeholder="0,00"
              value=${current} onInput=${e => setCurrent(e.target.value)} />
          </div>
        </div>
        <div class="field">
          <label>Дата (необязательно)</label>
          <input class="input" type="date" value=${dueDate} onInput=${e => setDueDate(e.target.value)} />
        </div>
        <div class="field">
          <label>Цвет</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${COLORS.map(c => html`
              <button type="button" key=${c}
                onClick=${() => setColor(c)}
                style=${`width:28px;height:28px;border-radius:50%;border:2px solid ${color === c ? "var(--text)" : "transparent"};background:${c};cursor:pointer;`}></button>
            `)}
          </div>
        </div>
        ${error && html`<div class="notice error">${error}</div>`}
      </form>
    <//>
  `;
}

function ContributeForm({ goal, onClose }) {
  const store = useStore();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    const a = parseAmount(amount);
    if (!a) { setError("Укажите сумму"); return; }
    setBusy(true);
    try {
      await store.goals.contribute(goal.id, a);
      store.pushToast(`Пополнено: «${goal.name}»`, "success");
      onClose();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return html`
    <${Modal} title=${`Пополнить «${goal.name}»`} onClose=${onClose}
      footer=${html`
        <button class="btn ghost" onClick=${onClose}>Отмена</button>
        <button class="btn primary" disabled=${busy} onClick=${submit}>${busy ? "Минутку…" : "Пополнить"}</button>
      `}
    >
      <form onSubmit=${submit} style="display:flex;flex-direction:column;gap:14px;">
        <div class="field">
          <label>Сумма пополнения</label>
          <input class="input amount" inputmode="decimal" placeholder="0,00" autofocus
            value=${amount} onInput=${e => setAmount(e.target.value)} />
        </div>
        <div class="muted" style="font-size:13px;">
          Это просто счётчик. Реальные деньги переводите между счетами через раздел «Операции».
        </div>
        ${error && html`<div class="notice error">${error}</div>`}
      </form>
    <//>
  `;
}
