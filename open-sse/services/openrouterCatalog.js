import { createHash } from "node:crypto";
import { hasPaidEvidence } from "../config/freeModelCatalog.js";
import { readBoundedResponseText } from "../utils/error.js";
import { extractLiveModelLimits } from "./modelMetadata.js";
import { createCatalogCache } from "./catalogCache.js";
import { isFunction, isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

/**
 * OpenRouter's public model catalogs:
 *   - GET /api/v1/models (default listing)
 *   - GET /api/v1/models?output_modalities=decisions (System One decision models,
 *     which OpenRouter omits from the default listing)
 *
 * Both endpoints answer without credentials, so no API key is ever sent.
 * Cache entries are isolated by effective outbound proxy policy so proxied and
 * direct connections never share egress state or bypass strict proxy boundaries.
 *
 * Free rule: a model is free only when its id ends in `:free` (the variant
 * OpenRouter bills and rate-limits as free) AND every published pricing field
 * is exactly zero. Zero pricing alone is not enough: routers and preview
 * media models also publish "0" while billing elsewhere; OpenRouter's own
 * routers publish "-1" (variable).
 */
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
export const OPENROUTER_DECISIONS_MODELS_URL = `${OPENROUTER_MODELS_URL}?output_modalities=decisions`;
const CACHE_TTL_MS = 30 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
// How long a merged lookup waits for the secondary decisions listing after the
// primary catalog is ready. Model-list callers give the whole lookup
// LIVE_CATALOG_WAIT_MS (3s, src/shared/models/catalogDeadline.js); waiting the
// full FETCH_TIMEOUT_MS here would turn a fast primary answer into a static
// fallback. A slower decisions fetch keeps running (still capped by
// FETCH_TIMEOUT_MS) and fills the per-route cache for later lookups.
const DECISIONS_WAIT_MS = 1000;
// The full catalog is ~0.7 MiB / ~450 models today; the caps leave headroom
// while bounding a hostile or corrupted response.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_MODELS = 2000;
const MAX_ROUTE_ENTRIES = 64;

const CACHE_KEY = "openrouter";
const catalogCache = createCatalogCache({ ttlMs: CACHE_TTL_MS, negativeTtlMs: FAILURE_TTL_MS, maxEntries: MAX_ROUTE_ENTRIES });
const decisionsCache = createCatalogCache({ ttlMs: CACHE_TTL_MS, negativeTtlMs: FAILURE_TTL_MS, maxEntries: MAX_ROUTE_ENTRIES });
/** @type {Map<string, object[]>} Served through a failed primary refresh, per egress route. */
const lastGoodPrimary = new Map();
/** @type {Map<string, object[]>} Served through a failed decisions refresh, per egress route. */
const lastGoodDecisions = new Map();
/** @type {Map<string, object>} */
let capabilitiesById = new Map();

// isObject() also accepts null; catalog entries must be real records.
const isRecord = (value) => value !== null && isObject(value) && !Array.isArray(value);
const stringSet = (value) => new Set(Array.isArray(value) ? value.filter(isString) : []);
const isZeroPrice = (price) => (isNumber(price) || isString(price) && price.trim() !== "") && Number(price) === 0;

function hasActiveProxyPolicy(proxyOptions) {
  if (!isRecord(proxyOptions)) return false;
  return proxyOptions.connectionProxyEnabled === true ||
    Boolean(proxyOptions.vercelRelayUrl) ||
    proxyOptions.disableEnvProxy === true ||
    proxyOptions.strictProxy === true ||
    proxyOptions.source === "error";
}

function cacheKeyFor(proxyOptions) {
  if (!hasActiveProxyPolicy(proxyOptions)) return CACHE_KEY;
  const digest = createHash("sha256").update(JSON.stringify([
    proxyOptions.source || "",
    proxyOptions.proxyPoolId || "",
    proxyOptions.connectionProxyEnabled === true,
    proxyOptions.connectionProxyUrl || "",
    proxyOptions.connectionNoProxy || "",
    proxyOptions.vercelRelayUrl || "",
    proxyOptions.strictProxy === true,
    proxyOptions.disableEnvProxy === true
  ])).digest("hex");
  return `${CACHE_KEY}:${digest}`;
}

function rememberRoute(store, routeKey, models) {
  store.delete(routeKey);
  if (store.size >= MAX_ROUTE_ENTRIES) store.delete(store.keys().next().value);
  store.set(routeKey, models);
  rebuildCapabilitiesIndex();
}

function rebuildCapabilitiesIndex() {
  const next = new Map();
  for (const list of lastGoodPrimary.values()) {
    for (const model of list) next.set(model.id, model.capabilities);
  }
  for (const list of lastGoodDecisions.values()) {
    for (const model of list) {
      if (!next.has(model.id)) next.set(model.id, model.capabilities);
    }
  }
  capabilitiesById = next;
}

async function resolveTransport(fetchImpl, proxyOptions) {
  if (isFunction(fetchImpl)) return fetchImpl;
  if (hasActiveProxyPolicy(proxyOptions)) {
    const { proxyAwareFetch } = await import("../utils/proxyFetch.js");
    return (url, init) => proxyAwareFetch(url, init, proxyOptions);
  }
  return (url, init) => globalThis.fetch(url, init);
}

export function isOpenRouterFreeModel(entry) {
  if (hasPaidEvidence(entry)) return false;
  if (!isRecord(entry) || !isString(entry.id) || !entry.id.endsWith(":free")) return false;
  // Only scalar fee fields are prices; nested values such as the
  // `pricing.overrides` array describe per-provider variants, not this variant's fee.
  const prices = isRecord(entry.pricing) ? Object.values(entry.pricing).filter((p) => isNumber(p) || isString(p)) : [];
  return prices.length > 0 && prices.every(isZeroPrice);
}

export function isOpenRouterDecisionModel(entry) {
  if (!isRecord(entry)) return false;
  const architecture = isRecord(entry.architecture) ? entry.architecture : {};
  return stringSet(architecture.output_modalities).has("decisions");
}

/**
 * Map one catalog entry onto the fork's capability fields
 * (see DEFAULT_CAPABILITIES in open-sse/providers/capabilities.js).
 */
export function mapOpenRouterModel(entry) {
  if (!isRecord(entry) || !isString(entry.id) || !entry.id.trim()) return null;
  const architecture = isRecord(entry.architecture) ? entry.architecture : {};
  const topProvider = isRecord(entry.top_provider) ? entry.top_provider : {};
  const input = stringSet(architecture.input_modalities);
  const output = stringSet(architecture.output_modalities);
  const params = stringSet(entry.supported_parameters);
  const model = {
    id: entry.id.trim(),
    name: isString(entry.name) && entry.name.trim() ? entry.name.trim() : entry.id.trim(),
    free: isOpenRouterFreeModel(entry),
    capabilities: {
      ...extractLiveModelLimits({
        context_length: entry.context_length ?? topProvider.context_length,
        max_completion_tokens: topProvider.max_completion_tokens
      }),
      vision: input.has("image"),
      pdf: input.has("file"),
      audioInput: input.has("audio"),
      videoInput: input.has("video"),
      imageOutput: output.has("image"),
      audioOutput: output.has("audio"),
      tools: params.has("tools"),
      reasoning: params.has("reasoning") || params.has("include_reasoning")
    }
  };
  if (output.has("decisions")) model.kind = "systemone";
  else if (output.has("embeddings") && !output.has("text")) model.kind = "embedding";
  return model;
}

export function mergeOpenRouterCatalogs(primaryModels, decisionModels) {
  const primary = Array.isArray(primaryModels) ? primaryModels : [];
  const decisions = Array.isArray(decisionModels) ? decisionModels : [];
  if (!decisions.length) return primary;
  const known = new Set(primary.map((model) => model.id));
  return [...primary, ...decisions.filter((model) => !known.has(model.id))];
}

async function fetchCatalogList(fetchImpl, url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: controller.signal
    });
    if (!response?.ok) return null;
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;
    const text = await readBoundedResponseText(response, {
      signal: controller.signal,
      maxBytes: MAX_RESPONSE_BYTES,
      timeoutMs: FETCH_TIMEOUT_MS
    });
    if (!text) return null;
    const body = JSON.parse(text);
    if (!Array.isArray(body?.data)) return null;
    return body.data.slice(0, MAX_MODELS).map(mapOpenRouterModel).filter(Boolean);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadDecisionModels(routeKey, transport) {
  await decisionsCache.load(routeKey, async () => {
    const fetched = await fetchCatalogList(transport, OPENROUTER_DECISIONS_MODELS_URL);
    if (!fetched) return null;
    rememberRoute(lastGoodDecisions, routeKey, fetched);
    return fetched;
  });
  return lastGoodDecisions.get(routeKey) || null;
}

/**
 * Wait at most `waitMs` for the decisions listing. On timeout, answer with the
 * route's last good decisions (or `null`) while the coalesced fetch continues
 * in the background; its settlement, including any rejection, is consumed here.
 */
async function loadDecisionModelsBounded(routeKey, transport, waitMs) {
  const lastGood = () => lastGoodDecisions.get(routeKey) || null;
  const pending = loadDecisionModels(routeKey, transport).catch(lastGood);
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(lastGood()), waitMs);
  });
  try {
    return await Promise.race([pending, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Return the mapped catalog (cached, coalesced, fail-open: `null` on any
 * error with no earlier good catalog, so callers keep their static list).
 *
 * When `includeDecisions` is true, also fetches OpenRouter's separate
 * `output_modalities=decisions` listing and merges its entries with the
 * primary catalog; a failed secondary request leaves the primary catalog
 * usable. The secondary request is awaited for at most `decisionsWaitMs`
 * after the primary catalog is ready; a slower one continues in the
 * background and is merged on a later call. `freeOnly` keeps only free models (plus `systemone` decision models
 * when `includeDecisions` is true).
 */
export async function resolveOpenRouterModels({
  freeOnly = false,
  includeDecisions = false,
  decisionsWaitMs = DECISIONS_WAIT_MS,
  proxyOptions = null,
  fetchImpl = null
} = {}) {
  const routeKey = cacheKeyFor(proxyOptions);
  const transport = await resolveTransport(fetchImpl, proxyOptions);
  await catalogCache.load(routeKey, async () => {
    const fetched = await fetchCatalogList(transport, OPENROUTER_MODELS_URL);
    if (!fetched?.length) return null;
    rememberRoute(lastGoodPrimary, routeKey, fetched);
    return fetched;
  });
  const primary = lastGoodPrimary.get(routeKey) || null;
  if (!primary) return null;

  let models = primary;
  if (includeDecisions) {
    const decisions = await loadDecisionModelsBounded(routeKey, transport, decisionsWaitMs);
    models = mergeOpenRouterCatalogs(primary, decisions || []);
  }

  if (!freeOnly) return models;
  return includeDecisions
    ? models.filter((m) => m.free || m.kind === "systemone")
    : models.filter((m) => m.free);
}

/**
 * Return only OpenRouter's discovered System One decision models
 * (`output_modalities=decisions`), sharing the same per-egress cache and TTL
 * as `resolveOpenRouterModels`. Returns `null` when unavailable.
 */
export async function resolveOpenRouterDecisionModels({ proxyOptions = null, fetchImpl = null } = {}) {
  const routeKey = cacheKeyFor(proxyOptions);
  const transport = await resolveTransport(fetchImpl, proxyOptions);
  const decisions = await loadDecisionModels(routeKey, transport);
  return decisions ? decisions.filter((m) => m.kind === "systemone") : null;
}

/** Start a background refresh; never awaited on the request path. */
export function warmOpenRouterCatalog(options = {}) {
  void resolveOpenRouterModels({ includeDecisions: true, ...options }).catch(() => {});
}

/** Already-fetched (possibly stale) capabilities for one model id, without I/O. */
export function getOpenRouterModelCapabilities(modelId) {
  if (!isString(modelId)) return null;
  const caps = capabilitiesById.get(modelId);
  return caps ? { ...caps } : null;
}

export function clearOpenRouterCatalogCache() {
  catalogCache.clear();
  decisionsCache.clear();
  lastGoodPrimary.clear();
  lastGoodDecisions.clear();
  capabilitiesById = new Map();
}
