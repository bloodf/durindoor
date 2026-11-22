import { antigravityForbiddenBackoff, recordAntigravityForbidden } from "open-sse/services/antigravityCatalog.js";
import { guardedProbeFetch, getProviderValidationGuard } from "open-sse/utils/outboundUrlGuard.js";
import { cerebriumBaseUrl } from "open-sse/config/cerebrium.js";
import { getProviderModels } from "open-sse/config/providerModels.js";
import yuanbaoWebRegistry from "open-sse/providers/registry/yuanbao-web.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import { PROVIDER_MODELS_CONFIG, resolveQwenModelsUrl, resolveKimiWebModelsUrl, parseOpenAIStyleModels } from "./modelsConfig.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { applyCodexAccountHeader } from "open-sse/shared/codexAccountId.js";
import { PROVIDERS, resolveXiaomiTokenplanBaseUrl } from "open-sse/config/providers.js";
import { buildProviderProbeHeaders } from "../../providerProbe.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { sanitizeErrorMessage } from "open-sse/utils/error.js";
import { isFunction, isString } from "../../../../../shared/utils/typeChecks.js";

// Safety cap on paginated list endpoints (1000 models/page for Gemini).
const MAX_MODEL_LIST_PAGES = 20;

async function fetchCompatibleModels(connection, headersFor, proxyOptions) {
  const baseUrl = connection.providerSpecificData?.baseUrl;
  if (!baseUrl) return { error: "Missing custom base URL", status: 400 };
  const token = connection.accessToken || connection.apiKey;
  // Stored URLs are API bases (including any /v1), just like native chat URLs.
  // Provider-node credentials must not follow an unvalidated redirect. The
  // outbound guard validates the initial URL and forces manual redirect mode.
  const res = await guardedProbeFetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    method: "GET",
    headers: headersFor(token),
    cache: "no-store"
  }, getProviderValidationGuard(), (url, options) => proxyAwareFetch(url, options, proxyOptions));
  if (!res.ok) {
    const text = await res.text();
    return { error: sanitizeErrorMessage(text || res.statusText), status: res.status };
  }
  const data = await res.json();
  return { models: Array.isArray(data) ? data : data.data || [] };
}

async function fetchRegistryFetcherModels(connection, fetcher, proxyOptions) {
  // Same auth scheme and pinned headers (X-API-Key, User-Agent, ...) the
  // connection test uses, so discovery cannot fail where validation passes.
  const headers = buildProviderProbeHeaders(PROVIDERS[connection.provider] || {}, connection.apiKey);
  try {
    const response = await proxyAwareFetch(fetcher.url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(8000)
    }, proxyOptions);
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`Error fetching models from ${connection.provider}:`, sanitizeErrorMessage(errorText));
      return { error: `Failed to fetch models: ${response.status}`, status: response.status };
    }
    const data = await response.json();
    // Optional `excludeIdPattern` drops non-chat entries (whisper, embeddings, tts) from mixed catalogs.
    const exclude = isString(fetcher.excludeIdPattern) ? new RegExp(fetcher.excludeIdPattern, "i") : null;
    const models = parseOpenAIStyleModels(data).filter((model) => !exclude || !exclude.test(String(model?.id ?? "")));
    return { provider: connection.provider, connectionId: connection.id, models };
  } catch (error) {
    console.log(`Error fetching models from ${connection.provider}:`, sanitizeErrorMessage(error?.message));
    return { error: "Failed to fetch models", status: 500 };
  }
}

/**
 * Fetch a stored connection's raw model list from its provider's list-models
 * API. Shared by `GET /api/providers/[id]/models` and the model auto-sync
 * service (src/lib/modelAutoSync), so both hit the same endpoint with the same
 * auth headers, proxy route and response parser.
 *
 * @param {object} connection - stored provider connection
 * @param {{ requestUrl?: string|null, signal?: AbortSignal|null }} [options] - the
 *   incoming request URL, read by capability-scoped resolvers (OrcaRouter) for
 *   their query string, and the request's abort signal
 * @returns {Promise<{ models: object[], warning?: string, source?: string, degraded?: boolean, provider?: string, connectionId?: string } | { error: string, status: number, classification?: string }>}
 */
export async function fetchConnectionModels(connection, { requestUrl = null, signal = null } = {}) {
  // T3 Chat and Adapta publish a curated catalog; model discovery sends no
  // session cookie.
  if (connection.provider === "t3-web" || connection.provider === "adapta-web") {
    return {
      provider: connection.provider, connectionId: connection.id,
      models: getProviderModels(connection.provider), source: "local_catalog",
    };
  }

  // MaxAI and Arena publish curated web-app catalogs in their staged registry
  // entries; neither web session exposes a stable OpenAI-style /models route.
  if (connection.provider === "maxai" || connection.provider === "lmarena") {
    return {
      provider: connection.provider,
      connectionId: connection.id,
      models: getProviderModels(connection.provider),
      source: "local_catalog",
    };
  }

  if (connection.provider === "yuanbao-web") {
    return { provider: connection.provider, connectionId: connection.id, models: yuanbaoWebRegistry.models };
  }

  // Reka publishes no list-models endpoint of its own: its catalog is the
  // curated registry list, so that list is the discovery answer. The
  // connection's key is never used here and no request leaves the gateway.
  // Port of OmniRoute #1956.
  if (connection.provider === "reka") {
    const models = getProviderModels("reka");
    if (models.length > 0) {
      return {
        provider: connection.provider, connectionId: connection.id,
        models: models.map((model) => ({
          id: model.id,
          name: model.name || model.id,
          owned_by: connection.provider,
        })),
        source: "local_catalog",
      };
    }
  }

  if (connection.provider === "antigravity" && connection.id) {
    const backedOff = antigravityForbiddenBackoff(connection);
    if (backedOff) return backedOff;
  }

  // Model discovery is connection traffic too. Resolve the durable OAuth
  // egress contract once and reuse it for initial, refresh, and retry calls.
  const proxyOptions = await resolveConnectionProxyConfig(connection.providerSpecificData || {});

  if (connection.provider === "cerebrium") {
    const baseUrl = cerebriumBaseUrl(connection.providerSpecificData?.baseUrl);
    if (!baseUrl || !connection.apiKey) return { error: "Cerebrium requires a deployment /run URL and project API key", status: 400 };
    const res = await guardedProbeFetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${connection.apiKey}` }, signal: AbortSignal.timeout(8000) }, getProviderValidationGuard(), (url, options) => proxyAwareFetch(url, options, proxyOptions));
    if (!res.ok) return { error: `Model discovery failed: ${res.status}`, status: res.status };
    const data = await res.json();
    return { models: parseOpenAIStyleModels(data) };
  }

  if (isOpenAICompatibleProvider(connection.provider)) {
    return fetchCompatibleModels(connection, (token) => {
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      return headers;
    }, proxyOptions);
  }

  if (isAnthropicCompatibleProvider(connection.provider)) {
    return fetchCompatibleModels(connection, (token) => {
      const headers = { "anthropic-version": "2023-06-01", "Content-Type": "application/json" };
      if (token) headers["x-api-key"] = token;
      return headers;
    }, proxyOptions);
  }

  // NLP Cloud publishes its chatbot catalog in documentation, not a model-list API.
  if (connection.provider === "nlpcloud") {
    return { models: getProviderModels("nlpcloud"), source: "static" };
  }

  const config = PROVIDER_MODELS_CONFIG[connection.provider];
  if (!config) {
    // Platform model discovery must never borrow a Coding OAuth token.
    if (connection.provider === "kimi" && !connection.apiKey) return { error: "No valid token found", status: 401 };
    // Generic fallback for registry providers that declare a modelsFetcher
    // (e.g. Qiniu) but have no hard-coded PROVIDER_MODELS_CONFIG entry.
    const fetcher = AI_PROVIDERS[connection.provider]?.modelsFetcher;
    if (fetcher && isString(fetcher.url)) {
      return fetchRegistryFetcherModels(connection, fetcher, proxyOptions);
    }
    return { error: `Provider ${connection.provider} does not support models listing`, status: 400 };
  }

  // Config-driven custom resolver path (OAuth refresh, non-OpenAI shape, etc.)
  if (isFunction(config.customResolver)) {
    const result = await config.customResolver(connection, proxyOptions, requestUrl);
    if (result.error) return { error: result.error, status: result.status || 500 };
    const payload = { models: result.models || [], warning: result.warning };
    // Catalogs that can degrade (OrcaRouter) report where the list came from
    // so the UI can label a fallback instead of presenting it as live data.
    if (result.source) payload.source = result.source;
    if (result.degraded !== undefined) payload.degraded = result.degraded;
    return payload;
  }

  const token = config.apiKeyOnly ? connection.apiKey :
    connection.providerSpecificData?.copilotToken || connection.accessToken || connection.apiKey;
  if (!token) return { error: "No valid token found", status: 401 };

  let url = config.url;
  if (connection.provider === "xiaomi-tokenplan") url = `${resolveXiaomiTokenplanBaseUrl(connection)}/models`;
  if (connection.provider === "qwen") url = resolveQwenModelsUrl(connection);
  if (connection.provider === "kimi-web") url = resolveKimiWebModelsUrl(connection);
  if (config.authQuery) url += `?${config.authQuery}=${token}`;

  const headers = config.buildHeaders ? config.buildHeaders(token, connection) || {} : { ...config.headers };
  if (!config.buildHeaders && config.authHeader && !config.authQuery) {
    headers[config.authHeader] = (config.authPrefix || "") + token;
  }
  if (connection.provider === "codex") {
    // Account-scoped catalog: the id_token is the fallback source for the
    // ChatGPT account binding, exactly like the executor and the usage client.
    // Upstream provenance: router-for-me/CLIProxyAPI
    // `cmd/fetch_codex_models/main.go` at
    // 6faa8d20b2673404cff70a2f2d9537ae0d0e684d (`fetchModels`).
    applyCodexAccountHeader(
      headers,
      connection.providerSpecificData,
      "ChatGPT-Account-ID",
      connection.idToken
    );
  }

  const fetchOptions = { method: config.method || "GET", headers, cache: "no-store" };
  if (config.redirect) fetchOptions.redirect = config.redirect;
  if (signal) fetchOptions.signal = signal;
  // A provider whose request body depends on the connection builds it per
  // call: the Antigravity catalog carries the signed-in account's project.
  const requestBody = isFunction(config.buildBody) ? config.buildBody(token, connection) : config.body;
  if (requestBody && config.method === "POST") fetchOptions.body = JSON.stringify(requestBody);

  // A provider may declare how its probe outcome is classified, so a caller
  // can tell an auth rejection (the credential is the problem) from a
  // transient upstream failure (the catalog is temporarily unavailable).
  const classificationOf = (httpStatus) => {
    if (!isFunction(config.classifyStatus)) return null;
    const classification = config.classifyStatus(httpStatus);
    return classification ? { classification } : null;
  };

  // Cursor-paginated list endpoints (Gemini models.list: pageSize<=1000 +
  // nextPageToken) declare `pageSize` and `nextPageToken`; all others are one request.
  const models = [];
  const seenTokens = new Set();
  let pageToken = null;
  for (let page = 0; page < MAX_MODEL_LIST_PAGES; page++) {
    let pageUrl = url;
    if (config.pageSize) pageUrl += `${pageUrl.includes("?") ? "&" : "?"}pageSize=${config.pageSize}`;
    if (pageToken) pageUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
    const response = await proxyAwareFetch(pageUrl, fetchOptions, proxyOptions);
    if (!response.ok) {
      const text = await response.text();
      const result = {
        error: sanitizeErrorMessage(text || response.statusText),
        status: response.status,
        ...classificationOf(response.status)
      };
      if (connection.provider === "antigravity" && connection.id && response.status === 403) {
        recordAntigravityForbidden(connection, result);
      }
      return result;
    }
    let data;
    try {
      data = await response.json();
    } catch {
      // An unreadable body is a transient upstream failure, not an empty
      // catalog: returning an empty list here would replace a known catalog.
      return {
        error: `Invalid model catalog response from ${connection.provider}`,
        status: 502,
        ...classificationOf(502)
      };
    }
    const parsed = config.parseResponse(data);
    if (parsed === null) {
      // The provider parser could not classify this payload. Treat it as a
      // transient upstream failure so the caller keeps its known catalog.
      return {
        error: `Unrecognized model catalog from ${connection.provider}`,
        status: 502,
        ...classificationOf(502)
      };
    }
    models.push(...(parsed || []));
    pageToken = isFunction(config.nextPageToken) ? config.nextPageToken(data) : null;
    if (!pageToken) return { models };
    // A repeated cursor would loop forever; a truncated list must not pass as complete.
    if (seenTokens.has(pageToken)) return { error: "Models list pagination cursor repeated", status: 502 };
    seenTokens.add(pageToken);
  }
  return { error: `Models list exceeded ${MAX_MODEL_LIST_PAGES} pages`, status: 502 };
}
