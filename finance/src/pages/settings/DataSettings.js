import { html } from "htm/preact";
import { useState, useRef } from "preact/hooks";
import { useStore } from "../../lib/store.js";
import { Icon } from "../../lib/icons.js";
import { exportOperationsToCsv, downloadCsv, parseCsvImport } from "../../lib/csv.js";
import { Modal } from "../../components/Modal.js";
import { todayISO } from "../../lib/format.js";

export function DataSettings() {
  const store = useStore();
  const fileRef = useRef(null);
  const [importing, setImporting] = useState(null);   // null | { rows, errors, defaults }
  const [failedReport, setFailedReport] = useState(null); // null | { imported, failedDetails }
  const [busy, setBusy] = useState(false);

  function doExport() {
    const csv = exportOperationsToCsv(store.operations, store.accounts, store.categories, store.tags, store.operationTags);
    downloadCsv(`finances-${todayISO()}.csv`, csv);
    store.pushToast("Экспорт готов", "success");
  }

  function pickFile() { fileRef.current?.click(); }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    const result = parseCsvImport(text);
    setImporting({
      ...result,
      defaultAccountId: store.accounts.find(a => !a.archived)?.id || "",
    });
  }

  async function runImport() {
    if (!importing?.rows?.length) return;
    setBusy(true);
    let imported = 0;
    const failedDetails = [];

    const accountByName = new Map(store.accounts.map(a => [a.name.toLowerCase(), a]));
    const categoryByName = new Map();
    for (const c of store.categories) categoryByName.set(`${c.kind}|${(c.parent_id || "")}|${c.name.toLowerCase()}`, c);
    const tagByName = new Map(store.tags.map(t => [t.name.toLowerCase(), t]));

    async function ensureCategory(name, kind, parentId = null) {
      if (!name) return null;
      const key = `${kind}|${parentId || ""}|${name.toLowerCase()}`;
      if (categoryByName.has(key)) return categoryByName.get(key);
      const cat = await store.actions.categories.create({ name, kind, parent_id: parentId });
      categoryByName.set(key, cat);
      return cat;
    }
    async function ensureTag(name) {
      const key = name.toLowerCase();
      if (tagByName.has(key)) return tagByName.get(key);
      const t = await store.actions.tags.create({ name });
      tagByName.set(key, t);
      return t;
    }

    for (let i = 0; i < importing.rows.length; i++) {
      const row = importing.rows[i];
      const lineNo = i + 2; // строка в CSV (с учётом заголовка)
      try {
        let account = row.account ? accountByName.get(row.account.toLowerCase()) : null;
        if (!account) account = store.accounts.find(a => a.id === importing.defaultAccountId);
        if (!account) {
          failedDetails.push({ lineNo, row,
            reason: row.account
              ? `Счёт «${row.account}» не найден среди ваших счетов и не выбран счёт по умолчанию.`
              : "Счёт не указан и счёт по умолчанию не выбран." });
          continue;
        }

        let toAccount = null;
        if (row.kind === "transfer" && row.toAccount) {
          toAccount = accountByName.get(row.toAccount.toLowerCase());
          if (!toAccount) {
            failedDetails.push({ lineNo, row,
              reason: `Счёт получатель «${row.toAccount}» не найден среди ваших счетов. Создайте его в Настройках → Счета и попробуйте снова.` });
            continue;
          }
        }

        let categoryId = null;
        if (row.kind !== "transfer" && row.category) {
          const parent = await ensureCategory(row.category, row.kind, null);
          if (row.subcategory) {
            const child = await ensureCategory(row.subcategory, row.kind, parent.id);
            categoryId = child.id;
          } else {
            categoryId = parent.id;
          }
        }

        const tagIds = [];
        for (const tName of row.tags || []) {
          const t = await ensureTag(tName);
          if (t) tagIds.push(t.id);
        }

        await store.actions.operations.create({
          kind: row.kind,
          amount: row.amount,
          account_id: account.id,
          to_account_id: toAccount?.id || null,
          to_amount: row.kind === "transfer" ? (row.toAmount ?? row.amount) : null,
          category_id: categoryId,
          date: row.date,
          note: row.note || null,
        }, tagIds);
        imported++;
      } catch (e) {
        console.error(e);
        failedDetails.push({ lineNo, row,
          reason: (e?.message || "Неизвестная ошибка базы данных").trim() });
      }
    }

    setBusy(false);
    setImporting(null);
    if (failedDetails.length === 0) {
      store.pushToast(`Импортировано: ${imported}`, "success");
    } else {
      setFailedReport({ imported, failedDetails });
    }
  }

  return html`
    <div class="row cols-2" style="align-items:start;">
      <div class="card" style="padding:18px;">
        <h2 style="margin:0 0 8px;font-size:16px;">Экспорт</h2>
        <div class="muted" style="font-size:13px;margin-bottom:14px;">
          Скачайте все операции в формате CSV — откроется в Excel/Numbers/Google Sheets.
        </div>
        <button class="btn" onClick=${doExport}>${Icon.download()} Скачать CSV</button>
      </div>

      <div class="card" style="padding:18px;">
        <h2 style="margin:0 0 8px;font-size:16px;">Импорт</h2>
        <div class="muted" style="font-size:13px;margin-bottom:14px;">
          Загрузите CSV из банковского приложения или своего бэкапа. Поддерживаются колонки:
          <code style="font-size:12px;">date, type, amount, currency, account, to_account, category, subcategory, tags, note</code>.
          Если колонки <i>type</i> нет — знак суммы определяет тип (− расход, + доход).
        </div>
        <input type="file" accept=".csv,text/csv" ref=${fileRef} onChange=${onFile} style="display:none;" />
        <button class="btn" onClick=${pickFile}>${Icon.upload()} Выбрать CSV</button>
      </div>
    </div>

    ${importing && html`
      <${Modal} wide title="Предпросмотр импорта" onClose=${() => setImporting(null)}
        footer=${html`
          <button class="btn ghost" onClick=${() => setImporting(null)}>Отмена</button>
          <button class="btn primary" disabled=${busy || !importing.rows.length} onClick=${runImport}>
            ${busy ? "Импортирую…" : `Импортировать ${importing.rows.length}`}
          </button>
        `}
      >
        ${importing.errors?.length > 0 && html`
          <div class="notice error">
            ${importing.errors.map(e => html`<div>${e}</div>`)}
          </div>
        `}
        ${importing.rows?.length > 0 && html`
          <div class="field">
            <label>Счёт по умолчанию (если в файле не указан)</label>
            <select class="select" value=${importing.defaultAccountId}
              onChange=${e => setImporting(p => ({ ...p, defaultAccountId: e.target.value }))}>
              ${store.accounts.filter(a => !a.archived).map(a => html`
                <option value=${a.id} key=${a.id}>${a.name}</option>
              `)}
            </select>
          </div>
          <div style="overflow:auto;max-height:300px;border:1px solid var(--border);border-radius:10px;">
            <table class="table">
              <thead>
                <tr>
                  <th>Дата</th><th>Тип</th><th>Сумма</th><th>Счёт</th><th>Категория</th>
                </tr>
              </thead>
              <tbody>
                ${importing.rows.slice(0, 50).map((r, i) => html`
                  <tr key=${i}>
                    <td>${r.date}</td>
                    <td>${r.kind}</td>
                    <td class="num">${r.amount}</td>
                    <td>${r.account || "—"}</td>
                    <td>${[r.category, r.subcategory].filter(Boolean).join(" / ") || "—"}</td>
                  </tr>
                `)}
              </tbody>
            </table>
            ${importing.rows.length > 50 && html`
              <div class="muted" style="padding:10px 14px;text-align:center;">
                …и ещё ${importing.rows.length - 50} строк
              </div>
            `}
          </div>
          <div class="muted" style="font-size:12px;">
            Если категории, теги или счета из файла не существуют — категории и теги будут созданы автоматически.
            Операции с неизвестным счётом будут отнесены к выбранному выше.
          </div>
        `}
        ${(!importing.rows || importing.rows.length === 0) && importing.errors?.length === 0 && html`
          <div class="empty">В файле не нашлось строк для импорта.</div>
        `}
      <//>
    `}

    ${failedReport && html`
      <${Modal} wide title=${`Импорт завершён с ошибками`}
        onClose=${() => setFailedReport(null)}
        footer=${html`
          <button class="btn ghost" onClick=${() => downloadFailReport(failedReport)}>${Icon.download()} Скачать отчёт</button>
          <button class="btn primary" onClick=${() => setFailedReport(null)}>Понятно</button>
        `}
      >
        <div class="notice">
          Импортировано: <b>${failedReport.imported}</b>. Не удалось: <b>${failedReport.failedDetails.length}</b>.
        </div>
        <div style="overflow:auto;max-height:380px;border:1px solid var(--border);border-radius:10px;">
          <table class="table">
            <thead>
              <tr>
                <th>Строка</th><th>Дата</th><th>Тип</th><th class="num">Сумма</th><th>Счёт</th><th>Причина</th>
              </tr>
            </thead>
            <tbody>
              ${failedReport.failedDetails.map((f, i) => html`
                <tr key=${i}>
                  <td class="muted">${f.lineNo}</td>
                  <td>${f.row.date}</td>
                  <td>${f.row.kind}</td>
                  <td class="num">${f.row.amount}</td>
                  <td>${f.row.account || "—"}${f.row.toAccount ? ` → ${f.row.toAccount}` : ""}</td>
                  <td style="color:var(--expense);">${f.reason}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
        <div class="muted" style="font-size:12px;">
          Чаще всего причина — несовпадающее имя счёта. Проверьте, что счета с такими же названиями созданы в Настройках → Счета, потом запустите импорт заново — операции, которые уже импортировались, продублируются, поэтому имеет смысл сначала удалить их (через фильтр по дате на главной).
        </div>
      <//>
    `}
  `;
}

function downloadFailReport(report) {
  const TAB = "\t", NL = "\n";
  const lines = [
    ["line", "date", "type", "amount", "account", "to_account", "reason"].join(TAB),
    ...report.failedDetails.map(f => [
      f.lineNo, f.row.date, f.row.kind, f.row.amount,
      f.row.account || "", f.row.toAccount || "",
      (f.reason || "").replace(/[\t\n]/g, " ")
    ].join(TAB))
  ].join(NL);
  const blob = new Blob([lines], { type: "text/tab-separated-values;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "import-errors.tsv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
