// Контролируемый инпут для денежных сумм с живым форматированием.
// Хранит «сырое» значение в state, отображает форматированное.

import { html } from "htm/preact";
import { useRef } from "preact/hooks";
import { formatNumberInput } from "../lib/format.js";
import { useStore } from "../lib/store.js";

export function AmountInput({ value, onChange, numberFormat, className = "input amount", ...rest }) {
  const store = useStore();
  const fmt = numberFormat || store.profile?.number_format || "space";
  const ref = useRef(null);

  // Если value пришло как число — отформатируем его сразу
  let display = value || "";
  if (display) {
    const r = formatNumberInput(String(display), String(display).length, fmt);
    display = r.value;
  }

  function onInput(e) {
    const el = e.target;
    const caret = el.selectionStart || 0;
    const r = formatNumberInput(el.value, caret, fmt);
    onChange(r.value);
    // После рендера восстановим каретку
    requestAnimationFrame(() => {
      if (ref.current && document.activeElement === ref.current) {
        ref.current.setSelectionRange(r.caret, r.caret);
      }
    });
  }

  return html`
    <input
      ref=${ref}
      class=${className}
      inputmode="decimal"
      value=${display}
      onInput=${onInput}
      ...${rest}
    />
  `;
}
