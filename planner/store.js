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

  const taskLists = {
    create: (payload) => insertRow("lists", { sort_order: state.taskLists.length, ...payload }, "taskLists"),
    update: (id, payload) => updateRow("lists", id, payload, "taskLists"),
    remove: async (id) => {
      await deleteRow("lists", id, "taskLists");
      dispatch({ type: "replaceMany", key: "tasks",
        items: state.tasks.map(t => t.list_id === id ? { ...t, list_id: null } : t) });
    },
  };

  async function materializeOverride(item, patch) {
    const tmpl = state.tasks.find(t => t.id === item.templateId);
    if (!tmpl) return;
    return insertRow("tasks", {
      list_id: tmpl.list_id || null, title: tmpl.title, notes: tmpl.notes || null,
      color: tmpl.color || null, date: item.occDate,
      start_min: tmpl.start_min, duration_min: tmpl.duration_min,
      done: false, recurrence: null, recurrence_parent: tmpl.id,
      occ_date: item.occDate, skipped: false, ...patch,
    }, "tasks");
  }

  const tasks = {
    create: (payload) => insertRow("tasks", payload, "tasks"),
    update: (id, payload) => updateRow("tasks", id, payload, "tasks"),
    remove: (id) => deleteRow("tasks", id, "tasks"),
    toggleDone: (item) => {
      const next = !item.done;
      const patch = { done: next, done_at: next ? new Date().toISOString() : null };
      if (!(item.kind === "concrete" || item.id)) return materializeOverride(item, patch);
      const prev = state.tasks.find(t => t.id === item.id);
      if (prev) dispatch({ type: "upsertOne", key: "tasks", item: { ...prev, ...patch } });
      return supabase.from("tasks").update(patch).eq("id", item.id).select().single()
        .then(({ data, error }) => {
          if (error) { if (prev) dispatch({ type: "upsertOne", key: "tasks", item: prev }); throw error; }
          dispatch({ type: "upsertOne", key: "tasks", item: data });
        });
    },
    reschedule: (item, patch) => {
      if (item.kind === "concrete" || item.id) return tasks.update(item.id, patch);
      return materializeOverride(item, patch);
    },
    removeOccurrence: (item) => {
      if (item.id) return tasks.update(item.id, { skipped: true });
      return materializeOverride(item, { skipped: true });
    },
    removeSeries: async (templateId) => {
      await deleteRow("tasks", templateId, "tasks");
      dispatch({ type: "replaceMany", key: "tasks",
        items: state.tasks.filter(t => t.id !== templateId && t.recurrence_parent !== templateId) });
    },
  };

  function setTheme(mode) {
    applyTheme(mode);
    dispatch({ type: "set", payload: { theme: mode } });
  }

  const value = { ...state, toasts, pushToast, auth, setTheme, actions: { taskLists, tasks } };
  return h(StoreContext.Provider, { value }, children);
}

export function useStore() { return useContext(StoreContext); }
