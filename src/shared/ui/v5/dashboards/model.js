import { isBoolean, isString } from "../../../utils/typeChecks.js";

/** Review-only preferences never write gateway settings, usage records or credentials. */
export const WORKSPACES_KEY = "durindoor:v5-review:workspaces:v1";
export const SAVER_LAYOUT_KEY = "durindoor:v5-review:token-saver-layout:v1";
export const SAVER_WIDGETS = [
  { id: "saver-summary", title: "Compression overview", span: 12, visible: true, source: "Token Saver · actual bytes and token delta" },
  { id: "saver-bytes", title: "Actual bytes saved", span: 8, visible: true, source: "Token Saver · aggregate stream" },
  { id: "saver-estimate", title: "Image token estimate", span: 4, visible: true, source: "Token Saver · estimated image savings" },
  { id: "saver-skips", title: "Headroom skip reasons", span: 4, visible: true, source: "Token Saver · aggregate stream" },
  { id: "pxpipe-status", title: "PXPIPE status", span: 8, visible: true, source: "PXPIPE · health and current window" },
  { id: "pxpipe-savings", title: "PXPIPE savings estimate", span: 12, visible: true, source: "PXPIPE · five time windows" },
  { id: "pxpipe-trend", title: "PXPIPE daily estimates", span: 12, visible: true, source: "PXPIPE · 30-day trend" },
  { id: "pxpipe-history", title: "PXPIPE compression history", span: 12, visible: true, source: "PXPIPE · paginated compression decisions" },
  { id: "pxpipe-events", title: "PXPIPE transform events", span: 12, visible: true, source: "PXPIPE · paginated raw event log" },
];
export const WORKSPACE_WIDGETS = [
  ...SAVER_WIDGETS.map((widget) => ({ ...widget, visible: false })),
  ...[
    ["overview", "Usage overview", 12, true],
    ["topology", "Provider connections", 8, false],
    ["requests", "Recent requests and sessions", 4, false],
    ["chart", "Token and cost trend", 8, false],
    ["breakdown", "Grouped usage", 12, false],
    ["combos", "Combo connection usage", 12, false],
    ["keys", "API key limits", 12, false],
  ].map(([id, title, span, visible]) => ({ id, title, span, visible, source: "Usage · gateway records" })),
  { id: "quota", title: "Provider quota", span: 12, visible: false, source: "Quota · provider limits and remaining capacity" },
  { id: "monitoring", title: "Gateway monitoring", span: 12, visible: true, source: "Monitoring · runtime, activity and storage" },
];
const SPANS = new Set([4, 6, 8, 12]);

/** Keep unavailable saved identities visible so users can replace removed sources deliberately. */
export function normalizeDashboardLayout(value, catalog) {
  const defaults = new Map(catalog.map((widget) => [widget.id, widget]));
  const seen = new Set();
  const result = [];
  for (const candidate of Array.isArray(value) ? value : []) {
    if (!candidate || !isString(candidate.id) || !candidate.id || seen.has(candidate.id)) continue;
    const fallback = defaults.get(candidate.id) || { id: candidate.id, title: "Unavailable widget", span: 12, visible: true };
    result.push({ ...fallback,
      title: isString(candidate.title) && candidate.title.trim() ? candidate.title.trim().slice(0, 80) : fallback.title,
      span: SPANS.has(candidate.span) ? candidate.span : fallback.span,
      visible: isBoolean(candidate.visible) ? candidate.visible : fallback.visible,
    });
    seen.add(candidate.id);
    defaults.delete(candidate.id);
  }
  return [...result, ...Array.from(defaults.values(), (widget) => ({ ...widget }))];
}
export function updateDashboardWidget(layout, id, patch, catalog) {
  return normalizeDashboardLayout(layout.map((widget) => widget.id === id ? { ...widget, ...patch, id } : widget), catalog);
}
export function moveDashboardWidget(layout, id, targetId) {
  const from = layout.findIndex((widget) => widget.id === id);
  const to = layout.findIndex((widget) => widget.id === targetId);
  if (from < 0 || to < 0 || from === to) return layout;
  const next = [...layout];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
export function readDashboardLayout(storage, key, catalog) {
  try { return normalizeDashboardLayout(JSON.parse(storage?.getItem(key) || "null"), catalog); }
  catch { return normalizeDashboardLayout(null, catalog); }
}
export function normalizeWorkspaces(value) {
  const seen = new Set();
  const dashboards = (Array.isArray(value?.dashboards) ? value.dashboards : []).filter((dashboard) => {
    if (!dashboard || !isString(dashboard.id) || !dashboard.id || seen.has(dashboard.id)) return false;
    seen.add(dashboard.id); return true;
  }).map((dashboard) => ({ id: dashboard.id,
    name: isString(dashboard.name) && dashboard.name.trim() ? dashboard.name.trim().slice(0, 80) : "Untitled dashboard",
    layout: normalizeDashboardLayout(dashboard.layout, WORKSPACE_WIDGETS),
  }));
  if (!dashboards.length) dashboards.push({ id: "operations", name: "Operations", layout: normalizeDashboardLayout(null, WORKSPACE_WIDGETS) });
  return { version: 1, activeId: dashboards.some((dashboard) => dashboard.id === value?.activeId) ? value.activeId : dashboards[0].id, dashboards };
}
export function readWorkspaces(storage) {
  try { return normalizeWorkspaces(JSON.parse(storage?.getItem(WORKSPACES_KEY) || "null")); }
  catch { return normalizeWorkspaces(null); }
}
/** User supplies the stable identity; deleting the final dashboard is prohibited by the UI. */
export function changeWorkspace(collection, action) {
  const current = normalizeWorkspaces(collection);
  if (action.type === "create" && !current.dashboards.some((dashboard) => dashboard.id === action.id)) {
    return normalizeWorkspaces({ ...current, activeId: action.id, dashboards: [...current.dashboards, { id: action.id, name: action.name, layout: WORKSPACE_WIDGETS.map((widget) => ({ ...widget, visible: false })) }] });
  }
  if (action.type === "select") return normalizeWorkspaces({ ...current, activeId: action.id });
  if (action.type === "delete" && current.dashboards.length > 1) return normalizeWorkspaces({ ...current, dashboards: current.dashboards.filter((dashboard) => dashboard.id !== action.id) });
  if (action.type === "rename" || action.type === "layout") return normalizeWorkspaces({ ...current, dashboards: current.dashboards.map((dashboard) => dashboard.id === action.id ? { ...dashboard, ...(action.type === "rename" ? { name: action.name } : { layout: action.layout }) } : dashboard) });
  return current;
}
