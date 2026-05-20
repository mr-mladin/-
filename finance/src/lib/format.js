// Форматирование сумм, дат и парсинг ввода

export const CURRENCIES = {
  RUB: { symbol: "₽", name: "Рубль" },
  USD: { symbol: "$", name: "Доллар США" },
  EUR: { symbol: "€", name: "Евро" },
  KZT: { symbol: "₸", name: "Тенге" },
  BYN: { symbol: "Br", name: "Белорусский рубль" },
  UAH: { symbol: "₴", name: "Гривна" },
  GBP: { symbol: "£", name: "Фунт стерлингов" },
  CNY: { symbol: "¥", name: "Юань" },
  TRY: { symbol: "₺", name: "Турецкая лира" },
  GEL: { symbol: "₾", name: "Лари" },
  AED: { symbol: "د.إ", name: "Дирхам ОАЭ" },
};

export function currencySymbol(code) {
  return CURRENCIES[code]?.symbol || code || "";
}

const SEPARATORS = {
  space: { thousand: " ", decimal: "," },
  comma: { thousand: ",", decimal: "." },
  none: { thousand: "", decimal: "." },
};

export function formatAmount(value, currency = "RUB", numberFormat = "space") {
  if (value === null || value === undefined || isNaN(Number(value))) return "—";
  const num = Number(value);
  const sep = SEPARATORS[numberFormat] || SEPARATORS.space;
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  const fixed = abs.toFixed(2);
  let [int, dec] = fixed.split(".");
  if (sep.thousand) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, sep.thousand);
  const decPart = dec === "00" ? "" : sep.decimal + dec;
  return `${sign}${int}${decPart} ${currencySymbol(currency)}`;
}

export function formatAmountSigned(value, currency, numberFormat) {
  if (value > 0) return "+" + formatAmount(value, currency, numberFormat);
  return formatAmount(value, currency, numberFormat);
}

export function parseAmount(input) {
  if (typeof input === "number") return input;
  if (!input) return NaN;
  const cleaned = String(input)
    .replace(/[  \s]/g, "")
    .replace(/,/g, ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? NaN : num;
}

// Живое форматирование при вводе суммы.
// Принимает «сырой» текст из <input>, возвращает форматированную версию
// и новую позицию каретки.
export function formatNumberInput(raw, caret = raw.length, numberFormat = "space") {
  const sep = SEPARATORS[numberFormat] || SEPARATORS.space;
  const decimalChar = sep.decimal;

  // 1) Считаем «сырое» содержимое (только цифры и десятичный разделитель).
  //    Заодно запоминаем сколько «значащих» символов было до каретки.
  let signed = "";
  let rawDigitsBeforeCaret = 0;
  let seenDecimal = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch >= "0" && ch <= "9") {
      signed += ch;
      if (i < caret) rawDigitsBeforeCaret++;
    } else if (!seenDecimal && (ch === "." || ch === ",")) {
      signed += ".";
      seenDecimal = true;
      if (i < caret) rawDigitsBeforeCaret++;
    }
    // прочие символы (пробелы, буквы) игнорируем
  }

  if (!signed) return { value: "", caret: 0 };

  // 2) Делим на целую и дробную часть, ограничиваем дробную 2 знаками
  let [intPart, decPart] = signed.split(".");
  if (intPart === "") intPart = "0";
  // убираем ведущие нули, кроме одного
  intPart = intPart.replace(/^0+(?=\d)/, "");
  if (intPart === "") intPart = "0";
  if (decPart !== undefined) decPart = decPart.slice(0, 2);

  // 3) Расставляем разделители тысяч в целой части
  const intWithSep = sep.thousand
    ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep.thousand)
    : intPart;

  const formatted = decPart !== undefined
    ? intWithSep + decimalChar + decPart
    : intWithSep;

  // 4) Пересчитываем позицию каретки: количество значащих символов
  //    до каретки сохраняется
  let newCaret = 0;
  let counted = 0;
  for (let i = 0; i < formatted.length; i++) {
    const ch = formatted[i];
    const isSig = (ch >= "0" && ch <= "9") || ch === decimalChar;
    if (counted === rawDigitsBeforeCaret) { newCaret = i; break; }
    if (isSig) counted++;
    newCaret = i + 1;
  }

  return { value: formatted, caret: newCaret };
}

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"
];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_NOM = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
];
const MONTHS_LOC = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"
];
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

export function todayISO() {
  const d = new Date();
  return toISO(d);
}

export function toISO(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromISO(s) {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(iso) {
  const d = fromISO(iso);
  if (!d) return "";
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear) return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateLong(iso) {
  const d = fromISO(iso);
  if (!d) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateRelative(iso) {
  const d = fromISO(iso);
  if (!d) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  if (diff === -1) return "Завтра";
  return formatDate(iso);
}

export function monthKey(iso) {
  return iso.slice(0, 7);
}

export function startOfFinMonth(date, financialMonthStart = 1) {
  const d = new Date(date.getTime());
  if (d.getDate() < financialMonthStart) d.setMonth(d.getMonth() - 1);
  d.setDate(financialMonthStart);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfFinMonth(date, financialMonthStart = 1) {
  const start = startOfFinMonth(date, financialMonthStart);
  const end = new Date(start.getTime());
  end.setMonth(end.getMonth() + 1);
  end.setDate(end.getDate() - 1);
  return end;
}

export function shiftFinMonth(date, delta, financialMonthStart = 1) {
  const start = startOfFinMonth(date, financialMonthStart);
  start.setMonth(start.getMonth() + delta);
  return start;
}

export function finMonthLabel(date) {
  return `${MONTHS_NOM[date.getMonth()]} ${date.getFullYear()}`;
}

export function monthLocative(date) {
  return MONTHS_LOC[date.getMonth()];
}

export function monthNominative(date) {
  return MONTHS_NOM[date.getMonth()];
}

export function startOfWeek(date, firstDay = 1) {
  const d = new Date(date.getTime());
  const day = d.getDay();
  const diff = (day - firstDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function weekdayShort(idx) {
  return WEEKDAYS[idx];
}
