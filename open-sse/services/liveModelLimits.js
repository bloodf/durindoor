import { createHash } from "crypto";

import { guardedProbeFetch } from "../utils/outboundUrlGuard.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

const MAX_SANE_TOKEN_LIMIT = 16_777_216;
// 2^24 tokens is far above current catalogs while bounding corrupted metadata.
const CONTAINERS = ["limits", "meta"];
const CONTEXT_KEYS = [
  "context_length",
  "context_window",
  "max_context_length",
  "max_model_len",
  "max_input_tokens",
  "contextLength",
  "contextWindow",
];
const OUTPUT_KEYS = ["max_output_tokens", "max_completion_tokens", "maxOutputTokens", "maxOutput"];


/** @type {Map<string, { expiresAt: number, models: object[] | null }>} */
const catalogCache = new Map();
/** @type {Map<string, Promise<{ models: object[] } | null>>} */
const inFlight = new Map();
/** @type {Map<string, { expiresAt: number, limits: { contextWindow?: number, maxOutput?: number } }>} */
const modelLimitsCache = new Map();

function connectionScope(connection) {
  const id = connection?.id || connection?.connectionId;
  if (id) return String(id);
  const token = connection?.apiKey || connection?.accessToken;
  return token ? createHash("sha256").update(String(token)).digest("hex") : "";
}

function modelLimitsKey(provider, connection, model) {
  const scope = connectionScope(connection);
  return provider && scope && model ? `${provider}\0${scope}\0${model}`.toLowerCase() : "";
}

function cacheModelLimits(provider, connection, models, expiresAt) {
  if (!provider || !Array.isArray(models)) return;
  for (const model of models) {
    const id = modelId(model);
    const limits = model?.capabilities;
    const key = modelLimitsKey(provider, connection, id);
    if (!key || !limits || typeof limits !== "object" || !Object.keys(limits).length) continue;
    modelLimitsCache.set(key, { expiresAt, limits });
  }
}

/**
 * Read already-fetched live limits for the selected connection without I/O.
 * Account scoping prevents sibling credentials with divergent catalogs from
 * overwriting each other's request limits.
 */
export function getCachedLiveLimits(provider, model, connection) {
  const key = modelLimitsKey(provider, connection, model);
  if (!key) return null;
  const cached = modelLimitsCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) modelLimitsCache.delete(key);
    return null;
  }
  return { ...cached.limits };
}

function cacheKey(endpoint, token) {
  return createHash("sha256").update(`${endpoint}:${token}`).digest("hex");
}

function modelId(model) {
  if (!model || typeof model !== "object" || Array.isArray(model)) return "";
  return [model.id, model.name, model.model]
    .find((value) => typeof value === "string" && value.trim() !== "")
    ?.trim() || "";
}

/**
 * Fetch and cache an OpenAI-compatible model catalog. Positive and negative
 * results share the same per-endpoint, per-credential TTL so a dead or malformed
 * upstream never adds a network call to every `/v1/models` request.
 */
export async function resolveLiveOpenAIModels(connection, options = {}) {
  const token = connection?.apiKey || connection?.accessToken;
  const psd = connection?.providerSpecificData;
  const baseUrl = typeof psd?.baseUrl === "string" ? psd.baseUrl.trim().replace(/\/$/, "") : "";
  const derivedEndpoint = options.anthropic
    ? (baseUrl.match(/\/messages(?:\/models)?$/)
        ? baseUrl.replace(/\/messages(?:\/models)?$/, "/models")
        : (baseUrl ? `${baseUrl}/models` : ""))
    : (baseUrl ? `${baseUrl}/models` : "");
  const endpoint = typeof options.endpoint === "string" && options.endpoint.trim()
    ? options.endpoint.trim()
    : derivedEndpoint;
  if (!token || !endpoint) return null;
  const key = cacheKey(endpoint, `${token}:${options.anthropic === true}:${JSON.stringify(options.modelAliases || {})}`);
  const now = Date.now();
  const cached = catalogCache.get(key);
  if (cached?.expiresAt > now) {
    if (cached.models) cacheModelLimits(options.provider, connection, cached.models, cached.expiresAt);
    return cached.models ? { models: cached.models } : null;
  }
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const cacheMiss = () => {
      catalogCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, models: null });
      return null;
    };
    try {
      let transport = (url, init) => globalThis.fetch(url, init);
      if (options.proxyOptions?.connectionProxyEnabled === true
        || options.proxyOptions?.vercelRelayUrl
        || options.proxyOptions?.disableEnvProxy === true) {
        /** Load the global-patching proxy transport only for active proxied discovery. */
        const { proxyAwareFetch } = await import("../utils/proxyFetch.js");
        transport = (url, init) => proxyAwareFetch(url, init, options.proxyOptions);
      }
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.anthropic ? {
          "x-api-key": token,
          "anthropic-version": "2023-06-01",
        } : {}),
      };
      const response = await guardedProbeFetch(endpoint, {
        method: "GET",
        headers,
        cache: "no-store",
        signal: controller.signal,
      }, options.guard, transport);
      if (!response.ok) return cacheMiss();
      const body = await response.json();
      const raw = Array.isArray(body) ? body : (body?.data ?? body?.models ?? body?.results);
      if (!Array.isArray(raw)) return cacheMiss();
      const aliases = options.modelAliases && typeof options.modelAliases === "object"
        ? options.modelAliases
        : {};
      const models = raw.flatMap((entry) => {
        const upstreamId = modelId(entry);
        if (!upstreamId) return [];
        const id = aliases[upstreamId] || upstreamId;
        const limits = extractLiveModelLimits(entry);
        return [{ id, ...(Object.keys(limits).length ? { capabilities: limits } : {}) }];
      });
      if (!models.length) return cacheMiss();
      const expiresAt = Date.now() + CACHE_TTL_MS;
      catalogCache.set(key, { expiresAt, models });
      cacheModelLimits(options.provider, connection, models, expiresAt);
      return { models };
    } catch {
      return cacheMiss();
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  }
}
/**
 * Start the cached resolver in the background. This intentionally returns
 * void: callers cannot accidentally await catalog I/O on the request path.
 */
export function warmLiveModelLimits(provider, connection, options = {}) {
  void resolveLiveOpenAIModels(connection, { ...options, provider }).catch(() => {});
}


export function clearLiveModelLimitsCache() {
  catalogCache.clear();
  modelLimitsCache.clear();
  inFlight.clear();
}
function readLimit(source, keys) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
  for (const key of keys) {
    const raw = source[key];
    if (typeof raw !== "number" && !(typeof raw === "string" && raw.trim() !== "")) continue;
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value > 0 && value <= MAX_SANE_TOKEN_LIMIT) return value;
  }
  return undefined;
}

/**
 * Extract trustworthy limits from an OpenAI-compatible `/v1/models` entry.
 * Precedence is `limits` > `meta` > root, then each alias in declaration order.
 * Invalid candidates are skipped so a later valid alias can still be used.
 */
export function extractLiveModelLimits(model) {
  if (!model || typeof model !== "object" || Array.isArray(model)) return {};
  const sources = [...CONTAINERS.map((key) => model[key]), model];
  const contextWindow = sources.map((source) => readLimit(source, CONTEXT_KEYS)).find(Boolean);
  const maxOutput = sources.map((source) => readLimit(source, OUTPUT_KEYS)).find(Boolean);
  return {
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxOutput ? { maxOutput } : {}),
  };
}
