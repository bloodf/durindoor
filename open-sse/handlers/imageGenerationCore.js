import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { FETCH_TIMEOUT_MS } from "../config/mediaConfig.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { resolveCredentialProxyOptions } from "../services/oauthCredentialManager.js";
import { getExecutor } from "../executors/index.js";
import { getImageAdapter } from "./imageProviders/index.js";
import { fetchImageAsBase64, detectImageMime } from "../translator/concerns/image.js";
import { isString, isUndefined } from "../../src/shared/utils/typeChecks.js";
import { mediaAccounting, returnedImageUnits } from "./mediaAccounting.js";

function serializeRequestBody(requestBody) {
  if (!isUndefined(FormData) && requestBody instanceof FormData) return requestBody;
  if (isString(requestBody)) return requestBody;
  return JSON.stringify(requestBody);
}

/**
 * Raw image bytes response.
 *
 * The Content-Type comes from the bytes' own magic signature, not from the
 * requested `output_format`: Cloudflare FLUX and Leonardo answer with JPEG
 * even when the request asked for PNG, and labelling those bytes `image/png`
 * made clients save a broken file. The requested format stays the fallback
 * for bytes the sniffer does not recognize.
 */
function binaryImageResponse(base64, outputFormat) {
  const buf = Buffer.from(base64, "base64");
  const fmt = (outputFormat || "png").toLowerCase();
  const mime = detectImageMime(buf) ||
    (fmt === "jpeg" || fmt === "jpg" ? "image/jpeg" : fmt === "webp" ? "image/webp" : "image/png");
  const extension = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
  return new Response(buf, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="image.${extension}"`,
      "Access-Control-Allow-Origin": "*"
    }
  });
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
 * @param {boolean} [options.binaryOutput] - Return raw image bytes (rejects n > 1 with 400 before dispatch)
 * @param {AbortSignal} [options.signal] - Client abort signal; forwarded to upstream fetches and async polling
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
  onStreamComplete,
  signal
}) {
  const { provider, model } = modelInfo;
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  // Client disconnects are not provider failures: callers must not cool down the account.
  const isAbort = (error) => signal?.aborted || error?.name === "AbortError";
  const abortedResult = () => createErrorResult(499, "Image generation request aborted");
  // A 2xx async submit means the provider took the job and may bill it, whatever we
  // observe afterwards. No measured units or receipt exist, so the cost stays unknown.
  const withAcceptedJob = (result) => ({
    ...result,
    acceptedJob: { ...mediaAccounting(null, provider, "image"), costSource: "accepted-job", meta: { jobState: "accepted" } }
  });
  // fetchImageAsBase64 drops its own timeout when given a signal, so keep it here.
  // Built per call: the timeout must start at the prefetch, not at core entry.
  const imageFetchOptions = () => (signal ? { signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) } : undefined);

  if (!body.prompt) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");
  }

  // Binary output carries a single image response; reject n > 1 before billing upstream.
  if (binaryOutput && Number(body.n) > 1) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      "Binary image output (response_format=binary) supports at most n=1"
    );
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
        proxyOptions,
        signal,
        onCredentialsRefreshed
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
          const image = await fetchImageAsBase64(first.url, imageFetchOptions());
          b64 = image?.url?.split(",", 2)[1];
        }
        if (b64) {
          return {
            success: true,
            accounting,
            response: binaryImageResponse(b64, body.output_format)
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
      if (isAbort(error)) return abortedResult();
      // Executor adapters may tag the upstream status and quota reset.
      const tagged = Number(error?.status);
      const status = Number.isInteger(tagged) && tagged >= 400 && tagged <= 599 ? tagged : HTTP_STATUS.BAD_GATEWAY;
      const errMsg = formatProviderError(error, provider, model, status);
      log?.debug?.("IMAGE", `Executor error: ${errMsg}`);
      return createErrorResult(status, errMsg, Number.isFinite(error?.resetsAtMs) ? error.resetsAtMs : undefined);
    }
  }

  let url;
  let headers;
  let requestBody;
  const adapterOptions = { streamToClient, signal };

  try {
    url = adapter.buildUrl(model, credentials, body, adapterOptions);
    requestBody = await adapter.buildBody(model, body, adapterOptions);
    headers = adapter.buildHeaders(credentials, requestBody, model, body);
  } catch (error) {
    if (isAbort(error)) return abortedResult();
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
      signal,
      proxyOptions
    });
  } catch (error) {
    if (isAbort(error)) return abortedResult();
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
        requestBody = await adapter.buildBody(model, body, adapterOptions);
        headers = adapter.buildHeaders(credentials, requestBody, model, body);
        url = adapter.buildUrl(model, credentials, body, adapterOptions);
        providerResponse = await fetch(url, {
          method: "POST",
          headers,
          body: serializeRequestBody(requestBody),
          signal,
          proxyOptions
        });
      } catch (error) {
        if (isAbort(error)) return abortedResult();
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`);
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
    }
  }

  // Codex's parser knows its relative reset field; the shared parser bounds it
  // and classifies the response before any reset can reach account health.
  const parseImageError = (response) => parseUpstreamError(response, provider === "codex" && response.status === 429 ? executor : null, { provider });
  let upstreamError = providerResponse.ok ? null : await parseImageError(providerResponse);
  const fallbackBody = upstreamError && adapter.buildFallbackBody?.(
    requestBody, upstreamError.statusCode, upstreamError.message
  );
  if (fallbackBody) {
    try {
      requestBody = fallbackBody;
      headers = adapter.buildHeaders(credentials, requestBody, model, body);
      providerResponse = await fetch(url, {
        method: "POST",
        headers,
        body: serializeRequestBody(requestBody),
        signal,
        proxyOptions
      });
      upstreamError = providerResponse.ok ? null : await parseImageError(providerResponse);
    } catch (error) {
      if (isAbort(error)) return abortedResult();
      const message = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, message);
    }
  }
  if (upstreamError) {
    const { statusCode, message } = upstreamError;
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    log?.debug?.("IMAGE", `Provider error: ${errMsg}`);
    const evidence = upstreamError.rateLimitEvidence;
    const provenReset = provider === "codex" && evidence?.state === "exhausted" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(statusCode, errMsg, provenReset?.resetAtMs, undefined, provenReset);
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
        signal,
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
    if (isAbort(parseError)) return adapter.async ? withAcceptedJob(abortedResult()) : abortedResult();
    // An adapter may tag a parse/validation error with an explicit HTTP status
    // (e.g. 422 for a per-request content rejection) to distinguish it from a
    // generic upstream failure. Only honor a sane client/server error status;
    // anything else stays a 502.
    const tagged = Number(parseError?.status);
    const status = Number.isInteger(tagged) && tagged >= 400 && tagged <= 599 ?
    tagged :
    HTTP_STATUS.BAD_GATEWAY;
    const failed = createErrorResult(status, parseError.message || `Invalid response from ${provider}`);
    return parseError?.jobOutcomeUnknown ? withAcceptedJob(failed) : failed;
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
      const image = await fetchImageAsBase64(first.url, imageFetchOptions());
      b64 = image?.url?.split(",", 2)[1];
    }
    if (b64) {
      return {
        success: true,
        accounting,
        response: binaryImageResponse(b64, body.output_format)
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
