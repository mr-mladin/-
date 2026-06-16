// Демо-данные для прототипа дашборда.
//
// Каждая строка дня имеет ту же форму, что будущая строка в базе:
//   { date, spend, clicks, leads }
// Производные метрики (цена заявки, цена перехода, конверсия) считаются на лету
// в App.js — ровно как формулы в гугл-таблице. Когда подключим VK Ads API,
// заменим только источник этих строк, а интерфейс и расчёты не изменятся.
//
// Числа сгенерированы детерминированно (seed по кабинету), чтобы при обновлении
// страницы цифры не «прыгали» и дашборд выглядел как настоящий.

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const YEAR = 2026;
const DAYS_IN_MONTH = 30; // июнь
const TODAY = 16;         // данные есть по «вчера» (15-е) включительно

// budget  — ориентировочный дневной бюджет, ₽
// crBase  — базовая конверсия перехода в заявку (доля)
// runUntil — день, после которого реклама остановлена (для проектов на паузе)
function buildDaily(seed, { budget, crBase, runUntil = DAYS_IN_MONTH }) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let day = 1; day <= DAYS_IN_MONTH; day++) {
    const date = `${YEAR}-06-${String(day).padStart(2, "0")}`;
    const stopped = day > runUntil;
    const future = day >= TODAY;
    if (stopped || future) {
      out.push({ date, spend: null, clicks: null, leads: null });
      continue;
    }
    const spend = Math.round(budget * (0.75 + rnd() * 0.5));
    const cpc = 25 + rnd() * 45; // цена перехода 25–70 ₽
    const clicks = Math.max(1, Math.round(spend / cpc));
    const cr = Math.max(0, crBase + (rnd() - 0.5) * 0.06);
    const leads = Math.max(0, Math.round(clicks * cr));
    out.push({ date, spend, clicks, leads });
  }
  return out;
}

export const monthLabel = "Июнь 2026";

export const projects = [
  {
    id: "14836914",
    name: "Оксана Мангутова",
    status: "active",
    planCpl: 900,
    daily: buildDaily(1483, { budget: 1000, crBase: 0.06 }),
  },
  {
    id: "26208506",
    name: "Ксения Панина",
    status: "active",
    planCpl: 700,
    daily: buildDaily(2620, { budget: 800, crBase: 0.085 }),
  },
  {
    id: "19084907",
    name: "Юлия Шмырина",
    status: "active",
    planCpl: 1200,
    daily: buildDaily(1908, { budget: 1500, crBase: 0.05 }),
  },
  {
    id: "23013819",
    name: "Галина Кучеренко",
    status: "paused",
    planCpl: 1000,
    daily: buildDaily(2301, { budget: 800, crBase: 0.05, runUntil: 7 }),
  },
  {
    id: "19798955",
    name: "Виктория Лещук",
    status: "paused",
    planCpl: 1000,
    daily: buildDaily(1979, { budget: 1000, crBase: 0.06, runUntil: 5 }),
  },
];
