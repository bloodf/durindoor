/** Storybook-only state model. No gateway requests or production preferences. */
export const PAGE_STATES = [
  "ready",
  "loading",
  "empty",
  "error",
  "offline",
  "degraded",
  "readonly",
  "success",
  "forbidden",
];
export const WIDGETS = [
  {
    id: "traffic",
    title: "Request traffic",
    type: "traffic",
    wide: true,
    visible: true,
  },
  {
    id: "providers",
    title: "Provider distribution",
    type: "providers",
    wide: false,
    visible: true,
  },
  {
    id: "requests",
    title: "Recent requests",
    type: "requests",
    wide: true,
    visible: true,
  },
  {
    id: "budget",
    title: "Spend & budget",
    type: "budget",
    wide: false,
    visible: true,
  },
  {
    id: "latency",
    title: "Latency by provider",
    type: "latency",
    wide: false,
    visible: false,
  },
  {
    id: "health",
    title: "Connection health",
    type: "health",
    wide: false,
    visible: false,
  },
];
export function updateWidget(widgets, id, patch) {
  return widgets.map((widget) =>
    widget.id === id
      ? { ...widget, ...patch, id: widget.id, type: widget.type }
      : widget,
  );
}
export function moveWidget(widgets, id, targetId) {
  const from = widgets.findIndex((widget) => widget.id === id);
  const to = widgets.findIndex((widget) => widget.id === targetId);
  if (from < 0 || to < 0 || from === to) return widgets;
  const next = [...widgets];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
export function filterRows(rows, query, status) {
  const text = query.trim().toLocaleLowerCase();
  return rows.filter(
    (row) =>
      (!text ||
        Object.values(row).some((value) =>
          String(value).toLocaleLowerCase().includes(text),
        )) &&
      (status === "all" || row.status === status),
  );
}
export function validateConnection(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = "Enter a connection name.";
  if (!values.secret.trim())
    errors.secret = "Enter a sample API key to test this connection.";
  if (values.endpoint) {
    try {
      const url = new URL(values.endpoint);
      if (!["https:", "http:"].includes(url.protocol))
        errors.endpoint = "Use an HTTP or HTTPS endpoint.";
    } catch {
      errors.endpoint =
        "Enter a complete URL, such as https://api.example.com/v1.";
    }
  }
  return errors;
}
