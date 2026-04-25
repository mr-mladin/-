import { html } from "htm/preact";

const wrap = (path, viewBox = "0 0 24 24") => html`
  <svg class="ico" viewBox=${viewBox} fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    ${path}
  </svg>
`;

export const Icon = {
  dashboard: () => wrap(html`<path d="M3 12 12 3l9 9"/><path d="M5 10v10h14V10"/>`),
  list: () => wrap(html`<path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>`),
  budget: () => wrap(html`<path d="M3 3v18h18"/><path d="M7 14l4-4 4 3 5-7"/>`),
  goal: () => wrap(html`<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>`),
  settings: () => wrap(html`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>`),
  plus: () => wrap(html`<path d="M12 5v14M5 12h14"/>`),
  edit: () => wrap(html`<path d="M11 4H4v16h16v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>`),
  trash: () => wrap(html`<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>`),
  copy: () => wrap(html`<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>`),
  search: () => wrap(html`<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`),
  close: () => wrap(html`<path d="M6 6l12 12M18 6L6 18"/>`),
  menu: () => wrap(html`<path d="M3 6h18M3 12h18M3 18h18"/>`),
  up: () => wrap(html`<path d="M6 15l6-6 6 6"/>`),
  down: () => wrap(html`<path d="M6 9l6 6 6-6"/>`),
  left: () => wrap(html`<path d="M15 18l-6-6 6-6"/>`),
  right: () => wrap(html`<path d="M9 6l6 6-6 6"/>`),
  check: () => wrap(html`<path d="M5 13l4 4L19 7"/>`),
  arrowUp: () => wrap(html`<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>`),
  arrowDown: () => wrap(html`<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>`),
  swap: () => wrap(html`<path d="M7 16h13"/><path d="m17 19 3-3-3-3"/><path d="M17 8H4"/><path d="m7 5-3 3 3 3"/>`),
  wallet: () => wrap(html`<path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v3"/><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><circle cx="17" cy="13" r="1.5"/>`),
  card: () => wrap(html`<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 11h20"/>`),
  piggy: () => wrap(html`<path d="M5 15a7 7 0 1 1 14 0"/><path d="M5 15v4a1 1 0 0 0 1 1h2v-2"/><path d="M19 15v4a1 1 0 0 1-1 1h-2v-2"/><circle cx="16" cy="11" r="0.7" fill="currentColor"/>`),
  tag: () => wrap(html`<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>`),
  filter: () => wrap(html`<path d="M3 5h18l-7 9v6l-4-2v-4z"/>`),
  signout: () => wrap(html`<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>`),
  download: () => wrap(html`<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>`),
  upload: () => wrap(html`<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>`),
  sun: () => wrap(html`<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>`),
  moon: () => wrap(html`<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>`),
  auto: () => wrap(html`<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18"/>`),
  dot: () => wrap(html`<circle cx="12" cy="12" r="3" fill="currentColor"/>`),
};

export function ico(name) {
  const r = Icon[name];
  return r ? r() : Icon.dot();
}
