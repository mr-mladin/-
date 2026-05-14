# Финансы — заметки для Claude

Это веб-приложение для личных финансов. Владелец — не программист, общается по-русски.
Отвечай по-русски, объясняй технические шаги простыми словами.

## Стек (важно!)

- **Без сборки.** Нет `package.json`, нет `npm`, нет webpack/vite. Зависимости подгружаются
  прямо в браузере через ESM CDN (см. `<script type="importmap">` в `index.html`).
- **Preact + htm** — UI. Шаблоны через `html\`...\`` (а не JSX).
- **Supabase** — PostgreSQL + Auth. Ключи в `src/lib/supabase.js`.
- **GitHub Pages** — деплой. Любой коммит в `main` идёт в прод.
- **Service worker** `sw.js` — stale-while-revalidate, кэширует статику.

Не предлагай добавить bundler, TypeScript, npm-зависимости или фреймворк-сборщик —
это сознательный выбор, чтобы проект оставался простым.

## Структура

```
index.html              — точка входа, importmap, тема до загрузки CSS
sw.js                   — service worker
src/
  main.js               — render <App/>
  App.js                — роутинг по странице (dashboard/budgets/goals/settings)
  styles.css            — все стили (одним файлом, ~30K)
  lib/
    store.js            — глобальный state + CRUD (store.actions.*)
    supabase.js         — клиент Supabase
    router.js           — hash-роутер
    format.js           — форматирование сумм/дат
    csv.js              — экспорт/импорт CSV (включая Money Flow)
    icons.js            — иконки
  components/
    Layout.js, Modal.js, Toasts.js
    AccountForm.js, OperationForm.js, OperationsList.js
    AmountInput.js, IconPicker.js, PlansChart.js
  pages/
    DashboardPage.js, BudgetsPage.js, GoalsPage.js
    AuthPage.js, ResetPasswordPage.js
    SettingsPage.js + settings/{Accounts,Categories,Tags,Profile,Data}Settings.js
```

## Конвенции кода

- Шаблоны: `html\`<${Component} prop=${value}>...<//>\`` (htm-синтаксис).
- CRUD-методы вызываются через `store.actions.*` (не как поля state).
- Состояние меняем через `dispatch({ type: "set", payload: {...} })`.
- Тосты: `store.actions.toast("текст", "success" | "error" | "info")`.
- Язык интерфейса — русский. Все строки в UI на русском.
- Стили — в `src/styles.css`. CSS-переменные для темизации (light/dark/auto).

## Локальный запуск

```bash
python3 -m http.server 8000
# http://localhost:8000
```

Других команд (тестов, линтера, билда) нет.

## Git workflow

- Рабочая ветка указана в инструкциях сессии (обычно `claude/...`).
- Коммитим осмысленными порциями, заголовок — что и зачем.
- Мерж в `main` через PR — это автоматически деплоит на GitHub Pages.

## Чего не делать

- Не добавлять `package.json` / `node_modules` / bundler.
- Не вносить JSX — только htm-шаблоны.
- Не плодить мелкие файлы и абстракции «на будущее».
- Не писать комментарии, объясняющие очевидное; пиши их только если *почему* неочевидно.
- Не пушить в `main` напрямую.

## Стиль общения

Владелец не технарь. Когда предлагаешь изменения:
- Сначала кратко по-человечески: «что увидит пользователь после правки».
- Только потом — детали реализации, если он спросит.
- Не вываливай длинные диффы в чат — они есть в коммите.
