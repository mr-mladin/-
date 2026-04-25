import { html } from "htm/preact";
import { useState, useMemo, useEffect } from "preact/hooks";
import { useStore } from "../lib/store.js";
import { parseAmount, todayISO, currencySymbol } from "../lib/format.js";
import { Modal } from "./Modal.js";
import { Icon } from "../lib/icons.js";

export function OperationForm({ initial, onClose }) {
  const store = useStore();
  const { accounts, categories, tags: allTags, operationTags } = store;

  const editing = !!initial?.id;
  const initialTagIds = useMemo(
    () => initial?.id ? operationTags.filter(ot => ot.operation_id === initial.id).map(ot => ot.tag_id) : [],
    [initial?.id, operationTags]
  );

  const activeAccounts = accounts.filter(a => !a.archived);
  const defaultAccountId = activeAccounts[0]?.id || "";

  const [kind, setKind] = useState(initial?.kind || "expense");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [accountId, setAccountId] = useState(initial?.account_id || defaultAccountId);
  const [toAccountId, setToAccountId] = useState(initial?.to_account_id || "");
  const [toAmount, setToAmount] = useState(initial?.to_amount ? String(initial.to_amount) : "");
  const [categoryId, setCategoryId] = useState(initial?.category_id || "");
  const [tagIds, setTagIds] = useState(initialTagIds);
  const [date, setDate] = useState(initial?.date || todayISO());
  const [note, setNote] = useState(initial?.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newTagText, setNewTagText] = useState("");

  // При смене типа сбрасываем категорию
  useEffect(() => {
    if (kind === "transfer") {
      setCategoryId("");
    } else if (categoryId) {
      const c = categories.find(x => x.id === categoryId);
      if (!c || c.kind !== kind) setCategoryId("");
    }
  }, [kind]);

  // Дерево категорий: parent → дети
  const tree = useMemo(() => {
    const filtered = categories.filter(c => !c.archived && c.kind === kind);
    const parents = filtered.filter(c => !c.parent_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const childrenOf = (id) => filtered.filter(c => c.parent_id === id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return { parents, childrenOf };
  }, [categories, kind]);

  const account = accounts.find(a => a.id === accountId);
  const toAccount = accounts.find(a => a.id === toAccountId);

  function toggleTag(id) {
    setTagIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function addTagFromText() {
    const name = newTagText.trim();
    if (!name) return;
    const t = await store.tags.findOrCreateByName(name);
    if (t && !tagIds.includes(t.id)) setTagIds(p => [...p, t.id]);
    setNewTagText("");
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    const amt = parseAmount(amount);
    if (!amt || amt <= 0) { setError("Укажите сумму больше нуля"); return; }
    if (!accountId) { setError("Выберите счёт"); return; }
    if (kind === "transfer") {
      if (!toAccountId) { setError("Выберите счёт получателя"); return; }
      if (toAccountId === accountId) { setError("Счета должны различаться"); return; }
    }

    const payload = {
      kind, amount: amt, account_id: accountId, date, note: note.trim() || null,
      category_id: kind === "transfer" ? null : (categoryId || null),
      to_account_id: kind === "transfer" ? toAccountId : null,
      to_amount: kind === "transfer"
        ? (toAmount ? parseAmount(toAmount) : amt)
        : null,
    };

    setBusy(true);
    try {
      if (editing) {
        await store.operations.update(initial.id, payload, tagIds);
        store.pushToast("Операция обновлена", "success");
      } else {
        await store.operations.create(payload, tagIds);
        store.pushToast("Операция добавлена", "success");
      }
      onClose?.();
    } catch (e) {
      setError(e.message || "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  if (activeAccounts.length === 0) {
    return html`
      <${Modal} title="Сначала создайте счёт" onClose=${onClose}
        footer=${html`<button class="btn primary" onClick=${onClose}>Понятно</button>`}>
        <p>Чтобы добавлять операции, нужен хотя бы один счёт. Откройте раздел <b>Настройки → Счета</b> и создайте первый.</p>
      <//>
    `;
  }

  return html`
    <${Modal}
      title=${editing ? "Редактировать операцию" : "Новая операция"}
      onClose=${onClose}
      footer=${html`
        <button class="btn ghost" onClick=${onClose}>Отмена</button>
        <button class="btn primary" onClick=${submit} disabled=${busy}>
          ${busy ? "Сохранение…" : (editing ? "Сохранить" : "Добавить")}
        </button>
      `}
    >
      <form onSubmit=${submit} style="display:flex;flex-direction:column;gap:14px;">
        <div class=${"seg " + kind} style="align-self:flex-start;">
          <button type="button" class=${kind === "expense" ? "active" : ""} onClick=${() => setKind("expense")}>Расход</button>
          <button type="button" class=${kind === "income" ? "active" : ""} onClick=${() => setKind("income")}>Доход</button>
          <button type="button" class=${kind === "transfer" ? "active" : ""} onClick=${() => setKind("transfer")}>Перевод</button>
        </div>

        <div class="field">
          <label>Сумма</label>
          <div style="position:relative;">
            <input class="input amount" inputmode="decimal" placeholder="0,00"
                   value=${amount} onInput=${e => setAmount(e.target.value)} />
            <span style="position:absolute;right:14px;top:50%;transform:translateY(-50%);color:var(--text-mute);">
              ${currencySymbol(account?.currency || "RUB")}
            </span>
          </div>
        </div>

        <div class="row cols-2">
          <div class="field">
            <label>${kind === "transfer" ? "Со счёта" : "Счёт"}</label>
            <select class="select" value=${accountId} onChange=${e => setAccountId(e.target.value)}>
              ${activeAccounts.map(a => html`<option value=${a.id} key=${a.id}>${a.name}${a.currency !== "RUB" ? ` (${a.currency})` : ""}</option>`)}
            </select>
          </div>
          <div class="field">
            <label>Дата</label>
            <input class="input" type="date" value=${date} onInput=${e => setDate(e.target.value)} />
          </div>
        </div>

        ${kind === "transfer" && html`
          <div class="row cols-2">
            <div class="field">
              <label>На счёт</label>
              <select class="select" value=${toAccountId} onChange=${e => setToAccountId(e.target.value)}>
                <option value="">— выберите —</option>
                ${activeAccounts.filter(a => a.id !== accountId).map(a => html`
                  <option value=${a.id} key=${a.id}>${a.name}${a.currency !== "RUB" ? ` (${a.currency})` : ""}</option>
                `)}
              </select>
            </div>
            ${toAccount && account && toAccount.currency !== account.currency && html`
              <div class="field">
                <label>Сумма зачисления (${currencySymbol(toAccount.currency)})</label>
                <input class="input" inputmode="decimal" placeholder=${amount || "0,00"}
                       value=${toAmount} onInput=${e => setToAmount(e.target.value)} />
              </div>
            `}
          </div>
        `}

        ${kind !== "transfer" && html`
          <div class="field">
            <label>Категория</label>
            <select class="select" value=${categoryId} onChange=${e => setCategoryId(e.target.value)}>
              <option value="">— без категории —</option>
              ${tree.parents.map(p => html`
                <optgroup label=${p.name} key=${p.id}>
                  <option value=${p.id}>${p.name}</option>
                  ${tree.childrenOf(p.id).map(c => html`
                    <option value=${c.id} key=${c.id}>— ${c.name}</option>
                  `)}
                </optgroup>
              `)}
            </select>
          </div>
        `}

        <div class="field">
          <label>Теги</label>
          ${allTags.length > 0 && html`
            <div class="tag-list" style="margin-bottom:6px;">
              ${[...allTags].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map(t => html`
                <button type="button" key=${t.id}
                  class=${"chip " + (tagIds.includes(t.id) ? "tag" : "")}
                  style=${tagIds.includes(t.id) ? "" : "cursor:pointer;"}
                  onClick=${() => toggleTag(t.id)}>${t.name}</button>
              `)}
            </div>
          `}
          <div style="display:flex;gap:8px;">
            <input class="input" placeholder="Создать новый тег…"
                   value=${newTagText} onInput=${e => setNewTagText(e.target.value)}
                   onKeyDown=${e => { if (e.key === "Enter") { e.preventDefault(); addTagFromText(); } }} />
            <button type="button" class="btn" onClick=${addTagFromText}>${Icon.plus()}</button>
          </div>
        </div>

        <div class="field">
          <label>Комментарий</label>
          <textarea class="textarea" placeholder="Что-нибудь про операцию…"
                    value=${note} onInput=${e => setNote(e.target.value)}></textarea>
        </div>

        ${error && html`<div class="notice error">${error}</div>`}
      </form>
    <//>
  `;
}
