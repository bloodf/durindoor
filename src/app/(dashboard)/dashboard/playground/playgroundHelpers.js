import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { isChatModel } from "@/shared/constants/models";
import { isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";
import { resolveProviderPrefix } from "@/shared/utils/providerPrefix.js";

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
 * Human-readable provider label for a connection.
 * @param {object} connection
 * @returns {string}
 */
export function getProviderLabel(connection) {
  const fallback = String(connection?.provider || connection?.id || "provider").
    replace(/[-_]/g, " ").
    replace(/\b\w/g, (char) => char.toUpperCase()).
    trim() || "Unknown";
  return connection?.name || fallback;
}

/**
 * The prefix a connection's provider is published under.
 *
 * A custom provider (OpenAI-/Anthropic-compatible, custom embedding, System
 * One) is a provider node whose id is a UUID-bearing string. The operator
 * configures a short prefix on the node, and the other surfaces — `/v1/models`,
 * the model picker, the provider page — advertise that prefix. In the
 * Playground the prefix is a display label only: the request is addressed by
 * the stable node id.
 *
 * @param {object} connection
 * @returns {string}
 */
export function resolveConnectionPrefix(connection) {
  return resolveProviderPrefix({
    providerId: connection?.providerId || connection?.provider || connection?.id,
    providerSpecificData: connection?.providerSpecificData
  });
}

/**
 * Split a Playground model address into the id sent to the gateway and the
 * label shown to the operator.
 *
 * `requestModel` (also the row `id`, so saved selections keep resolving) is
 * always `<provider id>/<model>`, which for a compatible node is the node id.
 * `displayModel` is the same model under the configured prefix, and `prefix`
 * is that prefix on its own. For a built-in provider, or a node without a
 * configured prefix, the two forms are identical.
 */
function buildModelAddress(connection, providerId, modelId) {
  const prefix = resolveConnectionPrefix(connection);
  const requestModel = `${providerId}/${modelId}`;
  const displayModel = `${prefix}/${modelId}`;
  return { requestModel, displayModel, prefix };
}

/**
 * Build one Playground model row from a registry (static) model.
 *
 * `requestModel` is the id sent to the gateway: always the provider id, so the
 * address stays bound to the selected node. `displayModel` carries the
 * published prefix form for the UI.
 *
 * @param {object} model
 * @param {object} connection
 * @returns {object|null}
 */
export function normalizeStaticModel(model, connection) {
  if (!model?.id) return null;
  // Agent-only static models (e.g. Devin) are not chat candidates; skip them.
  if (!isChatModel(model)) return null;
  const providerId = connection.providerId || connection.provider || connection.id;
  const { requestModel, displayModel, prefix } = buildModelAddress(connection, providerId, model.id);
  return {
    id: requestModel,
    requestModel,
    displayModel,
    prefix,
    aliases: displayModel === requestModel ? [] : [displayModel],
    name: model.name || model.id,
    providerId,
    providerName: connection.providerName || getProviderLabel(connection),
    source: "static"
  };
}

/**
 * Build one Playground model row from a live-discovered model.
 *
 * On an OpenAI-/Anthropic-compatible node every live id is addressed by the
 * node id (`<node id>/<upstream id>`) and displayed under the configured
 * prefix. The upstream id is kept whole, so a namespaced id such as
 * `vendor/model` becomes `<node id>/vendor/model`: the server splits only at
 * the first slash, so the namespace stays part of the model name and the
 * request cannot be read as a different provider's address. The raw upstream
 * id is kept as a legacy alias so a selection saved before this binding still
 * resolves. On any other provider the id is already a gateway address and is
 * kept verbatim.
 *
 * @param {object|string} model
 * @param {object} connection
 * @returns {object|null}
 */
export function normalizeLiveModel(model, connection) {
  const rawId = isString(model) ? model : model?.id || model?.name || model?.model || "";
  if (!rawId) return null;

  const displayName = isString(model) ?
  model :
  model?.name || model?.displayName || rawId;

  const providerId = connection.providerId || connection.provider || connection.id;
  let requestModel = rawId;
  let displayModel = rawId;
  let prefix = resolveConnectionPrefix(connection);
  const aliases = [];
  const isCompatible = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
  if (isCompatible) {
    ({ requestModel, displayModel, prefix } = buildModelAddress(connection, providerId, rawId));
    if (rawId.includes("/")) aliases.push(rawId);
  }
  if (displayModel !== requestModel) aliases.push(displayModel);

  return {
    id: requestModel,
    requestModel,
    displayModel,
    prefix,
    aliases,
    name: displayName,
    providerId,
    providerName: connection.providerName || getProviderLabel(connection),
    source: "live"
  };
}

/**
 * Index normalized Playground rows by their canonical request id, and index
 * every legacy alias (the display label, or a raw upstream id saved before a
 * compatible node was bound by node id) separately.
 *
 * Both maps hold arrays: the same id can be listed by two providers (a live id
 * kept verbatim on two built-in providers), and a raw upstream id saved by a
 * compatible node can also be the canonical id of another provider's row. An
 * alias is indexed even when it equals another row's canonical id, so a saved
 * selection can still be matched to the provider that saved it.
 *
 * @param {Array<{models:Array}>} providerGroups
 * @returns {{byId: Map<string, object[]>, byAlias: Map<string, object[]>}}
 */
export function buildModelIndex(providerGroups = []) {
  const byId = new Map();
  const byAlias = new Map();
  const push = (map, key, entry) => {
    const list = map.get(key);
    if (!list) map.set(key, [entry]);
    else if (!list.includes(entry)) list.push(entry);
  };
  for (const group of providerGroups) {
    for (const model of group.models || []) {
      const entry = { ...model, providerId: group.providerId, providerName: group.providerName };
      push(byId, model.id, entry);
      for (const alias of entry.aliases || []) {
        if (alias !== model.id) push(byAlias, alias, entry);
      }
    }
  }
  return { byId, byAlias };
}

/**
 * Resolve a saved model selection to one row, or `null` when it cannot be
 * resolved. An unresolved selection must be chosen explicitly again; it is
 * never replaced by a default.
 *
 * A saved provider identity binds the selection: the result always belongs to
 * that provider. A canonical request id owned by that provider wins. When the
 * id is canonical only for another provider, it is not that provider's model;
 * the id may still be a legacy alias (a raw upstream id or display label) of
 * the saved provider's own rows, and resolves only if exactly one of them owns
 * it. Without a provider identity, an id or alias resolves only when exactly
 * one row owns it, so an ambiguous selection is never guessed.
 *
 * @param {{byId: Map, byAlias: Map}} index
 * @param {string} savedId
 * @param {string} [savedProviderId]
 * @returns {object|null}
 */
export function resolveSavedModel(index, savedId, savedProviderId = "") {
  if (!savedId) return null;
  const direct = index.byId.get(savedId) || [];
  const aliased = index.byAlias.get(savedId) || [];
  if (!savedProviderId) {
    const candidates = direct.length > 0 ? direct : aliased;
    return candidates.length === 1 ? candidates[0] : null;
  }
  const own = direct.find((entry) => entry.providerId === savedProviderId);
  if (own) return own;
  const scoped = aliased.filter((entry) => entry.providerId === savedProviderId);
  return scoped.length === 1 ? scoped[0] : null;
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