// Форматирование чисел в русской локали. «—» для пустых значений.

const rubFmt = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});
const numFmt = new Intl.NumberFormat("ru-RU");

export const rub = (n) => (n == null ? "—" : rubFmt.format(n));
export const num = (n) => (n == null ? "—" : numFmt.format(n));
export const pct = (n) =>
  n == null ? "—" : (n * 100).toFixed(1).replace(".", ",") + "%";
