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

В репозитории два независимых приложения, каждое в своей папке. В корне —
лончер (выбор приложения) и «выключатель» старого корневого service worker.

```
index.html              — корневой лончер (ссылки на /finance/ и /planner/)
sw.js                   — выключатель прежнего корневого SW (после переезда finance)
finance/                — приложение «Финансы» (адрес .../finance/)
  index.html            — точка входа, importmap, тема до загрузки CSS
  sw.js                 — service worker (stale-while-revalidate)
  src/
    main.js             — render <App/>
    App.js              — роутинг по странице (dashboard/budgets/goals/settings)
    styles.css          — все стили (одним файлом, ~30K)
    lib/
      store.js          — глобальный state + CRUD (store.actions.*)
      supabase.js       — клиент Supabase
      router.js         — hash-роутер
      format.js         — форматирование сумм/дат
      csv.js            — экспорт/импорт CSV (включая Money Flow)
      icons.js          — иконки
    components/
      Layout.js, Modal.js, Toasts.js
      AccountForm.js, OperationForm.js, OperationsList.js
      AmountInput.js, IconPicker.js, PlansChart.js
    pages/
      DashboardPage.js, BudgetsPage.js, GoalsPage.js
      AuthPage.js, ResetPasswordPage.js
      SettingsPage.js + settings/{Accounts,Categories,Tags,Profile,Data}Settings.js
planner/                — приложение «Планер» (адрес .../planner/), самостоятельное
  index.html, main.js, lib.js, store.js, components.js, Planner.js, styles.css
```

Планер не зависит от кода финансов. Использует тот же проект Supabase, но
отдельную схему БД `planner` (таблицы `planner.lists`, `planner.tasks`) и общий
вход (тот же `storageKey: "fin.auth"`). Финансы — схема `public`.

**Перед работой над планером читай `planner/PLANNER_NOTES.md`** — карта проекта,
ключевые механики (перенос задач, оптимистичные правки, зум, чекбокс), грабли (TDZ →
белый экран, `overflow:hidden` режет тень) и бэклог. Обновляй его при значимых решениях.

## Конвенции кода

- Шаблоны: `html\`<${Component} prop=${value}>...<//>\`` (htm-синтаксис).
- CRUD-методы вызываются через `store.actions.*` (не как поля state).
- Состояние меняем через `dispatch({ type: "set", payload: {...} })`.
- Тосты: `store.actions.toast("текст", "success" | "error" | "info")`.
- Язык интерфейса — русский. Все строки в UI на русском.
- Стили финансов — в `finance/src/styles.css`. CSS-переменные для темизации (light/dark/auto).

## Локальный запуск

```bash
python3 -m http.server 8000
# лончер:  http://localhost:8000/
# финансы: http://localhost:8000/finance/
# планер:  http://localhost:8000/planner/
```

Других команд (тестов, линтера, билда) нет.

## Git workflow

- Рабочая ветка указана в инструкциях сессии (обычно `claude/...`).
- Коммитим осмысленными порциями, заголовок — что и зачем.
- Любой коммит в `main` автоматически деплоит на GitHub Pages.
- **По умолчанию выкатываем напрямую в `main`** (commit → push в main), без PR. Это проще и быстрее для проекта одного человека. PR заводим, только если владелец явно попросит.

### Автономный режим

Владелец делегировал полный цикл: правки → commit → push в `main` → дождаться деплоя → отчитаться. Спрашивать разрешения на выкатку не нужно — выкатывай сам. Если что-то сломалось — откатить обратным коммитом (revert) и сообщить.

Исключения, когда всё-таки остановиться и спросить:
- удаление/переименование таблиц или колонок в Supabase
- смена SUPABASE_URL/SUPABASE_KEY
- любые действия, ломающие данные пользователя
- крупные архитектурные перестройки (смена стека, ввод сборщика и т.п.)

Если что-то сломалось — откатить через revert-commit на main, не паниковать.

## Чего не делать

- Не добавлять `package.json` / `node_modules` / bundler.
- Не вносить JSX — только htm-шаблоны.
- Не плодить мелкие файлы и абстракции «на будущее».
- Не писать комментарии, объясняющие очевидное; пиши их только если *почему* неочевидно.

## Стиль общения

Владелец не технарь. Когда предлагаешь изменения:
- Сначала кратко по-человечески: «что увидит пользователь после правки».
- Только потом — детали реализации, если он спросит.
- Не вываливай длинные диффы в чат — они есть в коммите.
