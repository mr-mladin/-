// Глобальное состояние через React-context.
// Хранит загруженные таблицы и предоставляет CRUD-функции.
// При изменении данных обновляет локальный кэш — без полной перезагрузки.

import { createContext, h } from "preact";
import { useContext, useEffect, useReducer, useState } from "preact/hooks";
import { supabase } from "./supabase.js";

const StoreContext = createContext(null);

const initialState = {
  loading: true,
  ready: false,
  user: null,
  profile: null,
  accounts: [],
  categories: [],
  tags: [],
  operations: [],
  operationTags: [],   // [{ operation_id, tag_id }]
  budgets: [],
  goals: [],
  toast: null,
};

function reducer(state, action) {
  switch (action.type) {
    case "set": return { ...state, ...action.payload };
    case "upsertOne": {
      const { key, item } = action;
      const list = state[key] || [];
      const idx = list.findIndex(x => x.id === item.id);
      const next = idx >= 0
        ? list.map(x => x.id === item.id ? item : x)
        : [...list, item];
      return { ...state, [key]: next };
    }
    case "removeOne": {
      const { key, id } = action;
      return { ...state, [key]: (state[key] || []).filter(x => x.id !== id) };
    }
    case "replaceMany": {
      const { key, items } = action;
      return { ...state, [key]: items };
    }
    case "setOpTagsForOp": {
      const { opId, tagIds } = action;
      const others = state.operationTags.filter(ot => ot.operation_id !== opId);
      const adds = tagIds.map(tag_id => ({ operation_id: opId, tag_id }));
      return { ...state, operationTags: [...others, ...adds] };
    }
    case "removeOpTagsForOp": {
      const { opId } = action;
      return { ...state, operationTags: state.operationTags.filter(ot => ot.operation_id !== opId) };
    }
    default: return state;
  }
}

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [toasts, setToasts] = useState([]);

  // ---- Auth listener
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      const user = data.session?.user || null;
      dispatch({ type: "set", payload: { user } });
      if (user) await loadAll(user.id);
      else dispatch({ type: "set", payload: { loading: false, ready: true } });
    })();
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      const user = session?.user || null;
      dispatch({ type: "set", payload: { user, loading: !!user } });
      if (user) await loadAll(user.id);
      else dispatch({
        type: "set",
        payload: {
          loading: false, ready: true, profile: null,
          accounts: [], categories: [], tags: [], operations: [],
          operationTags: [], budgets: [], goals: [],
        }
      });
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  // Загрузить всё
  async function loadAll(userId) {
    try {
      const [profileRes, accountsRes, categoriesRes, tagsRes, opsRes, opTagsRes, budgetsRes, goalsRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("accounts").select("*").order("sort_order").order("created_at"),
        supabase.from("categories").select("*").order("sort_order").order("created_at"),
        supabase.from("tags").select("*").order("sort_order").order("name"),
        supabase.from("operations").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }),
        supabase.from("operation_tags").select("*"),
        supabase.from("budgets").select("*"),
        supabase.from("goals").select("*").order("sort_order").order("created_at"),
      ]);

      let profile = profileRes.data;
      if (!profile) {
        // На случай отсутствия (если триггер не сработал у старого юзера)
        const { data: ins } = await supabase.from("profiles").insert({ user_id: userId }).select().single();
        profile = ins;
      }

      // Применим тему сразу
      applyTheme(profile?.theme || "auto");

      dispatch({
        type: "set",
        payload: {
          loading: false, ready: true,
          profile,
          accounts: accountsRes.data || [],
          categories: categoriesRes.data || [],
          tags: tagsRes.data || [],
          operations: opsRes.data || [],
          operationTags: opTagsRes.data || [],
          budgets: budgetsRes.data || [],
          goals: goalsRes.data || [],
        }
      });

      // Если у пользователя нет ни одной категории — создаём базовые
      if ((categoriesRes.data || []).length === 0) {
        await seedDefaultCategories(userId);
      }
    } catch (e) {
      console.error(e);
      dispatch({ type: "set", payload: { loading: false, ready: true } });
      pushToast("Не удалось загрузить данные", "error");
    }
  }

  async function seedDefaultCategories(userId) {
    const expense = [
      { name: "Продукты", color: "#10b981", icon: "tag" },
      { name: "Транспорт", color: "#0ea5e9", icon: "tag" },
      { name: "Кафе и рестораны", color: "#f59e0b", icon: "tag" },
      { name: "Жильё", color: "#8b5cf6", icon: "tag" },
      { name: "Связь", color: "#ec4899", icon: "tag" },
      { name: "Здоровье", color: "#ef4444", icon: "tag" },
      { name: "Развлечения", color: "#f97316", icon: "tag" },
      { name: "Одежда", color: "#06b6d4", icon: "tag" },
      { name: "Другое", color: "#94a3b8", icon: "tag" },
    ];
    const income = [
      { name: "Зарплата", color: "#10b981", icon: "tag" },
      { name: "Подработки", color: "#22c55e", icon: "tag" },
      { name: "Подарки", color: "#a855f7", icon: "tag" },
      { name: "Другое", color: "#94a3b8", icon: "tag" },
    ];
    const rows = [
      ...expense.map((c, i) => ({ ...c, kind: "expense", user_id: userId, sort_order: i })),
      ...income.map((c, i) => ({ ...c, kind: "income", user_id: userId, sort_order: i })),
    ];
    const { data, error } = await supabase.from("categories").insert(rows).select();
    if (!error && data) dispatch({ type: "replaceMany", key: "categories", items: data });
  }

  function pushToast(text, type = "info") {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, text, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  }

  // ---------- AUTH ----------
  const auth = {
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    signUp: async (email, password) => {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  // ---------- Универсальные обёртки CRUD ----------
  function withUser(payload) {
    return { ...payload, user_id: state.user?.id };
  }

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

  // ---------- Accounts ----------
  const accounts = {
    create: (payload) => insertRow("accounts", { sort_order: state.accounts.length, ...payload }, "accounts"),
    update: (id, payload) => updateRow("accounts", id, payload, "accounts"),
    remove: (id) => deleteRow("accounts", id, "accounts"),
    move: async (id, delta) => {
      const list = [...state.accounts].filter(a => !a.archived).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      const i = list.findIndex(x => x.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      const updates = list.map((x, idx) => ({ id: x.id, sort_order: idx }));
      for (const u of updates) await updateRow("accounts", u.id, { sort_order: u.sort_order }, "accounts");
    },
  };

  // ---------- Categories ----------
  const categories = {
    create: (payload) => {
      const sibling = state.categories.filter(c =>
        c.kind === payload.kind && (c.parent_id || null) === (payload.parent_id || null)
      );
      return insertRow("categories", { sort_order: sibling.length, ...payload }, "categories");
    },
    update: (id, payload) => updateRow("categories", id, payload, "categories"),
    remove: (id) => deleteRow("categories", id, "categories"),
    move: async (id, delta) => {
      const cur = state.categories.find(c => c.id === id);
      if (!cur) return;
      const siblings = state.categories
        .filter(c => c.kind === cur.kind && (c.parent_id || null) === (cur.parent_id || null))
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      const i = siblings.findIndex(x => x.id === id);
      const j = i + delta;
      if (j < 0 || j >= siblings.length) return;
      [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
      for (let k = 0; k < siblings.length; k++) {
        await updateRow("categories", siblings[k].id, { sort_order: k }, "categories");
      }
    },
  };

  // ---------- Tags ----------
  const tags = {
    create: (payload) => insertRow("tags", { sort_order: state.tags.length, ...payload }, "tags"),
    update: (id, payload) => updateRow("tags", id, payload, "tags"),
    remove: (id) => deleteRow("tags", id, "tags"),
    move: async (id, delta) => {
      const list = [...state.tags].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      const i = list.findIndex(x => x.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      for (let k = 0; k < list.length; k++) {
        await updateRow("tags", list[k].id, { sort_order: k }, "tags");
      }
    },
    findOrCreateByName: async (name) => {
      const existing = state.tags.find(t => t.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing;
      return await tags.create({ name });
    },
  };

  // ---------- Operations ----------
  async function setOperationTags(opId, tagIds) {
    // Удалить старые, вставить новые
    await supabase.from("operation_tags").delete().eq("operation_id", opId);
    if (tagIds.length) {
      const rows = tagIds.map(tag_id => ({ operation_id: opId, tag_id }));
      await supabase.from("operation_tags").insert(rows);
    }
    dispatch({ type: "setOpTagsForOp", opId, tagIds });
  }

  const operations = {
    create: async (payload, tagIds = []) => {
      const op = await insertRow("operations", payload, "operations");
      if (tagIds.length) await setOperationTags(op.id, tagIds);
      return op;
    },
    update: async (id, payload, tagIds = null) => {
      const op = await updateRow("operations", id, payload, "operations");
      if (tagIds) await setOperationTags(id, tagIds);
      return op;
    },
    remove: async (id) => {
      await deleteRow("operations", id, "operations");
      dispatch({ type: "removeOpTagsForOp", opId: id });
    },
    duplicate: async (id) => {
      const src = state.operations.find(o => o.id === id);
      if (!src) return;
      const { id: _, created_at, updated_at, user_id, ...payload } = src;
      const opTagIds = state.operationTags.filter(ot => ot.operation_id === id).map(ot => ot.tag_id);
      return await operations.create(payload, opTagIds);
    },
  };

  // ---------- Budgets ----------
  const budgets = {
    upsert: async ({ category_id, amount, period }) => {
      const { data, error } = await supabase
        .from("budgets")
        .upsert(withUser({ category_id, amount, period }), { onConflict: "user_id,category_id,period" })
        .select().single();
      if (error) throw error;
      dispatch({ type: "upsertOne", key: "budgets", item: data });
      return data;
    },
    remove: (id) => deleteRow("budgets", id, "budgets"),
  };

  // ---------- Goals ----------
  const goals = {
    create: (payload) => insertRow("goals", { sort_order: state.goals.length, ...payload }, "goals"),
    update: (id, payload) => updateRow("goals", id, payload, "goals"),
    remove: (id) => deleteRow("goals", id, "goals"),
    contribute: async (id, amount) => {
      const g = state.goals.find(x => x.id === id);
      if (!g) return;
      const newAmount = Number(g.current_amount) + Number(amount);
      return await goals.update(id, { current_amount: newAmount });
    },
  };

  // ---------- Profile ----------
  const profile = {
    update: async (patch) => {
      const { data, error } = await supabase
        .from("profiles")
        .update(patch).eq("user_id", state.user.id).select().single();
      if (error) throw error;
      dispatch({ type: "set", payload: { profile: data } });
      if (patch.theme) applyTheme(patch.theme);
      return data;
    },
  };

  const value = {
    ...state,
    toasts,
    pushToast,
    auth,
    accounts,
    categories,
    tags,
    operations,
    budgets,
    goals,
    profile,
  };

  return h(StoreContext.Provider, { value }, children);
}

export function useStore() {
  return useContext(StoreContext);
}

// ---------- Темизация ----------
export function applyTheme(mode) {
  const html = document.documentElement;
  let resolved = mode;
  if (mode === "auto") {
    resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  html.setAttribute("data-theme", resolved);
}

// Подписка на изменение системной темы (для режима "auto")
let mq = null;
export function watchSystemTheme(getMode) {
  if (mq) return;
  mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    if (getMode() === "auto") applyTheme("auto");
  });
}
