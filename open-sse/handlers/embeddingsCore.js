import { createErrorResult, parseUpstreamError, formatProviderError, readBoundedResponseText } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { getExecutor } from "../executors/index.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { resolveCredentialProxyOptions } from "../services/oauthCredentialManager.js";
import { getEmbeddingAdapter } from "./embeddingProviders/index.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

/**
 * Core embeddings handler — orchestrator only. Provider-specific URL/headers/body/normalize
 * live in `./embeddingProviders/{id}.js`.
 *
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
import { isString } from "../../src/shared/utils/typeChecks.js";
export async function handleEmbeddingsCore({
  body,
  modelInfo,
  credentials,
  log,
  onCredentialsRefreshed,
  onRequestSuccess,
  signal = null
}) {
  const { provider, model } = modelInfo;
  const proxyOptions = resolveCredentialProxyOptions(credentials);

  // Validate input
  const input = body.input;
  if (!input) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  }
  if (!isString(input) && !Array.isArray(input)) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "input must be a string or array of strings");
  }

  if (provider === "cohere" && !["search_document", "search_query", "classification", "clustering"].includes(body.input_type)) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Cohere embeddings require input_type: search_document, search_query, classification, or clustering");
  }
  if (provider === "cohere" && Array.isArray(input) && input.some((value) => !isString(value))) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Cohere text embeddings require strings; use the native Embed endpoint for multimodal input");
  }
  const adapter = getEmbeddingAdapter(provider);
  if (!adapter) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support embeddings.`
    );
  }

  const ctx = { input };
  const url = adapter.buildUrl(model, credentials, ctx);
  const headers = adapter.buildHeaders(credentials, ctx);
  const requestBody = adapter.buildBody(model, {
    input,
    encoding_format: body.encoding_format || "float",
    dimensions: body.dimensions,
    input_type: body.input_type
  });

  log?.debug?.("EMBEDDINGS", `${provider.toUpperCase()} | ${model} | input_type=${Array.isArray(input) ? `array[${input.length}]` : "string"}`);

  let providerResponse;
  try {
    providerResponse = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal
    }, proxyOptions);
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return createErrorResult(499, "Embeddings request aborted");
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("EMBEDDINGS", `Fetch error: ${errMsg}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }
  if (signal?.aborted) return createErrorResult(499, "Embeddings request aborted");

  // Handle 401/403 — try token refresh (skip for noAuth providers)
  const executor = getExecutor(provider);
  if (
  !executor?.noAuth && (
  providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
  providerResponse.status === HTTP_STATUS.FORBIDDEN))
  {
    const newCredentials = await refreshWithRetry(
      () => executor.refreshCredentials(credentials, log, proxyOptions),
      3,
      log
    );

    if (newCredentials?.accessToken || newCredentials?.apiKey) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for embeddings`);
      Object.assign(credentials, newCredentials);
      if (onCredentialsRefreshed) await onCredentialsRefreshed(newCredentials);

      try {
        const retryHeaders = adapter.buildHeaders(credentials, ctx);
        const retryUrl = adapter.buildUrl(model, credentials, ctx);
        providerResponse = await proxyAwareFetch(retryUrl, {
          method: "POST",
          headers: retryHeaders,
          body: JSON.stringify(requestBody),
          signal
        }, proxyOptions);
      } catch {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`);
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
    }
  }

  if (!providerResponse.ok) {
    let statusCode, message;
    try {
      ({ statusCode, message } = await parseUpstreamError(providerResponse, null, { signal, credentials, proxyOptions }));
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return createErrorResult(499, "Embeddings request aborted");
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Unable to read embedding provider error");
    }
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    log?.debug?.("EMBEDDINGS", `Provider error: ${errMsg}`);
    return createErrorResult(statusCode, errMsg);
  }

  let responseBody;
  try {
    responseBody = provider === "cohere" ?
      JSON.parse(await readBoundedResponseText(providerResponse, { signal, maxBytes: 8 * 1024 * 1024, timeoutMs: 10000, throwOnTimeout: true })) :
      await providerResponse.json();
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return createErrorResult(499, "Embeddings request aborted");
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
  }

  let normalized;
  try { normalized = adapter.normalize(responseBody, model); } catch {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid embeddings response from ${provider}`);
  }
  if (onRequestSuccess) await onRequestSuccess();
  log?.debug?.("EMBEDDINGS", `Success | usage=${JSON.stringify(normalized.usage || {})}`);

  return {
    success: true,
    response: new Response(JSON.stringify(normalized), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    })
  };
}