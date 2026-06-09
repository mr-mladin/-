// Состояние планера: авторизация, списки и задачи. Самостоятельный стор,
// по структуре повторяет финансовое приложение, но содержит только планер.

import { createContext, h } from "preact";
import { useContext, useEffect, useReducer, useRef, useState } from "preact/hooks";
import { supabase, applyTheme, todayISO } from "./lib.js";

const StoreContext = createContext(null);

const initialState = {
  loading: true,
  ready: false,
  user: null,
  taskLists: readCache().lists,
  tasks: readCache().tasks,
  areas: readCache().areas,
  theme: readTheme(),
};

function readTheme() {
  try { return localStorage.getItem("planner.theme") || "auto"; } catch (e) { return "auto"; }
}
// Локальный кэш задач/проектов — чтобы при открытии (особенно на мобильной сети)
// задачи показывались мгновенно из прошлой сессии, а не пустая сетка на 1–2 сек.
function readCache() {
  try {
    const v = JSON.parse(localStorage.getItem("planner.cache") || "null");
    if (v && Array.isArray(v.tasks) && Array.isArray(v.lists)) return { areas: [], ...v };
  } catch (e) {}
  return { tasks: [], lists: [], areas: [] };
}
function writeCache(lists, tasks, areas) {
  try { localStorage.setItem("planner.cache", JSON.stringify({ lists, tasks, areas })); } catch (e) {}
}
function clearCache() {
  try { localStorage.removeItem("planner.cache"); } catch (e) {}
}

function reducer(state, action) {
  switch (action.type) {
    case "set": return { ...state, ...action.payload };
    case "upsertOne": {
      const { key, item } = action;
      const list = state[key] || [];
      const idx = list.findIndex(x => x.id === item.id);
      return { ...state, [key]: idx >= 0 ? list.map(x => x.id === item.id ? item : x) : [...list, item] };
    }
    case "removeOne":
      return { ...state, [action.key]: (state[action.key] || []).filter(x => x.id !== action.id) };
    case "replaceMany":
      return { ...state, [action.key]: action.items };
    default: return state;
  }
}

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [toasts, setToasts] = useState([]);
  const loadEpoch = useRef(0);
  const rolledFor = useRef(null); // дата, на которую уже перенесли просроченные задачи
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const batching = useRef(null);
  const writeAt = useRef(0); // время последнего изменения — защита от затирания перечиткой
  // Незавершённые создания: tmp-id → { alive, patch }. Пока задача вставляется,
  // правки по её временному id копятся в patch и докатываются после вставки.
  const pendingCreates = useRef(new Map());
  // Уже вставленные: tmp-id → настоящий uuid. Если форму открыли с временным id,
  // а вставка успела завершиться, поздняя правка уходит по реальному id.
  const tmpIdMap = useRef(new Map());
  const toastTimers = useRef(new Set()); // активные таймеры автоскрытия тостов — гасим при размонтировании

  useEffect(() => { applyTheme(state.theme); }, []);
  useEffect(() => () => { toastTimers.current.forEach(clearTimeout); toastTimers.current.clear(); }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      let user = null;
      try {
        const { data } = await supabase.auth.getSession();
        user = data.session?.user || null;
      } catch (e) {
        // База недоступна/тайм-аут — не зависаем на крутилке. Берём пользователя из
        // прошлой сессии (кэш в localStorage), чтобы показать сохранённые задачи.
        try {
          const raw = JSON.parse(localStorage.getItem("fin.auth") || "null");
          user = raw?.user || raw?.currentSession?.user || null;
        } catch (e2) {}
      }
      if (!active) return;
      if (user) {
        // Показываем интерфейс сразу после проверки входа, а задачи догружаем
        // фоном — чтобы не держать пользователя на белом экране, пока идёт сеть.
        dispatch({ type: "set", payload: { user, ready: true, loading: true } });
        loadAll();
      } else {
        dispatch({ type: "set", payload: { user, loading: false, ready: true } });
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // ВАЖНО: внутри этого колбэка нельзя синхронно обращаться к supabase.
      // На событии TOKEN_REFRESHED библиотека держит внутреннюю блокировку, и
      // запрос (loadAll → getSession) встаёт в реентрантную очередь, ожидая ту
      // же блокировку — вечный deadlock (форма «Сохранение…» крутится без конца,
      // задача не доезжает до сервера). Поэтому обновление токена игнорируем, а
      // перезагрузку данных откладываем через setTimeout — уже вне блокировки.
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return;
      const user = session?.user || null;
      dispatch({ type: "set", payload: { user, loading: !!user } });
      if (user) setTimeout(loadAll, 0);
      else {
        loadEpoch.current++;
        clearCache();
        dispatch({ type: "set", payload: { loading: false, ready: true, taskLists: [], tasks: [], areas: [] } });
      }
    });
    return () => { active = false; sub?.subscription?.unsubscribe(); };
  }, []);

  // Тихая дозагрузка при возврате в приложение/вкладку — чтобы видеть изменения
  // с других устройств (живой realtime-синхронизации нет). loadAll не показывает
  // «загрузку», просто подменяет данные свежими из базы.
  useEffect(() => {
    let last = 0;
    const refetch = () => {
      if (document.visibilityState !== "visible" || !state.user) return;
      const now = Date.now();
      if (now - last < 1500) return; // не дёргаем по дублю focus+visibility
      // Не перечитываем сразу после изменения: оптимистично созданная/изменённая
      // задача ещё может не доехать до БД, и перечитка затёрла бы её.
      if (now - writeAt.current < 4000) return;
      last = now;
      loadAll();
    };
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", refetch);
    };
  }, [state.user]);

  // Наступила полночь, пока приложение открыто — переносим просроченные задачи
  // на новый день (сбрасываем «уже переносили» и перечитываем).
  useEffect(() => {
    if (!state.user) return;
    let timer;
    const schedule = () => {
      const now = new Date();
      const next = new Date(now); next.setHours(24, 0, 5, 0);
      timer = setTimeout(() => { rolledFor.current = null; loadAll(); schedule(); }, next - now);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [state.user]);

  async function loadAll() {
    const myEpoch = ++loadEpoch.current;
    const tryOnce = () => Promise.all([
      supabase.from("lists").select("*").order("sort_order").order("created_at"),
      supabase.from("tasks").select("*"),
      supabase.from("areas").select("*").order("sort_order").order("created_at"),
    ]);
    let res = null, lastErr = null;
    // Несколько попыток с нарастающей паузой: первый запрос к Supabase часто
    // не доходит («холодный старт»/обрыв связи) — это НЕ значит, что таблиц нет.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await tryOnce();
        if (myEpoch !== loadEpoch.current) return;
        if (!r[0].error && !r[1].error) { res = r; lastErr = null; break; }
        lastErr = r[0].error || r[1].error;
      } catch (e) {
        if (myEpoch !== loadEpoch.current) return;
        lastErr = e;
      }
      // Таблиц реально нет — повторять бессмысленно.
      if (lastErr && /relation .*does not exist|relation ".*" does not exist/i.test(lastErr.message || "")) break;
      if (attempt < 3) { await new Promise(r => setTimeout(r, 600 * (attempt + 1))); if (myEpoch !== loadEpoch.current) return; }
    }
    if (!res) {
      dispatch({ type: "set", payload: { loading: false, ready: true } });
      const m = (lastErr && lastErr.message) || "";
      pushToast(/relation|does not exist/i.test(m) && !/schema cache/i.test(m)
        ? "Таблицы планера ещё не созданы в базе"
        : "Нет связи с базой. Обновите страницу и попробуйте снова.", "error");
      return;
    }
    const [listsRes, tasksRes, areasRes] = res;
    const lists = listsRes.data || [], rows = tasksRes.data || [];
    // Области добавлены позже задач — на старой базе их таблицы может не быть.
    const areas = areasRes.error ? [] : (areasRes.data || []);
    writeCache(lists, rows, areas);
    dispatch({
      type: "set",
      payload: { loading: false, ready: true, taskLists: lists, tasks: rows, areas },
    });
    rollOverdue(rows);
  }

  // Перенос: все невыполненные разовые ЗАДАЧИ с прошедших дней переезжают на
  // сегодня в раздел «весь день» (без времени). События (is_event) НЕ трогаем — у них
  // нет отметки «выполнено», они остаются на своём времени, пока их не двинут вручную.
  // Повторяющиеся и их исключения тоже не трогаем. Идемпотентно: за один день один раз.
  function rollOverdue(rows) {
    const today = todayISO();
    if (rolledFor.current === today) return;
    rolledFor.current = today;
    const overdue = (rows || []).filter(t =>
      !t.is_event && !t.recurrence && !t.recurrence_parent && !t.done && !t.deleted_at && t.date && t.date < today);
    if (!overdue.length) return;
    writeAt.current = Date.now();
    const patch = { start_min: null, duration_min: null };
    overdue.forEach(t => {
      dispatch({ type: "upsertOne", key: "tasks", item: { ...t, date: today, ...patch } });
      supabase.from("tasks").update({ date: today, ...patch }).eq("id", t.id).select().single()
        .then(({ data }) => { if (data) dispatch({ type: "upsertOne", key: "tasks", item: data }); });
    });
  }

  function pushToast(text, type = "info") {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, text, type }]);
    const tm = setTimeout(() => { toastTimers.current.delete(tm); setToasts(t => t.filter(x => x.id !== id)); }, 3000);
    toastTimers.current.add(tm);
  }

  // История действий: каждое запоминает, как его отменить (undo) и повторить
  // (redo). Новое действие очищает «будущее» (redo).
  // batch(label, fn): несколько изменений внутри fn становятся одним шагом отмены.
  function record(label, undo, redo) {
    if (batching.current) {
      batching.current.items.push({ undo, redo });
      if (!batching.current.label) batching.current.label = label;
      return;
    }
    undoStack.current.push({ label, undo, redo });
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
  }
  // Синхронная сборка: все записи истории, сделанные внутри fn() синхронно,
  // объединяются в один шаг отмены. (Асинхронные записи — напр. создание копий —
  // в пакет не попадают сознательно, чтобы не подмешать посторонние действия.)
  function batch(label, fn) {
    const prev = batching.current;
    batching.current = { items: [], label };
    try { fn(); } finally {
      const b = batching.current; batching.current = prev;
      if (b.items.length === 1) record(b.label, b.items[0].undo, b.items[0].redo);
      else if (b.items.length > 1) record(b.label,
        () => Promise.all(b.items.slice().reverse().map(it => it.undo())),
        () => Promise.all(b.items.map(it => it.redo())));
    }
  }
  // Стеки обновляем синхронно (UI меняется оптимистично), а запись в БД идёт
  // фоном. Так быстрый Cmd+Z → Cmd+Shift+Z не теряет шаг из-за сетевой задержки.
  function step(entry, run, fromStack, toStack, okLabel, errLabel) {
    writeAt.current = Date.now();
    toStack.current.push(entry);
    pushToast(okLabel + (entry.label ? ": " + entry.label : ""), "info");
    Promise.resolve().then(run).catch(() => {
      const i = toStack.current.lastIndexOf(entry);
      if (i >= 0) toStack.current.splice(i, 1);
      fromStack.current.push(entry);
      pushToast(errLabel, "error");
    });
  }
  function undo() {
    const entry = undoStack.current.pop();
    if (!entry) { pushToast("Отменять нечего", "info"); return; }
    step(entry, entry.undo, undoStack, redoStack, "Отменено", "Не удалось отменить действие");
  }
  function redo() {
    const entry = redoStack.current.pop();
    if (!entry) { pushToast("Повторять нечего", "info"); return; }
    step(entry, entry.redo, redoStack, undoStack, "Возвращено", "Не удалось повторить действие");
  }

  const auth = {
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    signUp: async (email, password) => {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
    },
    signOut: () => supabase.auth.signOut(),
  };

  function withUser(payload) { return { ...payload, user_id: state.user?.id }; }
  async function insertRow(table, payload, key) {
    const { data, error } = await supabase.from(table).insert(withUser(payload)).select().single();
    if (error) throw error;
    dispatch({ type: "upsertOne", key, item: data });
    return data;
  }
  async function updateRow(table, id, payload, key) {
    const { data, error } = await supabase.from(table).update(payload).eq("id", id).select().single();
    if (error) throw error;
    dispatch({ type: "upsertOne", key, item: data });
    return data;
  }
  async function deleteRow(table, id, key) {
    // Временные (оптимистичные) строки ещё не в базе — убираем только из стейта.
    if (typeof id === "string" && id.startsWith("tmp-")) { dispatch({ type: "removeOne", key, id }); return; }
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) throw error;
    dispatch({ type: "removeOne", key, id });
  }
  // Вернуть удалённую строку целиком (с тем же id) — для отмены удаления.
  async function reinsertRow(table, row, key) {
    const { data, error } = await supabase.from(table).insert(row).select().single();
    if (error) throw error;
    dispatch({ type: "upsertOne", key, item: data });
    return data;
  }

  const taskLists = {
    // Оптимистично: проект появляется/меняется сразу, форма закрывается мгновенно.
    // Запись в базу идёт в фоне, при ошибке — откат и тост. Защищает от редких
    // «зависаний» сетевого ответа (форма не застревает на «Сохранение…»).
    create: (payload) => {
      const tempId = "tmp-" + Math.random().toString(36).slice(2);
      const optimistic = { sort_order: state.taskLists.length, ...payload, id: tempId, user_id: state.user?.id };
      dispatch({ type: "upsertOne", key: "taskLists", item: optimistic });
      supabase.from("lists").insert(withUser({ sort_order: state.taskLists.length, ...payload })).select().single()
        .then(({ data, error }) => {
          dispatch({ type: "removeOne", key: "taskLists", id: tempId });
          if (error || !data) { pushToast("Не удалось сохранить проект", "error"); return; }
          dispatch({ type: "upsertOne", key: "taskLists", item: data });
        })
        .catch(() => { dispatch({ type: "removeOne", key: "taskLists", id: tempId }); pushToast("Не удалось сохранить проект", "error"); });
      return Promise.resolve(optimistic);
    },
    update: (id, payload) => {
      const prev = state.taskLists.find(l => l.id === id);
      if (prev) dispatch({ type: "upsertOne", key: "taskLists", item: { ...prev, ...payload } });
      supabase.from("lists").update(payload).eq("id", id).select().single()
        .then(({ data, error }) => {
          if (error || !data) { if (prev) dispatch({ type: "upsertOne", key: "taskLists", item: prev }); pushToast("Не удалось сохранить проект", "error"); return; }
          dispatch({ type: "upsertOne", key: "taskLists", item: data });
        })
        .catch(() => { if (prev) dispatch({ type: "upsertOne", key: "taskLists", item: prev }); pushToast("Не удалось сохранить проект", "error"); });
      return Promise.resolve();
    },
    // Удаление проекта: его задачи переезжают в проект moveTo (id) либо во
    // «Входящие» (moveTo == null). В базе чиним строки одним апдейтом по list_id.
    remove: async (id, moveTo = null) => {
      const affected = state.tasks.filter(t => t.list_id === id);
      dispatch({ type: "replaceMany", key: "tasks",
        items: state.tasks.map(t => t.list_id === id ? { ...t, list_id: moveTo, area_id: null } : t) });
      await deleteRow("lists", id, "taskLists");
      if (affected.length) supabase.from("tasks").update({ list_id: moveTo, area_id: null }).eq("list_id", id);
    },
  };

  // Области — верхний уровень группировки проектов. Оптимистично, как проекты.
  const areas = {
    create: (payload) => {
      const tempId = "tmp-" + Math.random().toString(36).slice(2);
      const optimistic = { sort_order: state.areas.length, ...payload, id: tempId, user_id: state.user?.id };
      dispatch({ type: "upsertOne", key: "areas", item: optimistic });
      supabase.from("areas").insert(withUser({ sort_order: state.areas.length, ...payload })).select().single()
        .then(({ data, error }) => {
          dispatch({ type: "removeOne", key: "areas", id: tempId });
          if (error || !data) { pushToast("Не удалось сохранить область", "error"); return; }
          dispatch({ type: "upsertOne", key: "areas", item: data });
        })
        .catch(() => { dispatch({ type: "removeOne", key: "areas", id: tempId }); pushToast("Не удалось сохранить область", "error"); });
      return Promise.resolve(optimistic);
    },
    update: (id, payload) => {
      const prev = state.areas.find(a => a.id === id);
      if (prev) dispatch({ type: "upsertOne", key: "areas", item: { ...prev, ...payload } });
      supabase.from("areas").update(payload).eq("id", id).select().single()
        .then(({ data, error }) => {
          if (error || !data) { if (prev) dispatch({ type: "upsertOne", key: "areas", item: prev }); pushToast("Не удалось сохранить область", "error"); return; }
          dispatch({ type: "upsertOne", key: "areas", item: data });
        })
        .catch(() => { if (prev) dispatch({ type: "upsertOne", key: "areas", item: prev }); pushToast("Не удалось сохранить область", "error"); });
      return Promise.resolve();
    },
    // Удаление области: её проекты становятся «без области» (area_id = null),
    // задачи, висевшие прямо на области, уезжают во «Входящие».
    remove: async (id) => {
      dispatch({ type: "replaceMany", key: "taskLists",
        items: state.taskLists.map(l => l.area_id === id ? { ...l, area_id: null } : l) });
      dispatch({ type: "replaceMany", key: "tasks",
        items: state.tasks.map(t => t.area_id === id ? { ...t, area_id: null } : t) });
      await deleteRow("areas", id, "areas");
      supabase.from("lists").update({ area_id: null }).eq("area_id", id);
      supabase.from("tasks").update({ area_id: null }).eq("area_id", id);
    },
  };

  // Создаём «исключение» повторяющейся задачи. Оптимистично: сразу кладём
  // временную строку в state (UI реагирует мгновенно), затем заменяем её
  // настоящей из БД; при ошибке временную убираем.
  function materializeOverride(item, patch, label) {
    const tmpl = state.tasks.find(t => t.id === item.templateId);
    if (!tmpl) return Promise.resolve(null);
    // Шаблон ещё вставляется — recurrence_parent был бы временным id (uuid-ошибка).
    if (typeof tmpl.id === "string" && tmpl.id.startsWith("tmp-")) return Promise.resolve(null);
    const row = {
      list_id: tmpl.list_id || null, title: tmpl.title, notes: tmpl.notes || null,
      color: tmpl.color || null, icon: tmpl.icon || null, date: item.occDate,
      start_min: tmpl.start_min, duration_min: tmpl.duration_min,
      done: false, recurrence: null, recurrence_parent: tmpl.id,
      occ_date: item.occDate, skipped: false, ...patch,
    };
    const tempId = "tmp-" + Math.random().toString(36).slice(2);
    dispatch({ type: "upsertOne", key: "tasks", item: { ...row, id: tempId, user_id: state.user?.id } });
    const ref = { id: tempId, alive: true };
    // История пишется СИНХРОННО (до ответа сервера) — строгий порядок отмены.
    if (label) record(label,
      () => { ref.alive = false; return deleteRow("tasks", ref.id, "tasks"); },
      () => { ref.alive = true; return supabase.from("tasks").insert(withUser(row)).select().single()
        .then(({ data }) => { if (data) { dispatch({ type: "upsertOne", key: "tasks", item: data }); ref.id = data.id; } }); });
    return supabase.from("tasks").insert(withUser(row)).select().single()
      .then(({ data, error }) => {
        dispatch({ type: "removeOne", key: "tasks", id: tempId });
        if (error) throw error;
        if (!ref.alive) { supabase.from("tasks").delete().eq("id", data.id); return null; }
        dispatch({ type: "upsertOne", key: "tasks", item: data });
        ref.id = data.id;
        return data;
      });
  }

  // Оптимистичное обновление задачи: применяем изменения к state сразу,
  // в фоне пишем в БД, при ошибке откатываем.
  function updateTaskOptimistic(id, payload) {
    const prev = state.tasks.find(t => t.id === id);
    if (prev) dispatch({ type: "upsertOne", key: "tasks", item: { ...prev, ...payload } });
    return supabase.from("tasks").update(payload).eq("id", id)
      .then(({ error }) => {
        if (error) { if (prev) dispatch({ type: "upsertOne", key: "tasks", item: prev }); throw error; }
        // НЕ перезаписываем state серверным ответом: оптимистичное значение уже верное,
        // а при быстрых повторных правках (drag / Shift+стрелки) поздний ответ устаревает
        // и вызвал бы «прыжок» задачи назад. Ошибку по-прежнему откатываем на prev.
      });
  }

  const tasks = {
    create: (payload) => {
      // Оптимистично: задача появляется сразу. В историю пишем СИНХРОННО (до
      // ответа сервера), иначе быстрый Cmd+Z отменил бы предыдущее действие.
      const tempId = "tmp-" + Math.random().toString(36).slice(2);
      const optimistic = {
        done: false, recurrence_parent: null, occ_date: null, skipped: false, subtasks: [],
        ...payload, id: tempId, user_id: state.user?.id,
      };
      dispatch({ type: "upsertOne", key: "tasks", item: optimistic });
      const ref = { id: tempId, alive: true, patch: null };
      pendingCreates.current.set(tempId, ref);
      record("новая задача",
        () => { ref.alive = false; return deleteRow("tasks", ref.id, "tasks"); },
        () => { ref.alive = true; return supabase.from("tasks").insert(withUser(payload)).select().single()
          .then(({ data }) => { if (data) { dispatch({ type: "upsertOne", key: "tasks", item: data }); ref.id = data.id; } }); });
      return supabase.from("tasks").insert(withUser(payload)).select().single()
        .then(({ data, error }) => {
          pendingCreates.current.delete(tempId);
          dispatch({ type: "removeOne", key: "tasks", id: tempId });
          // Ошибку НЕ показываем тут — пробрасываем, чтобы её обработал вызвавший
          // (форма покажет понятное сообщение и не закроется как при успехе).
          if (error || !data) throw (error || new Error("Не удалось сохранить"));
          // Создание уже отменили, пока шёл запрос — удаляем вставленную строку.
          if (!ref.alive) { supabase.from("tasks").delete().eq("id", data.id); return null; }
          ref.id = data.id;
          tmpIdMap.current.set(tempId, data.id);
          setTimeout(() => tmpIdMap.current.delete(tempId), 30000);
          // Правки, сделанные пока задача ещё вставлялась (id был временным),
          // докатываем настоящим UPDATE по реальному id.
          if (ref.patch) {
            const patch = ref.patch; ref.patch = null;
            dispatch({ type: "upsertOne", key: "tasks", item: { ...data, ...patch } });
            supabase.from("tasks").update(patch).eq("id", data.id).select().single()
              .then(({ data: d2 }) => { if (d2) dispatch({ type: "upsertOne", key: "tasks", item: d2 }); });
            return { ...data, ...patch };
          }
          dispatch({ type: "upsertOne", key: "tasks", item: data });
          return data;
        })
        .catch((e) => { pendingCreates.current.delete(tempId); dispatch({ type: "removeOne", key: "tasks", id: tempId }); throw e; });
    },
    update: (id, payload) => {
      // UPDATE по временному id упал бы с ошибкой uuid.
      if (typeof id === "string" && id.startsWith("tmp-")) {
        const ref = pendingCreates.current.get(id);
        if (ref) {
          // Ещё вставляется — правим локально и копим патч (докатится после вставки).
          const prev = state.tasks.find(t => t.id === id);
          if (prev) dispatch({ type: "upsertOne", key: "tasks", item: { ...prev, ...payload } });
          ref.patch = { ...(ref.patch || {}), ...payload };
          return Promise.resolve();
        }
        const real = tmpIdMap.current.get(id);
        if (real) id = real; // уже вставилась — правим по настоящему id
        else {
          // Вставка не удалась (строки в базе нет) — применяем только локально.
          const prev = state.tasks.find(t => t.id === id);
          if (prev) dispatch({ type: "upsertOne", key: "tasks", item: { ...prev, ...payload } });
          return Promise.resolve();
        }
      }
      const prev = state.tasks.find(t => t.id === id);
      if (prev) {
        const restore = {};
        Object.keys(payload).forEach(k => { restore[k] = prev[k] === undefined ? null : prev[k]; });
        record("изменение задачи",
          () => updateTaskOptimistic(id, restore),
          () => updateTaskOptimistic(id, payload));
      }
      return updateTaskOptimistic(id, payload);
    },
    // Удаление = в корзину (мягко): ставим deleted_at, строка остаётся в базе и
    // в стейте, но из сетки/панели/поиска исчезает (везде фильтр !deleted_at).
    // Отмена возвращает её, восстановление из корзины — тоже снимает deleted_at.
    remove: (id) => {
      // Незавершённая (tmp) задача в базу ещё не попала — просто убираем из стейта.
      if (typeof id === "string" && id.startsWith("tmp-")) return deleteRow("tasks", id, "tasks");
      const at = new Date().toISOString();
      const prev = state.tasks.find(t => t.id === id);
      if (prev) record("удаление задачи",
        () => updateTaskOptimistic(id, { deleted_at: null }),
        () => updateTaskOptimistic(id, { deleted_at: at }));
      return updateTaskOptimistic(id, { deleted_at: at });
    },
    // Вернуть из корзины.
    restore: (id) => updateTaskOptimistic(id, { deleted_at: null }),
    // Удалить из корзины навсегда (жёстко из базы).
    purge: (id) => deleteRow("tasks", id, "tasks"),
    // Очистить корзину целиком.
    emptyTrash: async () => {
      const trashed = state.tasks.filter(t => t.deleted_at);
      trashed.forEach(t => dispatch({ type: "removeOne", key: "tasks", id: t.id }));
      if (trashed.length) await supabase.from("tasks").delete().not("deleted_at", "is", null);
    },
    // Отметить/снять подзадачу прямо в сетке (без открытия редактора).
    toggleSub: (taskId, subId) => {
      const t = state.tasks.find(x => x.id === taskId);
      if (!t) return Promise.resolve();
      const subs = (Array.isArray(t.subtasks) ? t.subtasks : []).map(s => s.id === subId ? { ...s, done: !s.done } : s);
      return tasks.update(taskId, { subtasks: subs });
    },
    // Изменить поля подзадачи (напр. название) прямо в сетке.
    updateSub: (taskId, subId, patch) => {
      const t = state.tasks.find(x => x.id === taskId);
      if (!t) return Promise.resolve();
      const subs = (Array.isArray(t.subtasks) ? t.subtasks : []).map(s => s.id === subId ? { ...s, ...patch } : s);
      return tasks.update(taskId, { subtasks: subs });
    },
    toggleDone: (item) => {
      const next = !item.done;
      const patch = { done: next, done_at: next ? new Date().toISOString() : null };
      // Ещё не вставленная задача (временный id) — через защищённый update.
      if (typeof item.id === "string" && item.id.startsWith("tmp-")) return tasks.update(item.id, patch);
      if (!(item.kind === "concrete" || item.id)) {
        return materializeOverride(item, patch, "отметку");
      }
      const prev = state.tasks.find(t => t.id === item.id);
      if (prev) {
        dispatch({ type: "upsertOne", key: "tasks", item: { ...prev, ...patch } });
        const restore = { done: prev.done, done_at: prev.done_at === undefined ? null : prev.done_at };
        record("отметку",
          () => updateTaskOptimistic(item.id, restore),
          () => updateTaskOptimistic(item.id, patch));
      }
      return supabase.from("tasks").update(patch).eq("id", item.id).select().single()
        .then(({ data, error }) => {
          if (error) { if (prev) dispatch({ type: "upsertOne", key: "tasks", item: prev }); throw error; }
          dispatch({ type: "upsertOne", key: "tasks", item: data });
        });
    },
    reschedule: (item, patch) => {
      if (item.kind === "concrete" || item.id) return tasks.update(item.id, patch);
      return materializeOverride(item, patch, "перенос");
    },
    removeOccurrence: (item) => {
      if (item.id) return tasks.update(item.id, { skipped: true });
      return materializeOverride(item, { skipped: true }, "удаление повторения");
    },
    removeSeries: async (templateId) => {
      const removed = state.tasks.filter(t => t.id === templateId || t.recurrence_parent === templateId);
      const tmpl = removed.find(r => r.id === templateId);
      const overrides = removed.filter(r => r.id !== templateId);
      const doRemove = async () => {
        await deleteRow("tasks", templateId, "tasks");
        overrides.forEach(r => dispatch({ type: "removeOne", key: "tasks", id: r.id }));
      };
      await doRemove();
      record("удаление повторов",
        async () => { if (tmpl) await reinsertRow("tasks", tmpl, "tasks"); overrides.forEach(r => dispatch({ type: "upsertOne", key: "tasks", item: r })); },
        doRemove);
    },
  };

  function setTheme(mode) {
    applyTheme(mode);
    dispatch({ type: "set", payload: { theme: mode } });
  }

  // Каждое действие помечает время изменения — чтобы фоновая перечитка не
  // затёрла только что созданную/изменённую задачу (см. refetch выше).
  const markWrites = (obj) => Object.fromEntries(
    Object.entries(obj).map(([k, fn]) => [k, (...a) => { writeAt.current = Date.now(); return fn(...a); }]));
  const value = { ...state, toasts, pushToast, undo, redo, batch, auth, setTheme,
    actions: { taskLists: markWrites(taskLists), tasks: markWrites(tasks), areas: markWrites(areas) } };
  return h(StoreContext.Provider, { value }, children);
}

export function useStore() { return useContext(StoreContext); }
