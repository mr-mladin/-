// Состояние планера: авторизация, списки и задачи. Самостоятельный стор,
// по структуре повторяет финансовое приложение, но содержит только планер.

import { createContext, h } from "preact";
import { useContext, useEffect, useReducer, useRef, useState } from "preact/hooks";
import { supabase, applyTheme } from "./lib.js";

const StoreContext = createContext(null);

const initialState = {
  loading: true,
  ready: false,
  user: null,
  taskLists: [],
  tasks: [],
  theme: readTheme(),
};

function readTheme() {
  try { return localStorage.getItem("planner.theme") || "auto"; } catch (e) { return "auto"; }
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
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const batching = useRef(null);

  useEffect(() => { applyTheme(state.theme); }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      const user = data.session?.user || null;
      if (user) {
        // Показываем интерфейс сразу после проверки входа, а задачи догружаем
        // фоном — чтобы не держать пользователя на белом экране, пока идёт сеть.
        dispatch({ type: "set", payload: { user, ready: true, loading: true } });
        loadAll();
      } else {
        dispatch({ type: "set", payload: { user, loading: false, ready: true } });
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      const user = session?.user || null;
      dispatch({ type: "set", payload: { user, loading: !!user } });
      if (user) await loadAll();
      else {
        loadEpoch.current++;
        dispatch({ type: "set", payload: { loading: false, ready: true, taskLists: [], tasks: [] } });
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

  async function loadAll() {
    const myEpoch = ++loadEpoch.current;
    try {
      const [listsRes, tasksRes] = await Promise.all([
        supabase.from("lists").select("*").order("sort_order").order("created_at"),
        supabase.from("tasks").select("*"),
      ]);
      if (myEpoch !== loadEpoch.current) return;
      if (listsRes.error || tasksRes.error) {
        dispatch({ type: "set", payload: { loading: false, ready: true } });
        pushToast("Таблицы планера ещё не созданы в базе", "error");
        return;
      }
      dispatch({
        type: "set",
        payload: { loading: false, ready: true, taskLists: listsRes.data || [], tasks: tasksRes.data || [] },
      });
    } catch (e) {
      if (myEpoch !== loadEpoch.current) return;
      dispatch({ type: "set", payload: { loading: false, ready: true } });
      pushToast("Не удалось загрузить данные", "error");
    }
  }

  function pushToast(text, type = "info") {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, text, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
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
    remove: async (id) => {
      await deleteRow("lists", id, "taskLists");
      dispatch({ type: "replaceMany", key: "tasks",
        items: state.tasks.map(t => t.list_id === id ? { ...t, list_id: null } : t) });
    },
  };

  // Создаём «исключение» повторяющейся задачи. Оптимистично: сразу кладём
  // временную строку в state (UI реагирует мгновенно), затем заменяем её
  // настоящей из БД; при ошибке временную убираем.
  function materializeOverride(item, patch, label) {
    const tmpl = state.tasks.find(t => t.id === item.templateId);
    if (!tmpl) return Promise.resolve(null);
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
    return supabase.from("tasks").update(payload).eq("id", id).select().single()
      .then(({ data, error }) => {
        if (error) { if (prev) dispatch({ type: "upsertOne", key: "tasks", item: prev }); throw error; }
        dispatch({ type: "upsertOne", key: "tasks", item: data });
        return data;
      });
  }

  const tasks = {
    create: (payload) => {
      // Оптимистично: задача появляется сразу. В историю пишем СИНХРОННО (до
      // ответа сервера), иначе быстрый Cmd+Z отменил бы предыдущее действие.
      const tempId = "tmp-" + Math.random().toString(36).slice(2);
      const optimistic = {
        done: false, recurrence_parent: null, occ_date: null, skipped: false,
        ...payload, id: tempId, user_id: state.user?.id,
      };
      dispatch({ type: "upsertOne", key: "tasks", item: optimistic });
      const ref = { id: tempId, alive: true };
      record("новая задача",
        () => { ref.alive = false; return deleteRow("tasks", ref.id, "tasks"); },
        () => { ref.alive = true; return supabase.from("tasks").insert(withUser(payload)).select().single()
          .then(({ data }) => { if (data) { dispatch({ type: "upsertOne", key: "tasks", item: data }); ref.id = data.id; } }); });
      return supabase.from("tasks").insert(withUser(payload)).select().single()
        .then(({ data, error }) => {
          dispatch({ type: "removeOne", key: "tasks", id: tempId });
          if (error || !data) { pushToast("Не удалось сохранить задачу", "error"); return null; }
          // Создание уже отменили, пока шёл запрос — удаляем вставленную строку.
          if (!ref.alive) { supabase.from("tasks").delete().eq("id", data.id); return null; }
          dispatch({ type: "upsertOne", key: "tasks", item: data });
          ref.id = data.id;
          return data;
        })
        .catch(() => { dispatch({ type: "removeOne", key: "tasks", id: tempId }); pushToast("Не удалось сохранить задачу", "error"); return null; });
    },
    update: (id, payload) => {
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
    remove: (id) => {
      const prev = state.tasks.find(t => t.id === id);
      if (prev) record("удаление задачи",
        () => reinsertRow("tasks", prev, "tasks"),
        () => deleteRow("tasks", id, "tasks"));
      return deleteRow("tasks", id, "tasks");
    },
    toggleDone: (item) => {
      const next = !item.done;
      const patch = { done: next, done_at: next ? new Date().toISOString() : null };
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

  const value = { ...state, toasts, pushToast, undo, redo, batch, auth, setTheme, actions: { taskLists, tasks } };
  return h(StoreContext.Provider, { value }, children);
}

export function useStore() { return useContext(StoreContext); }
