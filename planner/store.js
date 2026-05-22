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

  useEffect(() => { applyTheme(state.theme); }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      const user = data.session?.user || null;
      dispatch({ type: "set", payload: { user } });
      if (user) await loadAll();
      else dispatch({ type: "set", payload: { loading: false, ready: true } });
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
  function record(label, undo, redo) {
    undoStack.current.push({ label, undo, redo });
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
  }
  async function undo() {
    const entry = undoStack.current.pop();
    if (!entry) { pushToast("Отменять нечего", "info"); return; }
    try { await entry.undo(); redoStack.current.push(entry); pushToast("Отменено" + (entry.label ? ": " + entry.label : ""), "info"); }
    catch (e) { pushToast("Не удалось отменить действие", "error"); }
  }
  async function redo() {
    const entry = redoStack.current.pop();
    if (!entry) { pushToast("Повторять нечего", "info"); return; }
    try { await entry.redo(); undoStack.current.push(entry); pushToast("Возвращено" + (entry.label ? ": " + entry.label : ""), "info"); }
    catch (e) { pushToast("Не удалось повторить действие", "error"); }
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
    create: (payload) => insertRow("lists", { sort_order: state.taskLists.length, ...payload }, "taskLists"),
    update: (id, payload) => updateRow("lists", id, payload, "taskLists"),
    remove: async (id) => {
      await deleteRow("lists", id, "taskLists");
      dispatch({ type: "replaceMany", key: "tasks",
        items: state.tasks.map(t => t.list_id === id ? { ...t, list_id: null } : t) });
    },
  };

  // Создаём «исключение» повторяющейся задачи. Оптимистично: сразу кладём
  // временную строку в state (UI реагирует мгновенно), затем заменяем её
  // настоящей из БД; при ошибке временную убираем.
  function materializeOverride(item, patch) {
    const tmpl = state.tasks.find(t => t.id === item.templateId);
    if (!tmpl) return Promise.resolve();
    const row = {
      list_id: tmpl.list_id || null, title: tmpl.title, notes: tmpl.notes || null,
      color: tmpl.color || null, date: item.occDate,
      start_min: tmpl.start_min, duration_min: tmpl.duration_min,
      done: false, recurrence: null, recurrence_parent: tmpl.id,
      occ_date: item.occDate, skipped: false, ...patch,
    };
    const tempId = "tmp-" + Math.random().toString(36).slice(2);
    dispatch({ type: "upsertOne", key: "tasks", item: { ...row, id: tempId, user_id: state.user?.id } });
    return supabase.from("tasks").insert(withUser(row)).select().single()
      .then(({ data, error }) => {
        dispatch({ type: "removeOne", key: "tasks", id: tempId });
        if (error) throw error;
        dispatch({ type: "upsertOne", key: "tasks", item: data });
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
      // Оптимистично: задача появляется сразу, форма закрывается мгновенно.
      // Запись в базу идёт в фоне; при ошибке — откат и тост. Это защищает от
      // редких «зависаний» сетевого запроса (форма не застревает на «Сохранение…»).
      const tempId = "tmp-" + Math.random().toString(36).slice(2);
      const optimistic = {
        done: false, recurrence_parent: null, occ_date: null, skipped: false,
        ...payload, id: tempId, user_id: state.user?.id,
      };
      dispatch({ type: "upsertOne", key: "tasks", item: optimistic });
      supabase.from("tasks").insert(withUser(payload)).select().single()
        .then(({ data, error }) => {
          dispatch({ type: "removeOne", key: "tasks", id: tempId });
          if (error || !data) { pushToast("Не удалось сохранить задачу", "error"); return; }
          dispatch({ type: "upsertOne", key: "tasks", item: data });
          record("новая задача",
            () => deleteRow("tasks", data.id, "tasks"),
            () => reinsertRow("tasks", data, "tasks"));
        })
        .catch(() => { dispatch({ type: "removeOne", key: "tasks", id: tempId }); pushToast("Не удалось сохранить задачу", "error"); });
      return Promise.resolve(optimistic);
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
        return materializeOverride(item, patch).then(data => {
          if (data) record("отметку",
            () => deleteRow("tasks", data.id, "tasks"),
            () => reinsertRow("tasks", data, "tasks"));
          return data;
        });
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
      return materializeOverride(item, patch).then(data => {
        if (data) record("перенос",
          () => deleteRow("tasks", data.id, "tasks"),
          () => reinsertRow("tasks", data, "tasks"));
        return data;
      });
    },
    removeOccurrence: (item) => {
      if (item.id) return tasks.update(item.id, { skipped: true });
      return materializeOverride(item, { skipped: true }).then(data => {
        if (data) record("удаление повторения",
          () => deleteRow("tasks", data.id, "tasks"),
          () => reinsertRow("tasks", data, "tasks"));
        return data;
      });
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

  const value = { ...state, toasts, pushToast, undo, redo, auth, setTheme, actions: { taskLists, tasks } };
  return h(StoreContext.Provider, { value }, children);
}

export function useStore() { return useContext(StoreContext); }
