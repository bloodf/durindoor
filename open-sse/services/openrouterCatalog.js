import { readBoundedResponseText } from "../utils/error.js";
import { extractLiveModelLimits } from "./liveModelLimits.js";
import { isFunction, isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

/**
 * OpenRouter's public model catalog (GET /api/v1/models).
 *
 * The endpoint answers without credentials, so no API key is ever sent: the
 * catalog is the same for every account, which also makes one process-wide
 * cache safe (unlike credential-scoped `/models` catalogs).
 *
 * Free rule: a model is free only when its id ends in `:free` (the variant
 * OpenRouter bills and rate-limits as free) AND every published pricing field
 * is exactly zero. Zero pricing alone is not enough: routers and preview
 * media models also publish "0" while billing elsewhere; OpenRouter's own
 * routers publish "-1" (variable).
 */
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_TTL_MS = 30 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
// The full catalog is ~0.7 MiB / ~450 models today; the caps leave headroom
// while bounding a hostile or corrupted response.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_MODELS = 2000;

/** @type {{ expiresAt: number, models: object[] | null } | null} */
let cached = null;
/** @type {Promise<object[] | null> | null} */
let inFlight = null;
/** @type {Map<string, object>} */
let capabilitiesById = new Map();

// isObject() also accepts null; catalog entries must be real records.
const isRecord = (value) => value !== null && isObject(value) && !Array.isArray(value);
const stringSet = (value) => new Set(Array.isArray(value) ? value.filter(isString) : []);
const isZeroPrice = (price) => (isNumber(price) || isString(price) && price.trim() !== "") && Number(price) === 0;

export function isOpenRouterFreeModel(entry) {
  if (!isRecord(entry) || !isString(entry.id) || !entry.id.endsWith(":free")) return false;
  // Only scalar fee fields are prices; nested values such as the
  // `pricing.overrides` array describe per-provider variants, not this variant's fee.
  const prices = isRecord(entry.pricing) ? Object.values(entry.pricing).filter((p) => isNumber(p) || isString(p)) : [];
  return prices.length > 0 && prices.every(isZeroPrice);
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
  if (output.has("embeddings") && !output.has("text")) model.kind = "embedding";
  return model;
}

async function fetchCatalog(fetchImpl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(OPENROUTER_MODELS_URL, {
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
    const models = body.data.slice(0, MAX_MODELS).map(mapOpenRouterModel).filter(Boolean);
    return models.length ? models : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Return the mapped catalog (cached, coalesced, fail-open: `null` on any
 * error with no earlier good catalog, so callers keep their static list).
 * `freeOnly` keeps only free models.
 */
export async function resolveOpenRouterModels({ freeOnly = false, fetchImpl = null } = {}) {
  if (!cached || cached.expiresAt <= Date.now()) {
    if (!inFlight) {
      const transport = isFunction(fetchImpl) ? fetchImpl : (url, init) => globalThis.fetch(url, init);
      inFlight = fetchCatalog(transport).then((models) => {
        if (models) {
          cached = { expiresAt: Date.now() + CACHE_TTL_MS, models };
          capabilitiesById = new Map(models.map((m) => [m.id, m.capabilities]));
          return;
        }
        // Serve the last good catalog through a failed refresh; retry later.
        cached = { expiresAt: Date.now() + FAILURE_TTL_MS, models: cached?.models ?? null };
      }).finally(() => {
        inFlight = null;
      });
    }
    await inFlight;
  }
  const models = cached?.models;
  if (!models) return null;
  return freeOnly ? models.filter((m) => m.free) : models;
}

/** Start a background refresh; never awaited on the request path. */
export function warmOpenRouterCatalog(options) {
  void resolveOpenRouterModels(options).catch(() => {});
}

/** Already-fetched (possibly stale) capabilities for one model id, without I/O. */
export function getOpenRouterModelCapabilities(modelId) {
  if (!isString(modelId)) return null;
  const caps = capabilitiesById.get(modelId);
  return caps ? { ...caps } : null;
}

export function clearOpenRouterCatalogCache() {
  cached = null;
  inFlight = null;
  capabilitiesById = new Map();
}
