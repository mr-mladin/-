// Простой CSV экспорт/импорт операций.
// Поддерживается формат с заголовком, разделитель — запятая или точка с запятой.

import { parseAmount, todayISO } from "./format.js";

const HEADERS = ["date", "type", "amount", "currency", "account", "to_account", "category", "subcategory", "tags", "note"];

function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, "\"\"")}"`;
  }
  return s;
}

export function exportOperationsToCsv(operations, accounts, categories, tags, opTags) {
  const accountById = new Map(accounts.map(a => [a.id, a]));
  const categoryById = new Map(categories.map(c => [c.id, c]));
  const tagById = new Map(tags.map(t => [t.id, t]));
  const opTagsByOp = new Map();
  for (const ot of opTags || []) {
    if (!opTagsByOp.has(ot.operation_id)) opTagsByOp.set(ot.operation_id, []);
    const tag = tagById.get(ot.tag_id);
    if (tag) opTagsByOp.get(ot.operation_id).push(tag.name);
  }

  const lines = [HEADERS.join(",")];
  for (const op of operations) {
    const acc = accountById.get(op.account_id);
    const toAcc = op.to_account_id ? accountById.get(op.to_account_id) : null;
    const cat = op.category_id ? categoryById.get(op.category_id) : null;
    const parent = cat?.parent_id ? categoryById.get(cat.parent_id) : null;
    const cells = [
      op.date,
      op.kind,
      op.amount,
      acc?.currency || "",
      acc?.name || "",
      toAcc?.name || "",
      parent ? parent.name : (cat?.name || ""),
      parent ? cat.name : "",
      (opTagsByOp.get(op.id) || []).join("|"),
      op.note || "",
    ].map(escapeCsv);
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

export function downloadCsv(filename, content) {
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Минимальный CSV-парсер с поддержкой кавычек
function parseCsvText(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = []; let cell = ""; let inQuotes = false;
  // Определяем разделитель по первой строке
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = (firstLine.split(";").length > firstLine.split(",").length) ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") { cell += "\""; i++; }
        else inQuotes = false;
      } else { cell += ch; }
    } else {
      if (ch === "\"") inQuotes = true;
      else if (ch === delimiter) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== ""));
}

// Распознать дату в нескольких форматах
function normalizeDate(s) {
  if (!s) return null;
  s = String(s).trim();
  // ISO 2024-04-25
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // 25.04.2024 или 25/04/2024
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    let [_, d, mo, y] = m;
    if (y.length === 2) y = "20" + y;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

// Возвращает массив объектов { date, kind, amount, currency, account, toAccount, category, subcategory, tags[], note }
export function parseCsvImport(text) {
  const rows = parseCsvText(text);
  if (!rows.length) return { rows: [], errors: ["Файл пустой"] };

  const header = rows[0].map(h => h.trim().toLowerCase());
  const dataRows = rows.slice(1);
  const errors = [];

  // Сопоставление колонок
  const find = (...names) => {
    for (const n of names) {
      const i = header.findIndex(h => h === n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const idx = {
    date: find("date", "дата"),
    type: find("type", "kind", "тип"),
    amount: find("amount", "сумма", "value"),
    currency: find("currency", "валюта"),
    account: find("account", "счёт", "счет"),
    toAccount: find("to_account", "to account", "счёт получатель"),
    category: find("category", "категория"),
    subcategory: find("subcategory", "подкатегория"),
    tags: find("tags", "теги"),
    note: find("note", "комментарий", "description"),
  };

  if (idx.date === -1) errors.push("Не найдена колонка date / дата");
  if (idx.amount === -1) errors.push("Не найдена колонка amount / сумма");

  if (errors.length) return { rows: [], errors };

  const result = [];
  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    if (row.every(c => !c || !c.trim())) continue;
    const date = normalizeDate(row[idx.date]) || todayISO();
    let amount = parseAmount(row[idx.amount]);
    if (isNaN(amount)) { errors.push(`Строка ${r + 2}: некорректная сумма`); continue; }

    let kind = "expense";
    const typeStr = idx.type !== -1 ? String(row[idx.type] || "").toLowerCase().trim() : "";
    if (typeStr === "income" || typeStr === "доход" || amount > 0 && idx.type === -1) kind = "income";
    if (typeStr === "expense" || typeStr === "расход" || (amount < 0 && idx.type === -1)) kind = "expense";
    if (typeStr === "transfer" || typeStr === "перевод") kind = "transfer";
    // Если знак "+/-" использован в сумме — учитываем
    if (idx.type === -1) {
      kind = amount >= 0 ? "income" : "expense";
    }
    amount = Math.abs(amount);

    const tagsStr = idx.tags !== -1 ? String(row[idx.tags] || "") : "";
    const tags = tagsStr.split(/[|;,]/).map(s => s.trim()).filter(Boolean);

    result.push({
      date, kind, amount,
      currency: idx.currency !== -1 ? row[idx.currency]?.trim() || "" : "",
      account: idx.account !== -1 ? row[idx.account]?.trim() || "" : "",
      toAccount: idx.toAccount !== -1 ? row[idx.toAccount]?.trim() || "" : "",
      category: idx.category !== -1 ? row[idx.category]?.trim() || "" : "",
      subcategory: idx.subcategory !== -1 ? row[idx.subcategory]?.trim() || "" : "",
      tags,
      note: idx.note !== -1 ? row[idx.note]?.trim() || "" : "",
    });
  }
  return { rows: result, errors };
}
