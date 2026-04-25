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

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"
];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
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
  return `${MONTHS[date.getMonth()][0].toUpperCase()}${MONTHS[date.getMonth()].slice(1)} ${date.getFullYear()}`;
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
