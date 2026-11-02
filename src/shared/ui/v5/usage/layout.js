import { isBoolean, isNumber, isString } from "../../../utils/typeChecks.js";

/** Storybook review layout preferences. These never modify gateway settings or data. */
export const USAGE_LAYOUT_KEY = "durindoor:v5-review:usage-layout";
export const USAGE_WIDGETS = Object.freeze([
  { id: "overview", title: "Usage overview", span: 12, visible: true },
  { id: "topology", title: "Provider connections", span: 8, visible: true },
  { id: "requests", title: "Recent requests and sessions", span: 4, visible: true },
  { id: "chart", title: "Token and cost trend", span: 12, visible: true },
  { id: "breakdown", title: "Grouped usage", span: 12, visible: true },
  { id: "combos", title: "Combo connection usage", span: 12, visible: true },
  { id: "keys", title: "API key limits", span: 12, visible: true },
  { id: "monitoring", title: "Gateway monitoring", span: 12, visible: true },
].map(Object.freeze));
const SPANS = new Set([4, 6, 8, 12]);

/** Reconcile saved preferences with every current widget; ignore unknown identities. */
export function normalizeUsageLayout(value) {
  const defaults = new Map(USAGE_WIDGETS.map((widget) => [widget.id, widget]));
  const normalized = [];
  for (const candidate of Array.isArray(value) ? value : []) {
    const fallback = defaults.get(candidate?.id);
    if (!fallback) continue;
    normalized.push({
      ...fallback,
      title: isString(candidate.title) && candidate.title.trim()
        ? candidate.title.trim().slice(0, 80) : fallback.title,
      span: isNumber(candidate.span) && SPANS.has(candidate.span) ? candidate.span : fallback.span,
      visible: isBoolean(candidate.visible) ? candidate.visible : fallback.visible,
    });
    defaults.delete(candidate.id);
  }
  return [...normalized, ...[...defaults.values()].map((widget) => ({ ...widget }))];
}

export function updateUsageWidget(layout, id, patch) {
  return normalizeUsageLayout(layout.map((widget) => widget.id === id
    ? { ...widget, title: patch.title ?? widget.title, span: patch.span ?? widget.span, visible: patch.visible ?? widget.visible }
    : widget));
}

/** Move by identity so hiding widgets never deletes them or changes their identities. */
export function moveUsageWidget(layout, id, targetId) {
  const from = layout.findIndex((widget) => widget.id === id);
  const to = layout.findIndex((widget) => widget.id === targetId);
  if (from < 0 || to < 0 || from === to) return layout;
  const next = layout.map((widget) => ({ ...widget }));
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export function readUsageLayout(storage) {
  try {
    return normalizeUsageLayout(JSON.parse(storage?.getItem(USAGE_LAYOUT_KEY) || "null"));
  } catch {
    return normalizeUsageLayout(null);
  }
}
