/**
 * Resolve a raw provider-connection UUID into a human label for tables and
 * detail panels: the connection's display name when known, otherwise a short
 * id prefix (first UUID segment), otherwise an em-dash placeholder.
 *
 * Pure helpers; callers fetch `/api/providers` once and pass the resulting
 * `{ connections: [...] }` list (or a prebuilt id → name map) in.
 */
import { isObject, isString } from "./typeChecks.js";

/** First UUID segment (8 chars) or the raw value when shorter; "" for empty. */
export function shortConnectionId(id) {
  if (!isString(id) || id.length === 0) return "";
  const dash = id.indexOf("-");
  return dash > 0 ? id.slice(0, dash) : id.slice(0, 8);
}

/** Build an id → display-name map from a `/api/providers` connections list. */
export function buildConnectionNameMap(connections) {
  const map = {};
  if (!Array.isArray(connections)) return map;
  for (const connection of connections) {
    if (!isObject(connection) || connection === null) continue;
    const id = connection.id;
    const name = connection.name;
    if (isString(id) && id && isString(name) && name.trim()) map[id] = name.trim();
  }
  return map;
}

/**
 * Display label for a connection column: connection name when the map knows
 * it, short id prefix for unnamed/unknown ids, "—" when no id was recorded.
 */
export function connectionDisplayName(id, nameById) {
  if (!isString(id) || id.length === 0) return "—";
  const name = isObject(nameById) && nameById !== null ? nameById[id] : undefined;
  if (isString(name) && name.trim()) return name;
  return shortConnectionId(id) || "—";
}
