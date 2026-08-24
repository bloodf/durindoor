import { createHash } from "crypto";

import { guardedProbeFetch } from "../utils/outboundUrlGuard.js";
import { isFunction, isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

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
"contextWindow"];

const OUTPUT_KEYS = ["max_output_tokens", "max_completion_tokens", "max_tokens", "maxOutputTokens", "maxOutput"];


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
    if (!key || !limits || !isObject(limits) || !Object.keys(limits).length) continue;
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
  if (!model || !isObject(model) || Array.isArray(model)) return "";
  return [model.id, model.name, model.model].
  find((value) => isString(value) && value.trim() !== "")?.
  trim() || "";
}

/**
 * Fetch and cache an OpenAI-compatible model catalog. Positive and negative
 * results share the same per-endpoint, per-credential TTL so a dead or malformed
 * upstream never adds a network call to every `/v1/models` request.
 */
export async function resolveLiveOpenAIModels(connection, options = {}) {
  const token = options.token || connection?.apiKey || connection?.accessToken;
  const psd = connection?.providerSpecificData;
  const baseUrl = isString(psd?.baseUrl) ? psd.baseUrl.trim().replace(/\/$/, "") : "";
  const derivedEndpoint = options.anthropic ?
  baseUrl.match(/\/messages(?:\/models)?$/) ?
  baseUrl.replace(/\/messages(?:\/models)?$/, "/models") :
  baseUrl ? `${baseUrl}/models` : "" :
  baseUrl ? `${baseUrl}/models` : "";
  const endpoint = isString(options.endpoint) && options.endpoint.trim() ?
  options.endpoint.trim() :
  derivedEndpoint;
  if (!token || !endpoint) return null;
  const key = cacheKey(endpoint, `${token}:${options.cacheVariant || options.anthropic === true}:${JSON.stringify(options.modelAliases || {})}`);
  const now = Date.now();
  const cached = catalogCache.get(key);
  if (cached?.expiresAt > now) {
    if (cached.models) cacheModelLimits(options.provider, connection, cached.models, cached.expiresAt);
    return cached.models ? { models: cached.models } : null;
  }
  if (inFlight.has(key)) {
    const result = await inFlight.get(key);
    const expiresAt = catalogCache.get(key)?.expiresAt;
    if (result?.models && expiresAt) cacheModelLimits(options.provider, connection, result.models, expiresAt);
    return result;
  }

  const promise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const cacheMiss = () => {
      catalogCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, models: null });
      return null;
    };
    try {
      let transport = (url, init) => globalThis.fetch(url, init);
      if (options.proxyOptions?.connectionProxyEnabled === true ||
      options.proxyOptions?.vercelRelayUrl ||
      options.proxyOptions?.disableEnvProxy === true) {
        /** Load the global-patching proxy transport only for active proxied discovery. */
        const { proxyAwareFetch } = await import("../utils/proxyFetch.js");
        transport = (url, init) => proxyAwareFetch(url, init, options.proxyOptions);
      }
      const headers = options.headers || {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.anthropic ? {
          "x-api-key": token,
          "anthropic-version": "2023-06-01"
        } : null)
      };
      const response = await guardedProbeFetch(endpoint, {
        method: "GET",
        headers,
        cache: "no-store",
        signal: controller.signal
      }, options.guard, transport);
      if (!response.ok) return cacheMiss();
      const body = await response.json();
      const raw = isFunction(options.selectModels) ?
      options.selectModels(body) :
      Array.isArray(body) ? body : body?.data ?? body?.models ?? body?.results;
      if (!Array.isArray(raw)) return cacheMiss();
      const aliases = options.modelAliases && isObject(options.modelAliases) ?
      options.modelAliases :
      {};
      const models = raw.flatMap((entry) => {
        if (isFunction(options.normalizeModel)) {
          const normalized = options.normalizeModel(entry);
          return normalized && isObject(normalized) ? [normalized] : [];
        }
        const upstreamId = modelId(entry);
        if (!upstreamId) return [];
        const id = aliases[upstreamId] || upstreamId;
        const limits = extractLiveModelLimits(entry);
        return [{ id, ...(Object.keys(limits).length ? { capabilities: limits } : null) }];
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

function anthropicCapabilities(entry) {
  const published = entry?.capabilities;
  if (!published || !isObject(published) || Array.isArray(published)) return {};
  const thinking = published.thinking;
  const types = thinking && isObject(thinking) && !Array.isArray(thinking) ?
  thinking.types :
  null;
  const supported = (value) => value === true ||
  value && isObject(value) && !Array.isArray(value) && value.supported === true;

  const enabled = supported(types?.enabled);
  const adaptive = supported(types?.adaptive);
  const reasoning = Boolean(supported(thinking) || thinking?.supported === true || enabled || adaptive);
  return {
    ...(published.image_input !== undefined ? { vision: supported(published.image_input) } : null),
    ...(published.pdf_input !== undefined ? { pdf: supported(published.pdf_input) } : null),
    ...(thinking !== undefined ? {
      reasoning,
      thinkingCanDisable: reasoning ? enabled : true,
      thinkingFormat: reasoning ? adaptive ? "claude-adaptive" : "claude-budget" : null
    } : null)
  };
}

/**
 * Resolve Anthropic's account catalog without changing registry routing data.
 * OAuth uses only the stored bearer; API-key connections keep x-api-key auth.
 */
export function resolveLiveAnthropicModels(connection, options = {}) {
  const oauthToken = connection?.accessToken;
  const apiKey = connection?.apiKey;
  const token = oauthToken || apiKey;
  if (!token) return Promise.resolve(null);
  return resolveLiveOpenAIModels(connection, {
    ...options,
    token,
    endpoint: "https://api.anthropic.com/v1/models?limit=100",
    cacheVariant: `anthropic:${oauthToken ? "oauth" : "apikey"}`,
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(oauthToken ?
      { Authorization: `Bearer ${oauthToken}` } :
      { "x-api-key": apiKey })
    },
    normalizeModel: (entry) => {
      const id = modelId(entry);
      if (!id) return null;
      const capabilities = {
        ...extractLiveModelLimits(entry),
        ...anthropicCapabilities(entry)
      };
      return { id, ...(Object.keys(capabilities).length ? { capabilities } : null) };
    }
  });
}

/** Enrich only static Cloudflare routes; its search API spans unsupported kinds and paginates inconsistently. */
export function resolveLiveCloudflareModels(connection, options = {}) {
  const accountId = connection?.providerSpecificData?.accountId;
  const token = connection?.apiKey || connection?.accessToken;
  if (!isString(accountId) || !accountId.trim() || !token) return Promise.resolve(null);
  return resolveLiveOpenAIModels(connection, {
    ...options,
    token,
    endpoint: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId.trim())}/ai/models/search?per_page=100`,
    cacheVariant: "cloudflare-search-v1",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    selectModels: (body) => body?.result,
    normalizeModel: (entry) => {
      const id = modelId(entry);
      if (!id) return null;
      const property = Array.isArray(entry?.properties) ?
      entry.properties.find((item) => item?.property_id === "context_window") :
      null;
      const capabilities = extractLiveModelLimits({ context_window: property?.value });
      return { id, ...(capabilities.contextWindow ? { capabilities } : null) };
    }
  });
}

/** Enumerate provider IDs only; the endpoint publishes no trustworthy limits or capabilities. */
export function resolveLiveModelIds(connection, endpoint, options = {}) {
  const token = connection?.apiKey || connection?.accessToken;
  if (!token || !endpoint) return Promise.resolve(null);
  return resolveLiveOpenAIModels(connection, {
    ...options,
    token,
    endpoint,
    cacheVariant: `ids:${endpoint}`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    normalizeModel: (entry) => {
      const id = modelId(entry);
      return id ? { id } : null;
    }
  });
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
  if (!source || !isObject(source) || Array.isArray(source)) return undefined;
  for (const key of keys) {
    const raw = source[key];
    if (!isNumber(raw) && !(isString(raw) && raw.trim() !== "")) continue;
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
  if (!model || !isObject(model) || Array.isArray(model)) return {};
  const sources = [...CONTAINERS.map((key) => model[key]), model];
  const contextWindow = sources.map((source) => readLimit(source, CONTEXT_KEYS)).find(Boolean);
  const maxOutput = sources.map((source) => readLimit(source, OUTPUT_KEYS)).find(Boolean);
  return {
    ...(contextWindow ? { contextWindow } : null),
    ...(maxOutput ? { maxOutput } : null)
  };
}