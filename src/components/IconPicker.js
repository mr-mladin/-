// Выбор иконки для счёта/категории.
// Значение — строка: либо имя графической иконки из Icon-набора (например "wallet"),
// либо одиночный эмодзи (например "💳").

import { html } from "htm/preact";
import { useState, useRef, useEffect } from "preact/hooks";
import { Icon } from "../lib/icons.js";

// Графические иконки, подходящие для счетов и категорий
const GRAPHIC = [
  "wallet", "card", "cash", "bank", "coins", "piggy",
  "briefcase", "home", "cart", "plane", "car",
  "gift", "heart", "spark", "tag", "goal",
];

// Тематические эмодзи (счета / финансы / быт)
const EMOJI = [
  "💳", "💰", "💵", "💴", "💶", "💷", "💸", "🏦", "🪙", "👛",
  "💎", "🧾", "📊", "📈", "📉", "🎁", "🏠", "🏡", "🏢", "🏪",
  "🛒", "🛍️", "🍔", "🍕", "🍱", "🍎", "☕", "🍺", "🍷", "🍰",
  "✈️", "🚗", "🚕", "🚌", "🚇", "⛽", "🛴", "🚲", "🛵", "⛴️",
  "💼", "👔", "👗", "👟", "💄", "💊", "🏥", "🦷", "💪", "🧘",
  "📱", "💻", "🎮", "🎬", "🎵", "🎤", "📚", "🎨", "⚽", "🏖️",
  "❤️", "🔥", "⭐", "✨", "🎯", "🎉", "🌱", "🌿", "🌍", "🐶",
];

// true, если значение — это эмодзи (а не имя графической иконки)
export function isEmojiIcon(v) {
  if (!v) return false;
  return !Object.prototype.hasOwnProperty.call(Icon, v);
}

// Универсальный рендер иконки для отображения в UI
export function renderIcon(value, fallback = "wallet") {
  if (!value) return Icon[fallback]();
  if (Icon[value]) return Icon[value]();
  return html`<span class="emoji-ico">${value}</span>`;
}

export function IconPicker({ value, onChange }) {
  const [tab, setTab] = useState(() => isEmojiIcon(value) ? "emoji" : "graphic");
  const [custom, setCustom] = useState(isEmojiIcon(value) ? value : "");
  const inputRef = useRef(null);

  useEffect(() => {
    setCustom(isEmojiIcon(value) ? value : "");
  }, [value]);

  function pickEmoji(e) {
    onChange(e);
    setCustom(e);
  }

  function onCustomInput(e) {
    // Берём один последний символ — пусть пользователь паст эмодзи и получает
    // именно его, даже если случайно ввёл несколько
    const v = e.target.value;
    setCustom(v);
    if (!v) return;
    // оставим как есть — если пользователь вставил несколько символов,
    // это всё равно отрисуется
    onChange(v);
  }

  return html`
    <div>
      <div class="seg" style="margin-bottom:10px;">
        <button type="button" class=${tab === "graphic" ? "active" : ""}
          onClick=${() => setTab("graphic")}>Иконки</button>
        <button type="button" class=${tab === "emoji" ? "active" : ""}
          onClick=${() => setTab("emoji")}>Эмодзи</button>
      </div>

      ${tab === "graphic" ? html`
        <div class="icon-grid">
          ${GRAPHIC.map(name => html`
            <button type="button" key=${name}
              class=${"icon-cell " + (value === name ? "active" : "")}
              onClick=${() => onChange(name)}
              title=${name}>
              ${Icon[name]()}
            </button>
          `)}
        </div>
      ` : html`
        <div class="icon-grid">
          ${EMOJI.map(e => html`
            <button type="button" key=${e}
              class=${"icon-cell emoji " + (value === e ? "active" : "")}
              onClick=${() => pickEmoji(e)}>
              <span class="emoji-ico">${e}</span>
            </button>
          `)}
        </div>
        <div class="muted" style="font-size:12px;margin-top:8px;">
          Не нашли нужный — вставьте свой эмодзи в поле ниже
          (на Mac: <kbd>Ctrl+⌘+Space</kbd>).
        </div>
        <input
          ref=${inputRef}
          class="input"
          style="margin-top:6px;"
          placeholder="Например: 🚀"
          value=${custom}
          onInput=${onCustomInput}
        />
      `}
    </div>
  `;
}
