import { render } from "preact";
import { html } from "htm/preact";
import { StoreProvider } from "./store.js";
import { App } from "./Planner.js";

render(html`<${StoreProvider}><${App} /><//>`, document.getElementById("app"));
