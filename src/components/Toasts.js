import { html } from "htm/preact";
import { useStore } from "../lib/store.js";

export function Toasts() {
  const { toasts } = useStore();
  if (!toasts?.length) return null;
  return html`
    <div class="toast-wrap">
      ${toasts.map(t => html`
        <div class=${"toast " + (t.type || "")} key=${t.id}>${t.text}</div>
      `)}
    </div>
  `;
}
