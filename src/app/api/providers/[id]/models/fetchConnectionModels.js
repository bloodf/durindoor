import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import { PROVIDER_MODELS_CONFIG, resolveQwenModelsUrl, resolveKimiWebModelsUrl, parseOpenAIStyleModels } from "./modelsConfig.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { applyCodexAccountHeader } from "open-sse/shared/codexAccountId.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { sanitizeErrorMessage } from "open-sse/utils/error.js";
import { isFunction, isString } from "../../../../../shared/utils/typeChecks.js";

async function fetchCompatibleModels(connection, headersFor, proxyOptions) {
  const baseUrl = connection.providerSpecificData?.baseUrl;
  if (!baseUrl) return { error: "Missing custom base URL", status: 400 };
  const token = connection.accessToken || connection.apiKey;
  if (!token) return { error: "No valid token found", status: 401 };

  const res = await proxyAwareFetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
    method: "GET",
    headers: headersFor(token),
    cache: "no-store"
  }, proxyOptions);
  if (!res.ok) {
    const text = await res.text();
    return { error: sanitizeErrorMessage(text || res.statusText), status: res.status };
  }
  const data = await res.json();
  return { models: Array.isArray(data) ? data : data.data || [] };
}

async function fetchRegistryFetcherModels(connection, fetcher, proxyOptions) {
  const headers = { "Content-Type": "application/json" };
  if (connection.apiKey) headers.Authorization = `Bearer ${connection.apiKey}`;
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
    return { provider: connection.provider, connectionId: connection.id, models: parseOpenAIStyleModels(data) };
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
 * @param {{ requestUrl?: string|null }} [options] - the incoming request URL,
 *   read by capability-scoped resolvers (OrcaRouter) for their query string
 * @returns {Promise<{ models: object[], warning?: string, source?: string, degraded?: boolean, provider?: string, connectionId?: string } | { error: string, status: number }>}
 */
export async function fetchConnectionModels(connection, { requestUrl = null } = {}) {
  // Model discovery is connection traffic too. Resolve the durable OAuth
  // egress contract once and reuse it for initial, refresh, and retry calls.
  const proxyOptions = await resolveConnectionProxyConfig(connection.providerSpecificData || {});

  if (isOpenAICompatibleProvider(connection.provider)) {
    return fetchCompatibleModels(connection, (token) => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }), proxyOptions);
  }

  if (isAnthropicCompatibleProvider(connection.provider)) {
    return fetchCompatibleModels(connection, (token) => ({
      "x-api-key": token,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    }), proxyOptions);
  }

  const config = PROVIDER_MODELS_CONFIG[connection.provider];
  if (!config) {
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

  const token = connection.providerSpecificData?.copilotToken || connection.accessToken || connection.apiKey;
  if (!token) return { error: "No valid token found", status: 401 };

  let url = config.url;
  if (connection.provider === "qwen") url = resolveQwenModelsUrl(connection);
  if (connection.provider === "kimi-web") url = resolveKimiWebModelsUrl(connection);
  if (config.authQuery) url += `?${config.authQuery}=${token}`;

  const headers = config.buildHeaders ? config.buildHeaders(token, connection) || {} : { ...config.headers };
  if (!config.buildHeaders && config.authHeader && !config.authQuery) {
    headers[config.authHeader] = (config.authPrefix || "") + token;
  }
  if (connection.provider === "codex") {
    applyCodexAccountHeader(headers, connection.providerSpecificData);
  }

  const fetchOptions = { method: config.method || "GET", headers, cache: "no-store" };
  if (config.body && config.method === "POST") fetchOptions.body = JSON.stringify(config.body);

  const response = await proxyAwareFetch(url, fetchOptions, proxyOptions);
  if (!response.ok) {
    const text = await response.text();
    return { error: sanitizeErrorMessage(text || response.statusText), status: response.status };
  }
  const data = await response.json();
  return { models: config.parseResponse(data) || [] };
}
