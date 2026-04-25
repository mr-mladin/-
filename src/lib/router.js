// Минимальный hash-роутер.
// Маршруты: #/dashboard, #/operations, #/budgets, #/goals, #/settings[/...]

import { useEffect, useState } from "preact/hooks";

export const ROUTES = ["dashboard", "operations", "budgets", "goals", "settings"];

function parse() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  let name = parts[0] || "dashboard";
  if (!ROUTES.includes(name)) name = "dashboard";
  return { name, segments: parts.slice(1) };
}

export function useRoute() {
  const [route, setRoute] = useState(parse());
  useEffect(() => {
    const h = () => setRoute(parse());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  return route;
}

export function navigate(path) {
  if (!path.startsWith("#")) path = "#" + (path.startsWith("/") ? path : "/" + path);
  if (window.location.hash !== path) window.location.hash = path;
}

export function href(path) {
  return "#" + (path.startsWith("/") ? path : "/" + path);
}
