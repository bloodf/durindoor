import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { resolveCredentialProxyOptions } from "../services/oauthCredentialManager.js";
import { getExecutor } from "../executors/index.js";
import { getImageAdapter } from "./imageProviders/index.js";
import { fetchImageAsBase64 } from "../translator/concerns/image.js";
import { isString, isUndefined } from "../../src/shared/utils/typeChecks.js";
import { mediaAccounting, returnedImageUnits } from "./mediaAccounting.js";

function serializeRequestBody(requestBody) {
  if (!isUndefined(FormData) && requestBody instanceof FormData) return requestBody;
  if (isString(requestBody)) return requestBody;
  return JSON.stringify(requestBody);
}

/**
 * Core image generation handler — orchestrator only.
 * Provider-specific URL/headers/body/parse/normalize live in `./imageProviders/{id}.js`.
 *
 * @param {object} options
 * @param {object} options.body - Request body { model, prompt, n, size, ... }
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {object} [options.log] - Logger
 * @param {boolean} [options.streamToClient] - Pipe SSE to client (codex)
 * @param {boolean} [options.binaryOutput] - Return raw image bytes
 * @param {function} [options.onCredentialsRefreshed]
 * @param {function} [options.onRequestSuccess]
 * @param {function} [options.onStreamComplete] - Awaited once with ({status, accounting, error}, response).
 * Codex completion resolves (never rejects) after this callback and upstream cleanup.
 * Status is success, failure, or abort; only success has complete accounting.
 * Callback rejection resolves failure with failed accounting and a client error event.
 * @returns {Promise<{ success: boolean, response: Response, accounting?: object, completion?: Promise<object>, status?: number, error?: string }>}
 */
export async function handleImageGenerationCore({
  body,
  modelInfo,
  credentials,
  log,
  streamToClient = false,
  binaryOutput = false,
  onCredentialsRefreshed,
  onRequestSuccess,
  onStreamComplete
}) {
  const { provider, model } = modelInfo;
  const proxyOptions = resolveCredentialProxyOptions(credentials);

  if (!body.prompt) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");
  }

  const adapter = getImageAdapter(provider);
  if (!adapter) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support image generation`
    );
  }

  // Executor-delegating adapters: skip manual URL/headers/body, use the proven executor flow
  if (adapter.useExecutor && adapter.executeViaExecutor) {
    try {
      log?.debug?.("IMAGE", `${provider.toUpperCase()} | ${model} | prompt="${body.prompt.slice(0, 50)}..." (executor)`);
      const responseBody = await adapter.executeViaExecutor(
        model,
        body,
        credentials,
        log,
        proxyOptions
      );
      if (onRequestSuccess) await onRequestSuccess();
      const accounting = mediaAccounting(responseBody, provider, "image");
      const normalized = adapter.normalize(responseBody, body.prompt);
      const finalBody = normalized.created && Array.isArray(normalized.data) ? normalized : responseBody;
      returnedImageUnits(accounting, finalBody);

      if (binaryOutput) {
        const first = finalBody.data?.[0];
        let b64 = first?.b64_json;
        if (!b64 && first?.url) {
          const image = await fetchImageAsBase64(first.url);
          b64 = image?.url?.split(",", 2)[1];
        }
        if (b64) {
          const buf = Buffer.from(b64, "base64");
          const fmt = (body.output_format || "png").toLowerCase();
          const mime = fmt === "jpeg" || fmt === "jpg" ? "image/jpeg" : fmt === "webp" ? "image/webp" : "image/png";
          return {
            success: true,
            accounting,
            response: new Response(buf, {
              headers: { "Content-Type": mime, "Content-Disposition": `inline; filename="image.${fmt === "jpeg" ? "jpg" : fmt}"`, "Access-Control-Allow-Origin": "*" }
            })
          };
        }
      }

      return {
        success: true,
        accounting,
        response: new Response(JSON.stringify(finalBody), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        })
      };
    } catch (error) {
      const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
      log?.debug?.("IMAGE", `Executor error: ${errMsg}`);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
    }
  }

  let url;
  let headers;
  let requestBody;

  try {
    url = adapter.buildUrl(model, credentials);
    requestBody = await adapter.buildBody(model, body);
    headers = adapter.buildHeaders(credentials, requestBody, model, body);
  } catch (error) {
    // An adapter may tag a pre-dispatch rejection with an explicit HTTP status
    // (e.g. 403 for a plan entitlement it already knows will fail upstream) so
    // combo fallback sees the real retryable status instead of a flat 400.
    const tagged = Number(error?.status);
    const status = Number.isInteger(tagged) && tagged >= 400 && tagged <= 599 ?
    tagged :
    HTTP_STATUS.BAD_REQUEST;
    return createErrorResult(status, error.message || `Invalid ${provider} image request`);
  }

  log?.debug?.("IMAGE", `${provider.toUpperCase()} | ${model} | prompt="${body.prompt.slice(0, 50)}..."`);

  let providerResponse;
  try {
    providerResponse = await fetch(url, {
      method: "POST",
      headers,
      body: serializeRequestBody(requestBody),
      proxyOptions
    });
  } catch (error) {
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("IMAGE", `Fetch error: ${errMsg}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Handle 401/403 — try token refresh (skipped for noAuth providers)
  const executor = getExecutor(provider);
  if (
  !executor?.noAuth &&
  !adapter.noAuth && (
  providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
  providerResponse.status === HTTP_STATUS.FORBIDDEN))
  {
    const newCredentials = await refreshWithRetry(
      () => executor.refreshCredentials(credentials, log, proxyOptions),
      3,
      log
    );

    if (newCredentials?.accessToken || newCredentials?.apiKey) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for image generation`);
      Object.assign(credentials, newCredentials);
      if (onCredentialsRefreshed) await onCredentialsRefreshed(newCredentials);

      try {
        const retryBody = await adapter.buildBody(model, body);
        const retryHeaders = adapter.buildHeaders(credentials, retryBody, model, body);
        const retryUrl = adapter.buildUrl(model, credentials);
        providerResponse = await fetch(retryUrl, {
          method: "POST",
          headers: retryHeaders,
          body: serializeRequestBody(retryBody),
          proxyOptions
        });
      } catch {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`);
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
    }
  }

  if (!providerResponse.ok) {
    const { statusCode, message } = await parseUpstreamError(providerResponse);
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    log?.debug?.("IMAGE", `Provider error: ${errMsg}`);
    return createErrorResult(statusCode, errMsg);
  }

  // Parse provider response — adapter may override (codex SSE / async polling / binary)
  // Parsers that consume SSE or polling envelopes need an adapter metadata hook
  // to retain receipts discarded inside parseResponse. Do not guess those fields.
  let accounting = mediaAccounting(null, provider, "image");
  if (streamToClient && provider === "codex") accounting.state = "pending";
  let parsed;
  let hasReceipt = false;
  try {
    if (adapter.parseResponse) {
      parsed = await adapter.parseResponse(providerResponse, {
        headers,
        credentials,
        log,
        streamToClient,
        onReceipt: (value, prefix) => {
          const receipt = mediaAccounting(value, provider, "image");
          if (!receipt.meta.providerUsage) return;
          hasReceipt = true;
          for (const field of ["providerUsage", "providerCost"]) {
            if (receipt.meta[field]) receipt.meta[field].path = prefix + receipt.meta[field].path;
          }
          const receipts = [...(accounting.meta.providerReceipts || []), { ...receipt.meta }];
          Object.assign(accounting, receipt, { state: accounting.state });
          accounting.meta.providerReceipts = receipts;
        },
        onStreamComplete: async (outcome, response) => {
          accounting.state = outcome.status === "success" ? "complete" : outcome.status;
          if (outcome.status === "success") returnedImageUnits(accounting, outcome.value);
          outcome.accounting = accounting;
          try {
            // Clear account health before the ledger write, so a health failure
            // cannot turn an already-persisted operation into a failed completion.
            if (outcome.status === "success" && onRequestSuccess) await onRequestSuccess();
            if (onStreamComplete) await onStreamComplete(outcome, response);
          } catch (error) {
            accounting.state = "failure";
            throw error;
          }
        },
        url,
        requestBody,
        model,
        body
      });
      // Codex streaming case: returns an SSE Response directly
      if (parsed?.sseResponse) {
        return { success: true, response: parsed.sseResponse, accounting, completion: parsed.completion };
      }
    } else {
      parsed = await providerResponse.json();
    }
  } catch (parseError) {
    // An adapter may tag a parse/validation error with an explicit HTTP status
    // (e.g. 422 for a per-request content rejection) to distinguish it from a
    // generic upstream failure. Only honor a sane client/server error status;
    // anything else stays a 502.
    const tagged = Number(parseError?.status);
    const status = Number.isInteger(tagged) && tagged >= 400 && tagged <= 599 ?
    tagged :
    HTTP_STATUS.BAD_GATEWAY;
    return createErrorResult(status, parseError.message || `Invalid response from ${provider}`);
  }

  if (onRequestSuccess) await onRequestSuccess();

  if (!hasReceipt) accounting = mediaAccounting(parsed, provider, "image");
  // Normalize → OpenAI-compatible shape
  const normalized = adapter.normalize(parsed, body.prompt);

  // Already in OpenAI shape? skip re-normalize
  const finalBody = normalized.created && Array.isArray(normalized.data) ? normalized : parsed;
  // Runway's adapter also accepts video models; those outputs are not images.
  if (provider !== "runwayml" || model.includes("image")) returnedImageUnits(accounting, finalBody);

  // Binary output: decode first b64_json (or fetch url) into raw bytes
  if (binaryOutput) {
    const first = finalBody.data?.[0];
    let b64 = first?.b64_json;
    if (!b64 && first?.url) {
      const image = await fetchImageAsBase64(first.url);
      b64 = image?.url?.split(",", 2)[1];
    }
    if (b64) {
      const buf = Buffer.from(b64, "base64");
      const fmt = (body.output_format || "png").toLowerCase();
      const mime = fmt === "jpeg" || fmt === "jpg" ? "image/jpeg" : fmt === "webp" ? "image/webp" : "image/png";
      return {
        success: true,
        accounting,
        response: new Response(buf, {
          headers: {
            "Content-Type": mime,
            "Content-Disposition": `inline; filename="image.${fmt === "jpeg" ? "jpg" : fmt}"`,
            "Access-Control-Allow-Origin": "*"
          }
        })
      };
    }
  }

  return {
    success: true,
    accounting,
    response: new Response(JSON.stringify(finalBody), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    })
  };
}