(() => {
  const STORAGE_KEY = 'income-tracker:v1';

  const form = document.getElementById('income-form');
  const amountInput = document.getElementById('amount');
  const dateInput = document.getElementById('date');
  const categoryInput = document.getElementById('category');
  const noteInput = document.getElementById('note');
  const listEl = document.getElementById('income-list');
  const emptyEl = document.getElementById('empty-state');
  const searchInput = document.getElementById('search');
  const periodSelect = document.getElementById('period');
  const exportBtn = document.getElementById('export-btn');

  const statTotal = document.getElementById('stat-total');
  const statTotalHint = document.getElementById('stat-total-hint');
  const statCount = document.getElementById('stat-count');
  const statAvg = document.getElementById('stat-avg');
  const statTop = document.getElementById('stat-top');
  const statTopHint = document.getElementById('stat-top-hint');

  const moneyFmt = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  });

  const dateFmt = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const periodLabels = {
    month: 'за этот месяц',
    year: 'за этот год',
    all: 'за всё время',
  };

  let state = {
    incomes: load(),
    search: '',
    period: 'all',
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.incomes));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function todayISO() {
    const d = new Date();
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 10);
  }

  function inPeriod(item, period) {
    if (period === 'all') return true;
    const d = new Date(item.date);
    const now = new Date();
    if (period === 'month') {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    if (period === 'year') {
      return d.getFullYear() === now.getFullYear();
    }
    return true;
  }

  function matchesSearch(item, query) {
    if (!query) return true;
    const q = query.trim().toLowerCase();
    return (
      item.category.toLowerCase().includes(q) ||
      (item.note || '').toLowerCase().includes(q)
    );
  }

  function getFiltered() {
    return state.incomes
      .filter((i) => inPeriod(i, state.period))
      .filter((i) => matchesSearch(i, state.search))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
  }

  function categoryInitials(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function render() {
    const filtered = getFiltered();
    const inPeriodList = state.incomes.filter((i) => inPeriod(i, state.period));

    // Stats
    const total = inPeriodList.reduce((sum, i) => sum + Number(i.amount), 0);
    statTotal.textContent = moneyFmt.format(total);
    statTotalHint.textContent = periodLabels[state.period];
    statCount.textContent = String(inPeriodList.length);
    statAvg.textContent = inPeriodList.length
      ? moneyFmt.format(total / inPeriodList.length)
      : moneyFmt.format(0);

    const byCategory = inPeriodList.reduce((acc, i) => {
      acc[i.category] = (acc[i.category] || 0) + Number(i.amount);
      return acc;
    }, {});
    const top = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
    if (top) {
      statTop.textContent = top[0];
      const share = total ? Math.round((top[1] / total) * 100) : 0;
      statTopHint.textContent = `${moneyFmt.format(top[1])} · ${share}%`;
    } else {
      statTop.textContent = '—';
      statTopHint.textContent = 'нет данных';
    }

    // List
    listEl.innerHTML = '';
    if (filtered.length === 0) {
      emptyEl.classList.remove('is-hidden');
      if (state.search || state.period !== 'all') {
        emptyEl.querySelector('.empty__title').textContent = 'Ничего не найдено';
        emptyEl.querySelector('.empty__text').textContent =
          'Попробуйте изменить фильтр или период.';
      } else {
        emptyEl.querySelector('.empty__title').textContent = 'Пока пусто';
        emptyEl.querySelector('.empty__text').textContent =
          'Добавьте первое поступление, чтобы увидеть его здесь.';
      }
    } else {
      emptyEl.classList.add('is-hidden');
      const frag = document.createDocumentFragment();
      for (const item of filtered) {
        frag.appendChild(renderItem(item));
      }
      listEl.appendChild(frag);
    }
  }

  function renderItem(item) {
    const li = document.createElement('li');
    li.className = 'item';

    const icon = document.createElement('div');
    icon.className = 'item__icon';
    icon.textContent = categoryInitials(item.category);

    const main = document.createElement('div');
    main.className = 'item__main';

    const title = document.createElement('span');
    title.className = 'item__title';
    title.textContent = item.note ? item.note : item.category;

    const meta = document.createElement('span');
    meta.className = 'item__meta';
    const cat = document.createElement('span');
    cat.textContent = item.category;
    const dot = document.createElement('span');
    dot.className = 'dot';
    const date = document.createElement('span');
    date.textContent = dateFmt.format(new Date(item.date));
    meta.append(cat, dot, date);

    main.append(title, meta);

    const amount = document.createElement('span');
    amount.className = 'item__amount';
    amount.textContent = '+' + moneyFmt.format(Number(item.amount));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'item__delete';
    del.title = 'Удалить';
    del.setAttribute('aria-label', 'Удалить запись');
    del.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
    del.addEventListener('click', () => removeItem(item.id));

    li.append(icon, main, amount, del);
    return li;
  }

  function addItem(data) {
    state.incomes.push({
      id: uid(),
      amount: Number(data.amount),
      date: data.date,
      category: data.category,
      note: (data.note || '').trim(),
      createdAt: Date.now(),
    });
    save();
    render();
  }

  function removeItem(id) {
    state.incomes = state.incomes.filter((i) => i.id !== id);
    save();
    render();
  }

  function exportCSV() {
    if (state.incomes.length === 0) return;
    const header = ['Дата', 'Категория', 'Сумма', 'Комментарий'];
    const rows = state.incomes
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((i) => [i.date, i.category, i.amount, i.note || '']);
    const csv = [header, ...rows]
      .map((r) =>
        r
          .map((v) => {
            const s = String(v).replace(/"/g, '""');
            return /[",;\n]/.test(s) ? `"${s}"` : s;
          })
          .join(';')
      )
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `incomes-${todayISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Init
  dateInput.value = todayISO();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseFloat(amountInput.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      amountInput.focus();
      return;
    }
    addItem({
      amount,
      date: dateInput.value || todayISO(),
      category: categoryInput.value,
      note: noteInput.value,
    });
    form.reset();
    dateInput.value = todayISO();
    amountInput.focus();
  });

  searchInput.addEventListener('input', (e) => {
    state.search = e.target.value;
    render();
  });

  periodSelect.addEventListener('change', (e) => {
    state.period = e.target.value;
    render();
  });

  exportBtn.addEventListener('click', exportCSV);

  render();
})();
