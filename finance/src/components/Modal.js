import { html } from "htm/preact";
import { useEffect } from "preact/hooks";
import { Icon } from "../lib/icons.js";

export function Modal({ title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose?.(); }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return html`
    <div class="modal-back" onClick=${e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div class=${"modal" + (wide ? " wide" : "")} role="dialog">
        <div class="modal-head">
          <h3>${title}</h3>
          <button class="btn icon ghost" onClick=${onClose} aria-label="Закрыть">${Icon.close()}</button>
        </div>
        <div class="modal-body">${children}</div>
        ${footer && html`<div class="modal-foot">${footer}</div>`}
      </div>
    </div>
  `;
}

export function ConfirmModal({ title, message, confirmText = "Удалить", danger = true, onCancel, onConfirm }) {
  return html`
    <${Modal}
      title=${title}
      onClose=${onCancel}
      footer=${html`
        <button class="btn ghost" onClick=${onCancel}>Отмена</button>
        <button class=${"btn " + (danger ? "danger" : "primary")} onClick=${onConfirm}>${confirmText}</button>
      `}
    >
      <div>${message}</div>
    <//>
  `;
}
