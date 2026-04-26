import { html } from "htm/preact";
import { useState } from "preact/hooks";
import { useStore } from "../lib/store.js";

export function AuthPage() {
  const { auth } = useStore();
  const [mode, setMode] = useState("signin"); // signin | signup | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  function switchMode(next) {
    setError(""); setInfo(""); setMode(next);
  }

  async function submit(e) {
    e.preventDefault();
    setError(""); setInfo("");
    if (!email) { setError("Введите email"); return; }
    if (mode !== "forgot") {
      if (!password) { setError("Введите пароль"); return; }
      if (password.length < 6) { setError("Пароль должен быть минимум 6 символов"); return; }
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        await auth.signIn(email.trim(), password);
      } else if (mode === "signup") {
        await auth.signUp(email.trim(), password);
      } else if (mode === "forgot") {
        await auth.requestPasswordReset(email.trim());
        setInfo("Если такой email есть в системе — мы отправили на него письмо со ссылкой для смены пароля. Проверьте почту (в том числе папку «Спам»).");
      }
    } catch (e) {
      setError(translate(e?.message || "Произошла ошибка"));
    } finally {
      setBusy(false);
    }
  }

  const titles = {
    signin: "Вход",
    signup: "Регистрация",
    forgot: "Восстановление пароля",
  };
  const subs = {
    signin: "Войдите в свой аккаунт",
    signup: "Создайте аккаунт — данные будут синхронизироваться между устройствами",
    forgot: "Введите email, на который зарегистрирован аккаунт. Мы отправим ссылку для сброса пароля.",
  };
  const buttonLabels = {
    signin: "Войти",
    signup: "Зарегистрироваться",
    forgot: "Отправить ссылку",
  };

  return html`
    <div class="auth-wrap">
      <form class="auth-card glass" onSubmit=${submit}>
        <div class="brand" style="padding:0 0 14px;">
          <span class="brand-mark">₽</span>
          <span>Финансы</span>
        </div>
        <h1>${titles[mode]}</h1>
        <div class="sub">${subs[mode]}</div>

        <div class="field">
          <label>Email</label>
          <input class="input" type="email" autocomplete="email"
                 value=${email} onInput=${e => setEmail(e.target.value)} />
        </div>

        ${mode !== "forgot" && html`
          <div class="field">
            <label>Пароль</label>
            <input class="input" type="password"
                   autocomplete=${mode === "signin" ? "current-password" : "new-password"}
                   value=${password} onInput=${e => setPassword(e.target.value)} />
            ${mode === "signin" && html`
              <div style="text-align:right;margin-top:6px;">
                <button type="button" class="linklike"
                        onClick=${() => switchMode("forgot")}
                        style="background:none;border:none;color:var(--accent);padding:0;font-size:13px;cursor:pointer;">
                  Забыли пароль?
                </button>
              </div>
            `}
          </div>
        `}

        ${error && html`<div class="notice error" style="margin-top:12px;">${error}</div>`}
        ${info && html`<div class="notice success" style="margin-top:12px;">${info}</div>`}

        <button class="btn primary" type="submit" disabled=${busy}>
          ${busy ? "Минутку…" : buttonLabels[mode]}
        </button>

        <div class="switch">
          ${mode === "signin" && html`
            Нет аккаунта? <button type="button" onClick=${() => switchMode("signup")}>Зарегистрируйтесь</button>
          `}
          ${mode === "signup" && html`
            Уже есть аккаунт? <button type="button" onClick=${() => switchMode("signin")}>Войти</button>
          `}
          ${mode === "forgot" && html`
            Вспомнили? <button type="button" onClick=${() => switchMode("signin")}>Вернуться ко входу</button>
          `}
        </div>
      </form>
    </div>
  `;
}

function translate(msg) {
  const m = String(msg).toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "Неверный email или пароль";
  if (m.includes("already registered") || m.includes("user already")) return "Этот email уже зарегистрирован";
  if (m.includes("password should be")) return "Пароль должен быть минимум 6 символов";
  if (m.includes("rate limit") || m.includes("too many")) return "Слишком много попыток. Подождите минуту";
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network")) {
    return "Не удалось связаться с сервером. Проверьте подключение к интернету или сообщите автору сайта.";
  }
  if (m.includes("email not confirmed")) return "Email не подтверждён. Откройте ссылку из письма";
  if (m.includes("invalid email")) return "Введите корректный email";
  if (m.includes("database error") || m.includes("unexpected_failure")) {
    return "Ошибка базы данных. Возможно, не до конца настроен Supabase — сообщите автору сайта.";
  }
  if (m.includes("signup") && m.includes("disabled")) return "Регистрация временно отключена администратором";
  if (m.includes("captcha")) return "Не пройдена проверка captcha";
  if (m.includes("same password")) return "Новый пароль должен отличаться от старого";
  return msg;
}
