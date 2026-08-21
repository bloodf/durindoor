export function getStatusVariant(isActive, effectiveStatus) {
  if (isActive === false) return "default";
  if (effectiveStatus === "active" || effectiveStatus === "success") return "success";
  if (effectiveStatus === "error" || effectiveStatus === "expired" || effectiveStatus === "unavailable" || effectiveStatus === "reauth_required") return "error";
  return "default";
}

/**
 * Return renderer-ready error metadata without confusing stale error history
 * with the dedicated automatic-disable event.
 */
export function getConnectionErrorDisplay(connection) {
  if (connection?.isActive !== false) {
    return connection?.lastError ? { reason: connection.lastError, time: null } : null;
  }

  if (!connection?.autoDisabledReason || !connection?.autoDisabledAt) return null;
  const disabledAt = new Date(connection.autoDisabledAt);
  if (Number.isNaN(disabledAt.getTime())) return null;
  return { reason: connection.autoDisabledReason, time: disabledAt.toLocaleString() };
}

/** Replace local connection rows with authoritative API response rows. */
export function replaceUpdatedConnections(connections, updatedConnections) {
  const updatedById = new Map(updatedConnections.map((connection) => [connection.id, connection]));
  return connections.map((connection) => updatedById.get(connection.id) || connection);
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
