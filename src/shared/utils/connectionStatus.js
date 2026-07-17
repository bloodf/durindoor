export function getStatusVariant(isActive, effectiveStatus) {
  if (isActive === false) return "default";
  if (effectiveStatus === "active" || effectiveStatus === "success") return "success";
  if (effectiveStatus === "error" || effectiveStatus === "expired" || effectiveStatus === "unavailable") return "error";
  return "default";
}

/**
 * Keep only connections eligible for pickers (combo targets, etc.).
 * A connection is hidden only when explicitly disabled (`isActive === false`);
 * legacy rows without the flag and no-auth connections stay visible.
 */
export function filterActiveConnections(connections) {
  if (!Array.isArray(connections)) return [];
  return connections.filter((connection) => connection?.isActive !== false);
}
