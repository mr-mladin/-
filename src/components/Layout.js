import { html } from "htm/preact";
import { useEffect, useState } from "preact/hooks";
import { useStore } from "../lib/store.js";
import { href } from "../lib/router.js";
import { Icon } from "../lib/icons.js";
import { renderIcon } from "./IconPicker.js";
import { formatAmount } from "../lib/format.js";
import { AccountForm } from "./AccountForm.js";

const NAV = [
  { name: "dashboard", label: "Главная",   icon: "dashboard" },
  { name: "planner",   label: "Планер",    icon: "calendar" },
  { name: "budgets",   label: "Бюджеты",   icon: "budget" },
  { name: "goals",     label: "Цели",      icon: "goal" },
  { name: "settings",  label: "Настройки", icon: "settings" },
];

export function Layout({ active, children }) {
  const store = useStore();
  const { user, profile, accounts, operations, selectedAccountId } = store;

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("fin.sidebar.collapsed") === "1"; } catch (e) { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [creatingAccount, setCreatingAccount] = useState(false);

  useEffect(() => {
    try { localStorage.setItem("fin.sidebar.collapsed", collapsed ? "1" : "0"); } catch (e) {}
  }, [collapsed]);

  // На мобилке закрываем сайдбар при смене страницы
  useEffect(() => { setMobileOpen(false); }, [active]);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e) { if (e.key === "Escape") setMobileOpen(false); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // Если выбранный счёт пропал — снимаем фильтр
  useEffect(() => {
    if (!selectedAccountId) return;
    const exists = accounts.some(a => a.id === selectedAccountId && !a.archived);
    if (!exists) store.setSelectedAccount(null);
  }, [accounts, selectedAccountId]);

  const fmt = (v, c) => formatAmount(v, c || profile?.base_currency || "RUB", profile?.number_format || "space");
  const visibleAccounts = accounts.filter(a => !a.archived);
  const totalBalance = visibleAccounts.reduce((s, a) => s + accountBalance(a, operations), 0);

  function onPickAccount(a) {
    if (editMode) {
      setEditingAccount(a);
      return;
    }
    store.setSelectedAccount(a.id);
    if (mobileOpen) setMobileOpen(false);
  }

  function onPickAll() {
    store.setSelectedAccount(null);
    if (mobileOpen) setMobileOpen(false);
  }

  const shellClass = "app-shell"
    + (collapsed ? " is-collapsed" : "")
    + (mobileOpen ? " is-mobile-open" : "");

  return html`
    <div class=${shellClass}>
      <button class="menu-btn sidebar-mobile-btn"
        onClick=${() => setMobileOpen(o => !o)}
        aria-label=${mobileOpen ? "Закрыть меню" : "Открыть меню"}>
        ${mobileOpen ? Icon.close() : Icon.menu()}
      </button>

      <div class="sidebar-backdrop" onClick=${() => setMobileOpen(false)} aria-hidden="true"></div>

      <aside class="sidebar">
        <div class="sidebar-head">
          <nav class="sidebar-nav">
            ${NAV.map(item => html`
              <a class=${"sidebar-nav-btn" + (active === item.name ? " active" : "")}
                 href=${href(item.name)}
                 data-tip=${item.label}
                 aria-label=${item.label}
                 key=${item.name}>
                ${Icon[item.icon]()}
              </a>
            `)}
          </nav>
          <button class="sidebar-toggle"
                  onClick=${() => setCollapsed(c => !c)}
                  title=${collapsed ? "Развернуть" : "Свернуть"}
                  aria-label=${collapsed ? "Развернуть панель" : "Свернуть панель"}>
            ${collapsed ? Icon.right() : Icon.left()}
          </button>
        </div>

        ${active !== "planner" && html`
        <div class="sidebar-body">
          <div class="sidebar-acc-tools">
            <button class="btn-mini" title="Новый счёт"
                    onClick=${() => setCreatingAccount(true)}>${Icon.plus()}</button>
            <button class=${"btn-mini" + (editMode ? " is-active" : "")}
                    title=${editMode ? "Готово" : "Редактировать счета"}
                    onClick=${() => setEditMode(m => !m)}>${Icon.edit()}</button>
          </div>

          <div class="sidebar-accs">
            <button class=${"sidebar-acc is-all" + (!selectedAccountId ? " selected" : "")}
                    onClick=${onPickAll}
                    title="Показать все счета">
              <span class="sidebar-acc-icon">${Icon.down()}</span>
              <span class="sidebar-acc-name">Все счета</span>
              <span class=${"sidebar-acc-bal " + (totalBalance < 0 ? "neg" : "pos")}>${signed(totalBalance, fmt)}</span>
            </button>

            ${visibleAccounts.map(a => {
              const bal = accountBalance(a, operations);
              const isSel = selectedAccountId === a.id;
              return html`
                <button class=${"sidebar-acc" + (isSel ? " selected" : "")}
                        key=${a.id}
                        onClick=${() => onPickAccount(a)}
                        title=${editMode ? `Изменить «${a.name}»` : `Показать только «${a.name}»`}>
                  <span class="sidebar-acc-icon" style=${`color:${a.color || "var(--accent)"};`}>
                    ${renderIcon(a.icon, "wallet")}
                  </span>
                  <span class="sidebar-acc-name">${a.name}</span>
                  <span class=${"sidebar-acc-bal " + (bal < 0 ? "neg" : "pos")}>${signed(bal, fmt, a.currency)}</span>
                </button>
              `;
            })}

            ${visibleAccounts.length === 0 && html`
              <div class="muted" style="padding:10px 8px;font-size:13px;">
                Пока нет счетов.<br/>
                <button class="btn primary sm" style="margin-top:8px;"
                        onClick=${() => setCreatingAccount(true)}>${Icon.plus()} Создать счёт</button>
              </div>
            `}
          </div>
        </div>
        `}

        <div class="sidebar-foot">
          <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Аккаунт</div>
          <div class="email">${user?.email}</div>
        </div>
      </aside>

      <div class="page">${children}</div>
    </div>

    ${creatingAccount && html`<${AccountForm} onClose=${() => setCreatingAccount(false)} />`}
    ${editingAccount && html`<${AccountForm} initial=${editingAccount} onClose=${() => setEditingAccount(null)} />`}
  `;
}

function accountBalance(account, operations) {
  let bal = Number(account.initial_balance || 0);
  for (const op of operations) {
    if (op.account_id === account.id) {
      if (op.kind === "income") bal += Number(op.amount);
      else if (op.kind === "expense") bal -= Number(op.amount);
      else if (op.kind === "transfer") bal -= Number(op.amount);
    }
    if (op.to_account_id === account.id && op.kind === "transfer") {
      bal += Number(op.to_amount || op.amount);
    }
  }
  return bal;
}

function signed(v, fmt, currency) {
  const s = fmt(Math.abs(v), currency);
  if (v < 0) return `−${s}`;
  return `+${s}`;
}
