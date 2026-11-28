import { resolveOllamaLocalHost } from "open-sse/config/providers.js";
import { discoverOllamaCatalog } from "open-sse/services/catalogs/ollamaCatalog.js";
import { isString } from "@/shared/utils/typeChecks.js";

export const OLLAMA_LOCAL_PROVIDER_ID = "ollama-local";
const OLLAMA_CATALOG_PROBE_TIMEOUT_MS = 5_000;
const OLLAMA_CATALOG_ROUTE_TTL_MS = 60_000;
const MAX_OLLAMA_CATALOG_ROUTE_ENTRIES = 512;
const ollamaCatalogRouteCache = new Map();
/**
 * Normalize an Ollama model tag for comparison: lowercased, namespace-stripped
 * and without the implicit `:latest` tag, so `llama3.2`, `llama3.2:latest` and
 * `Library/Llama3.2` all compare equal.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeOllamaModelId(value) {
  const text = isString(value) ? value.trim().toLowerCase() : "";
  if (!text) return "";
  const withoutNamespace = text.includes("/") ? text.slice(text.lastIndexOf("/") + 1) : text;
  return withoutNamespace.endsWith(":latest") ? withoutNamespace.slice(0, -":latest".length) : withoutNamespace;
}

/**
 * Whether a discovered Ollama catalog lists `model`.
 * @param {Array<object>|null} models catalog entries
 * @param {string} model requested model
 * @returns {boolean}
 */
export function ollamaCatalogServesModel(models, model) {
  const target = normalizeOllamaModelId(model);
  if (!target || !Array.isArray(models)) return false;
  return models.some((entry) =>
    normalizeOllamaModelId(entry?.id) === target ||
    normalizeOllamaModelId(entry?.name) === target);
}

/**
 * Fetch one catalog path from a node. The host is the node's own configured
 * address, so it is fetched directly (the same trust level as the executor
 * that later talks to it) with a bounded timeout.
 */
function ollamaCatalogFetchFactory(host, { signal } = {}) {
  return async (path, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OLLAMA_CATALOG_PROBE_TIMEOUT_MS);
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener?.("abort", abort, { once: true });
    try {
      return await fetch(`${host}${path}`, { ...init, cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
    }
  };
}

/**
 * Read one connection's discovered catalog and classify the requested model.
 *
 * `known: false` means the node's model list could not be read (node down,
 * probe blocked) — that is different from "the node does not serve this model".
 * A cached (last known good) catalog counts as known.
 *
 * @param {object} connection
 * @param {string} model
 * @param {{signal?: AbortSignal|null, ttlMs?: number, loader?: Function|null}} [options]
 * @returns {Promise<{known: boolean, serves: boolean}>}
 */
async function loadOllamaCatalogState(connection, model, options = {}) {
  const host = resolveOllamaLocalHost(connection);
  const accountId = connection?.id || "";
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : OLLAMA_CATALOG_ROUTE_TTL_MS;
  const cacheKey = `${accountId}\0${host}\0${normalizeOllamaModelId(model)}`;
  if (ttlMs > 0) {
    const cached = ollamaCatalogRouteCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
  }
  let value = { known: false, serves: false };
  try {
    const catalog = await discoverOllamaCatalog({
      host,
      accountId,
      fetchImpl: options.fetchImpl || ollamaCatalogFetchFactory(host, { signal: options.signal }),
    });
    const models = Array.isArray(catalog?.models) ? catalog.models : [];
    // "unavailable" means discovery failed: the node's list is unknown, not
    // empty. "cache" is the last known good catalog and counts as known.
    const known = catalog?.source !== "unavailable";
    value = { known, serves: known && ollamaCatalogServesModel(models, model) };
  } catch {
    value = { known: false, serves: false };
  }
  if (ttlMs > 0) {
    if (ollamaCatalogRouteCache.size >= MAX_OLLAMA_CATALOG_ROUTE_ENTRIES) {
      ollamaCatalogRouteCache.delete(ollamaCatalogRouteCache.keys().next().value);
    }
    ollamaCatalogRouteCache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
  }
  return value;
}

/**
 * Order ollama-local connections by what their discovered catalog says about the
 * requested model (#2024).
 *
 * - confirmed: the catalog lists the model → eligible, selected first.
 * - unknown: the catalog could not be read → still eligible, after the
 *   confirmed ones.
 * - absent: the catalog is known and does not list the model → not eligible.
 *
 * When no connection confirms the model the incoming order is returned
 * unchanged: routing keeps today's behaviour instead of refusing every node.
 *
 * @param {Array<object>} connections candidate connections
 * @param {string} model requested model
 * @param {{signal?: AbortSignal|null, ttlMs?: number, loader?: Function|null}} [options]
 * @returns {Promise<Array<object>>} eligible connections in selection order
 */
export async function rankOllamaConnectionsByCatalog(connections, model, options = {}) {
  const list = (Array.isArray(connections) ? connections : []).filter(Boolean);
  if (list.length < 2 || !model) return list;
  const loader = options.loader || loadOllamaCatalogState;
  const states = await Promise.all(list.map((connection) => loader(connection, model, options)));
  if (!states.some((state) => state?.serves)) return list;
  const confirmed = [];
  const unknown = [];
  list.forEach((connection, index) => {
    const state = states[index] || { known: false, serves: false };
    if (state.serves) confirmed.push(connection);
    else if (!state.known) unknown.push(connection);
  });
  return [...confirmed, ...unknown];
}

