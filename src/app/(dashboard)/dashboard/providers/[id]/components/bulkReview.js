/** Actions that change several connections at once and must be reviewed first. */
export const BULK_ACTIONS = Object.freeze({
  enable: "Turn on",
  disable: "Turn off",
  delete: "Delete",
  proxy: "Apply proxy",
});

/**
 * Build the summary shown before a bulk change applies: the action, how many
 * connections it touches, their names, and how many of them the current
 * filter/page keeps out of view. The ids are frozen here so Confirm applies to
 * exactly what was reviewed, even if the selection changes behind the dialog.
 */
export function buildBulkReview({ action, detail = "", targets, visibleConnections }) {
  const label = BULK_ACTIONS[action] ?? String(action);
  const visibleIds = new Set(visibleConnections.map((connection) => connection.id));
  const ids = targets.map((connection) => connection.id);
  const names = targets.map((connection) => connection.name || connection.email || connection.id);
  const hiddenCount = targets.filter((connection) => !visibleIds.has(connection.id)).length;
  return Object.freeze({
    action,
    label,
    detail,
    count: ids.length,
    ids: Object.freeze(ids),
    names: Object.freeze(names),
    hiddenCount,
  });
}

/** Keep only the reviewed ids that still exist, so a refetch cannot widen the change. */
export function reviewedTargets(review, connections) {
  const reviewed = new Set(review.ids);
  return connections.filter((connection) => reviewed.has(connection.id));
}
