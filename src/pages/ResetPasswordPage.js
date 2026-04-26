import { html } from "htm/preact";
import { useState } from "preact/hooks";
import { useStore } from "../lib/store.js";

export function ResetPasswordPage() {
  const { auth, user, pushToast } = useStore();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!password || password.length < 6) { setError("Минимум 6 символов"); return; }
    if (password !== confirm) { setError("Пароли не совпадают"); return; }
    setBusy(true);
    try {
      await auth.setNewPassword(password);
      pushToast("Пароль обновлён", "success");
    } catch (e) {
      setError(translate(e?.message || "Не удалось обновить пароль"));
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
        <h1>Новый пароль</h1>
        <div class="sub">
          Придумайте новый пароль для аккаунта${user?.email ? ` ${user.email}` : ""}.
        </div>
        <div class="field">
          <label>Новый пароль</label>
          <input class="input" type="password" autocomplete="new-password"
                 value=${password} onInput=${e => setPassword(e.target.value)} />
        </div>
        <div class="field">
          <label>Повторите пароль</label>
          <input class="input" type="password" autocomplete="new-password"
                 value=${confirm} onInput=${e => setConfirm(e.target.value)} />
        </div>
        ${error && html`<div class="notice error" style="margin-top:12px;">${error}</div>`}
        <button class="btn primary" type="submit" disabled=${busy}>
          ${busy ? "Сохраняю…" : "Сохранить новый пароль"}
        </button>
        <div class="switch">
          <button type="button" onClick=${() => auth.signOut()}>Отмена</button>
        </div>
      </form>
    </div>
  `;
}

function translate(msg) {
  const m = String(msg).toLowerCase();
  if (m.includes("same password")) return "Новый пароль должен отличаться от старого";
  if (m.includes("password should be")) return "Минимум 6 символов";
  if (m.includes("session") || m.includes("expired")) return "Ссылка устарела. Запросите новую на странице входа.";
  return msg;
}
