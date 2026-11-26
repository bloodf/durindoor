import { applyOpenRouterRouting } from "../services/openrouterRouting.js";
import { createErrorResult, errorEnvelopeMessage, parseUpstreamError, formatProviderError, readBoundedResponseText } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { getExecutor } from "../executors/index.js";
import { refreshMediaCredentials } from "./mediaRefresh.js";
import { resolveCredentialProxyOptions } from "../services/oauthCredentialManager.js";
import { getEmbeddingAdapter } from "./embeddingProviders/index.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { mediaAccounting } from "./mediaAccounting.js";
import { getModelMeta, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";
import { modelParams } from "../providers/models/schema.js";
import { resolveInputType } from "../config/embeddingParams.js";

/**
 * False when a returned `data[].embedding` is empty or not numeric. Empty `data`
 * and non-OpenAI bodies keep passing through.
 */
function hasValidVectors(normalized) {
  if (!Array.isArray(normalized?.data)) return true;
  return normalized.data.every((item) => {
    const embedding = item?.embedding;
    if (embedding === undefined) return true;
    if (typeof embedding === "string") return embedding.length > 0;
    return Array.isArray(embedding) && embedding.length > 0 && embedding.every((value) => Number.isFinite(value));
  });
}

/**
 * Core embeddings handler — orchestrator only. Provider-specific URL/headers/body/normalize
 * live in `./embeddingProviders/{id}.js`.
 *
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
import { isFunction, isString } from "../../src/shared/utils/typeChecks.js";
export async function handleEmbeddingsCore({
  body,
  modelInfo,
  routingPolicy,
  credentials,
  log,
  onCredentialsRefreshed,
  refreshCredentials,
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
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const declaredParams = modelParams(getModelMeta(alias, model));
  const inputType = declaredParams.includes("input_type")
    ? resolveInputType(declaredParams, body.input_type)
    : body.input_type;
  const url = adapter.buildUrl(model, credentials, ctx);
  const headers = adapter.buildHeaders(credentials, ctx);
  let requestBody = adapter.buildBody(model, {
    input,
    encoding_format: body.encoding_format || "float",
    dimensions: body.dimensions,
  });
  if (inputType) requestBody.input_type = inputType;
  if (provider === "openrouter") {
    try { requestBody = applyOpenRouterRouting({ ...requestBody, provider: body.provider }, routingPolicy, "embedding"); }
    catch (error) { return createErrorResult(HTTP_STATUS.BAD_REQUEST, error.message); }
  }

  log?.debug?.("EMBEDDINGS", `${provider.toUpperCase()} | ${model} | input=${Array.isArray(input) ? `array[${input.length}]` : "string"}${inputType ? ` | input_type=${inputType}` : ""}`);

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
    const newCredentials = await refreshMediaCredentials({ provider, executor, credentials, refreshCredentials, log, proxyOptions });

    if (newCredentials?.accessToken || newCredentials?.apiKey) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for embeddings`);
      Object.assign(credentials, newCredentials);
      // An injected refresher has already committed what it returns.
      if (!isFunction(refreshCredentials) && onCredentialsRefreshed) await onCredentialsRefreshed(newCredentials);

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

  // HTTP 200 is not success on its own: an error envelope or an unusable vector
  // fails before the account is marked healthy (9router #5864).
  const envelopeError = errorEnvelopeMessage(responseBody);
  if (envelopeError) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, envelopeError, undefined, undefined, null, credentials);

  // Read the original provider receipt, never adapter-generated zero usage.
  const accounting = mediaAccounting(responseBody, provider, "embedding");
  let normalized;
  try { normalized = adapter.normalize(responseBody, model); } catch {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid embeddings response from ${provider}`);
  }
  if (!hasValidVectors(normalized)) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${provider} returned no valid embedding vectors`);
  }
  if (onRequestSuccess) await onRequestSuccess();
  log?.debug?.("EMBEDDINGS", `Success | usage=${JSON.stringify(normalized.usage || {})}`);

  return {
    success: true,
    accounting,
    response: new Response(JSON.stringify(normalized), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    })
  };
}
