import { html } from "htm/preact";
import { useState } from "preact/hooks";
import { useStore } from "../lib/store.js";

export function AuthPage() {
  const { auth } = useStore();
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("Заполните email и пароль"); return; }
    if (password.length < 6) { setError("Пароль должен быть минимум 6 символов"); return; }
    setBusy(true);
    try {
      if (mode === "signin") await auth.signIn(email.trim(), password);
      else await auth.signUp(email.trim(), password);
    } catch (e) {
      setError(translate(e?.message || "Ошибка входа"));
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="auth-wrap">
      <form class="auth-card glass" onSubmit=${submit}>
        <div class="brand" style="padding:0 0 14px;">
          <span class="brand-mark">₽</span>
          <span>Финансы</span>
        </div>
        <h1>${mode === "signin" ? "Вход" : "Регистрация"}</h1>
        <div class="sub">
          ${mode === "signin"
            ? "Войдите в свой аккаунт"
            : "Создайте аккаунт — данные будут синхронизироваться между устройствами"}
        </div>
        <div class="field">
          <label>Email</label>
          <input class="input" type="email" autocomplete="email"
                 value=${email} onInput=${e => setEmail(e.target.value)} />
        </div>
        <div class="field">
          <label>Пароль</label>
          <input class="input" type="password"
                 autocomplete=${mode === "signin" ? "current-password" : "new-password"}
                 value=${password} onInput=${e => setPassword(e.target.value)} />
        </div>
        ${error && html`<div class="notice error" style="margin-top:12px;">${error}</div>`}
        <button class="btn primary" type="submit" disabled=${busy}>
          ${busy ? "Минутку…" : (mode === "signin" ? "Войти" : "Зарегистрироваться")}
        </button>
        <div class="switch">
          ${mode === "signin"
            ? html`Нет аккаунта? <button type="button" onClick=${() => setMode("signup")}>Зарегистрируйтесь</button>`
            : html`Уже есть аккаунт? <button type="button" onClick=${() => setMode("signin")}>Войти</button>`}
        </div>
      </form>
    </div>
  `;
}

function translate(msg) {
  const m = String(msg).toLowerCase();
  if (m.includes("invalid login")) return "Неверный email или пароль";
  if (m.includes("already registered") || m.includes("user already")) return "Этот email уже зарегистрирован";
  if (m.includes("password should be")) return "Пароль должен быть минимум 6 символов";
  if (m.includes("rate limit")) return "Слишком много попыток. Подождите минуту";
  if (m.includes("network")) return "Нет связи с сервером";
  return msg;
}
