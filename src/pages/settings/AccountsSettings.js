import { html } from "htm/preact";
import { useState, useMemo } from "preact/hooks";
import { useStore } from "../../lib/store.js";
import { formatAmount } from "../../lib/format.js";
import { Icon } from "../../lib/icons.js";
import { ConfirmModal } from "../../components/Modal.js";
import { AccountForm } from "../../components/AccountForm.js";
import { renderIcon } from "../../components/IconPicker.js";

function plural(n, one, few, many) {
  const m100 = n % 100, m10 = n % 10;
  if (m100 >= 11 && m100 <= 14) return many;
  if (m10 === 1) return one;
  if (m10 >= 2 && m10 <= 4) return few;
  return many;
}

export function AccountsSettings() {
  const store = useStore();
  const { profile, accounts, operations } = store;
  const fmt = (v, c) => formatAmount(v, c, profile?.number_format || "space");

  const [editing, setEditing] = useState(null);   // null | "new" | account
  const [confirmDel, setConfirmDel] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const sorted = useMemo(() =>
    [...accounts].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [accounts]);

  const visible = sorted.filter(a => showArchived ? true : !a.archived);
  const visibleActive = sorted.filter(a => !a.archived);

  function balance(account) {
    let bal = Number(account.initial_balance || 0);
    for (const op of operations) {
      if (op.account_id === account.id) {
        if (op.kind === "income") bal += Number(op.amount);
        else if (op.kind === "expense" || op.kind === "transfer") bal -= Number(op.amount);
      }
      if (op.to_account_id === account.id && op.kind === "transfer") {
        bal += Number(op.to_amount || op.amount);
      }
    }
    return bal;
  }

  return html`
    <div class="card">
      <div class="section-head" style="padding:16px 18px 8px;">
        <h2>Счета</h2>
        <div class="btn-row">
          <button class="btn ghost sm" onClick=${() => setShowArchived(s => !s)}>
            ${showArchived ? "Скрыть архив" : "Показать архив"}
          </button>
          <button class="btn primary sm" onClick=${() => setEditing("new")}>${Icon.plus()} Новый счёт</button>
        </div>
      </div>
      ${visible.length === 0
        ? html`<div class="empty">
            <div class="em-title">Создайте первый счёт</div>
            Это может быть карта, наличные, депозит — что угодно.<br/><br/>
            <button class="btn primary" onClick=${() => setEditing("new")}>${Icon.plus()} Создать</button>
          </div>`
        : html`
          <div class="list">
            ${visible.map(a => {
              const bal = balance(a);
              const idx = visibleActive.findIndex(x => x.id === a.id);
              return html`
                <div class="list-row clickable" key=${a.id}
                     onClick=${() => setEditing(a)}
                     style="cursor:pointer;">
                  <div class="lr-icon" style=${`color:${a.color || "var(--accent)"};background:${(a.color || "#16a34a")}1f;`}>${renderIcon(a.icon, "wallet")}</div>
                  <div class="lr-main">
                    <div class="lr-title">
                      ${a.name}
                      ${a.archived && html`<span class="chip" style="margin-left:8px;font-size:11px;">архив</span>`}
                    </div>
                    <div class="lr-sub">${a.currency || "RUB"} • стартовый ${fmt(a.initial_balance, a.currency)}</div>
                  </div>
                  <div class="lr-amount">${fmt(bal, a.currency)}</div>
                  <div class="row-actions" style="margin-left:8px;" onClick=${e => e.stopPropagation()}>
                    ${!a.archived && html`
                      <button class="btn-mini" title="Выше"
                        onClick=${() => store.actions.accounts.move(a.id, -1)}
                        disabled=${idx <= 0}>${Icon.up()}</button>
                      <button class="btn-mini" title="Ниже"
                        onClick=${() => store.actions.accounts.move(a.id, +1)}
                        disabled=${idx >= visibleActive.length - 1}>${Icon.down()}</button>
                    `}
                    <button class="btn-mini" title="Удалить" onClick=${() => setConfirmDel(a)}>${Icon.trash()}</button>
                  </div>
                </div>
              `;
            })}
          </div>
        `}
    </div>

    ${editing && html`
      <${AccountForm} initial=${editing === "new" ? null : editing} onClose=${() => setEditing(null)} />
    `}
    ${confirmDel && (() => {
      const opCount = operations.filter(o => o.account_id === confirmDel.id || o.to_account_id === confirmDel.id).length;
      const hasOps = opCount > 0;
      return html`
        <${ConfirmModal}
          title=${hasOps ? "Удаление невозможно" : "Удалить счёт?"}
          confirmText=${hasOps ? "Заархивировать" : "Удалить"}
          danger=${!hasOps}
          message=${hasOps
            ? html`<div>На счёте «${confirmDel.name}» — ${opCount} ${plural(opCount, "операция", "операции", "операций")}. Удалить такой счёт нельзя. Можно <b>заархивировать</b>: он исчезнет из активного списка, но история сохранится.</div>`
            : html`<div>Счёт «${confirmDel.name}» будет удалён без возможности восстановления.</div>`}
          onCancel=${() => setConfirmDel(null)}
          onConfirm=${async () => {
            try {
              if (hasOps) {
                await store.actions.accounts.update(confirmDel.id, { archived: true });
                store.pushToast("Счёт заархивирован", "success");
              } else {
                await store.actions.accounts.remove(confirmDel.id);
                store.pushToast("Счёт удалён", "success");
              }
            } catch (e) {
              store.pushToast(hasOps ? "Не удалось заархивировать" : "Не удалось удалить", "error");
            }
            setConfirmDel(null);
          }}
        />
      `;
    })()}
  `;
}

