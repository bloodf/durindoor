import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";

/**
 * Build the list of connection options for the active provider group.
 *
 * Returns an empty array for single-connection providers. Otherwise returns an
 * "Auto" option followed by one entry per connection, using name or email as the
 * label and falling back to a short id display.
 * @param {object|null} group
 * @returns {Array<{value:string, label:string}>}
 */
import { isString } from "../../../../shared/utils/typeChecks.js";
export function getConnectionOptions(group) {
  if (!group || !Array.isArray(group.connections) || group.connections.length <= 1) {
    return [];
  }
  const validConnections = group.connections.filter((c) => isString(c.id) && c.id.length > 0);
  if (validConnections.length <= 1) return [];
  return [
  { value: "auto", label: "Auto" },
  ...validConnections.map((connection) => ({
    value: connection.id,
    label: isString(connection.name) && connection.name.length > 0 ?
    connection.name :
    isString(connection.email) && connection.email.length > 0 ?
    connection.email :
    connection.id
  }))];

}

/**
 * Build a UI reasoning-effort option list for the current model.
 *
 * `getThinkingLevels(providerId, modelId)` returns an array of backend values for
 * the model (e.g. ["low", "medium", "high"] or ["none", "low", "medium", "high"]).
 * The UI always prepends an "auto" sentinel that means "do not send reasoning_effort".
 * @param {string} providerId
 * @param {string} modelId
 * @param {object} [deps]
 * @param {Function} [deps.getThinkingLevels]
 * @returns {string[] | null}
 */
export function getModelReasoningOptions(providerId, modelId, { getThinkingLevels: lookup = getThinkingLevels } = {}) {
  if (!providerId || !modelId) return null;
  const levels = lookup(providerId, modelId);
  if (!Array.isArray(levels) || levels.length === 0) return null;
  return ["auto", ...levels];
}

/**
 * Ensure a persisted reasoning value is still valid for the model option list.
 * Falls back to "auto" when the model changes or the saved value is unsupported.
 * @param {string[] | null} options
 * @param {string} value
 * @returns {string}
 */
export function normalizeReasoningEffort(options, value) {
  if (!options || options.length === 0) return "auto";
  return options.includes(value) ? value : "auto";
}

function dedupeModels(models) {
  const map = new Map();
  for (const model of models) {
    if (!model?.id) continue;
    if (!map.has(model.id)) map.set(model.id, model);
  }
  return Array.from(map.values());
}

/**
 * Group already-normalized model lists by their provider id, dedupe, and sort.
 * Models are expected to carry `providerId` and `name`. Connections are grouped
 * by `providerId` and assigned to each provider. Empty groups are dropped.
 * @param {Array<{providerId?:string, provider?:string, providerName?:string, providerType?:string, id?:string, name?:string}>} connections
 * @param {Array<{providerId:string, id:string, name:string}>} normalizedModels
 * @returns {Array<{providerId:string, providerName:string, providerType:string, connections:Array, models:Array}>}
 */
export function groupModelsByProvider(connections = [], normalizedModels = []) {
  const map = new Map();

  for (const connection of connections) {
    const providerId = connection.providerId || connection.provider || connection.id;
    if (!providerId) continue;
    if (!map.has(providerId)) {
      map.set(providerId, {
        providerId,
        providerName: connection.providerName || connection.name || connection.provider || connection.id || providerId,
        providerType: connection.providerType || providerId,
        connections: [],
        models: []
      });
    }
    map.get(providerId).connections.push(connection);
  }

  for (const model of normalizedModels) {
    const providerId = model.providerId;
    if (!providerId || !map.has(providerId)) continue;
    map.get(providerId).models.push(model);
  }

  return Array.from(map.values()).
  map((group) => ({
    ...group,
    models: dedupeModels(group.models).sort((a, b) => a.name.localeCompare(b.name))
  })).
  filter((group) => group.models.length > 0).
  sort((a, b) => a.providerName.localeCompare(b.providerName));
}

/**
 * Slice a sorted session list for a single history page, clamping the page
 * when the list has shrunk below the current page (e.g. after deletions).
 * @param {Array} items
 * @param {number} currentPage 1-indexed
 * @param {number} [pageSize=10]
 * @returns {{page:number, items:Array, totalPages:number}}
 */
export function paginateSessions(items, currentPage, pageSize = 10) {
  const safeItems = Array.isArray(items) ? items : [];
  const safePageSize = pageSize > 0 ? Math.floor(pageSize) : 10;
  const totalPages = Math.max(1, Math.ceil(safeItems.length / safePageSize));
  const page = Math.min(Math.max(1, Number(currentPage) || 1), totalPages);
  const start = (page - 1) * safePageSize;
  return { page, items: safeItems.slice(start, start + safePageSize), totalPages };
}