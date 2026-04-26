import { html } from "htm/preact";
import { useStore } from "./lib/store.js";
import { useRoute } from "./lib/router.js";
import { AuthPage } from "./pages/AuthPage.js";
import { ResetPasswordPage } from "./pages/ResetPasswordPage.js";
import { Layout } from "./components/Layout.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { OperationsPage } from "./pages/OperationsPage.js";
import { BudgetsPage } from "./pages/BudgetsPage.js";
import { GoalsPage } from "./pages/GoalsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { Toasts } from "./components/Toasts.js";

export function App() {
  const store = useStore();
  const route = useRoute();

  if (!store.ready) {
    return html`<div class="boot"><div class="boot-spinner"></div></div>`;
  }
  if (store.recovering) {
    return html`<${ResetPasswordPage} /><${Toasts} />`;
  }
  if (!store.user) {
    return html`<${AuthPage} /><${Toasts} />`;
  }

  let page;
  switch (route.name) {
    case "operations": page = html`<${OperationsPage} />`; break;
    case "budgets":    page = html`<${BudgetsPage} />`; break;
    case "goals":      page = html`<${GoalsPage} />`; break;
    case "settings":   page = html`<${SettingsPage} segments=${route.segments} />`; break;
    default:           page = html`<${DashboardPage} />`;
  }

  return html`
    <${Layout} active=${route.name}>${page}<//>
    <${Toasts} />
  `;
}
