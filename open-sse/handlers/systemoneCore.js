import crypto from "node:crypto";
import { resolveLayaHost } from "../config/laya.js";
import { createErrorResult, parseUpstreamError, readBoundedResponseText, sanitizeErrorMessageWithSecrets } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { PROVIDER_MEDIA } from "../providers/index.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { assertOutboundUrlAllowed, guardedProbeFetch } from "../utils/outboundUrlGuard.js";
import { SYSTEMONE_COMPATIBLE_PREFIX, systemoneEndpoint } from "../config/systemone.js";
import { isObject } from "../../src/shared/utils/typeChecks.js";

function isRecord(value) {
  return value !== null && isObject(value) && !Array.isArray(value);
}

// ses_<12 hex><14 base62>, matching the header opencode.ai's native client sends
// (open-sse/executors/opencode.js keeps its own copy of this same shape).
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function generateOpencodeSessionId() {
  const bytes = crypto.randomBytes(20);
  const timeHex = bytes.subarray(0, 6).toString("hex");
  let randomPart = "";
  for (let i = 6; i < 20; i++) randomPart += BASE62_CHARS[bytes[i] % 62];
  return `ses_${timeHex}${randomPart}`;
}

/**
 * Core System One (Jev) handler — native decision payload pass-through.
 * URL/headers come from the registry's `systemoneConfig` (PROVIDER_MEDIA), the
 * same config-driven shape as imageEditCore/rerankCore. Body and JSON response
 * are forwarded untouched: decision models have no chat translation layer.
 *
 * @param {object} options
 * @param {object} options.body - { model, state, questions, ... }
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} [options.credentials]
 * @param {object} [options.log]
 * @param {function} [options.onRequestSuccess]
 * @returns {Promise<{ success: boolean, response: Response, usage?: object, status?: number, error?: string }>}
 */
export async function handleSystemoneCore({
  body,
  modelInfo,
  credentials = null,
  log = null,
  onRequestSuccess = null,
  signal = null,
  proxyOptions = null
}) {
  const { provider, model } = modelInfo;
  const isCustom = provider.startsWith(SYSTEMONE_COMPATIBLE_PREFIX);
  const cfg = PROVIDER_MEDIA[provider]?.systemoneConfig;
  if (!isCustom && (!isRecord(cfg) || !cfg.baseUrl)) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support System One.`);
  }

  // Custom System One nodes receive their validated endpoint only from selected
  // connection metadata. Request body never selects an upstream host.
  let baseUrl;
  let send = (url, init) => proxyAwareFetch(url, init, proxyOptions);
  if (isCustom) {
    try {
      baseUrl = systemoneEndpoint(credentials?.providerSpecificData?.baseUrl);
      assertOutboundUrlAllowed(baseUrl);
      send = (url, init) => guardedProbeFetch(url, init, undefined, (guardedUrl, guardedInit) => proxyAwareFetch(guardedUrl, guardedInit, proxyOptions));
    } catch (err) {
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, err?.message || `Invalid ${provider} server URL`);
    }
  } else {
    baseUrl = cfg.baseUrl;
  }
  if (cfg?.userConfigurableHost) {
    try {
      // Laya is the one provider with a user-set host; resolveLayaHost refuses
      // (null) anything that is not an http(s) origin.
      const origin = resolveLayaHost(credentials);
      if (!origin) throw new Error(`Invalid ${provider} server URL`);
      baseUrl = `${origin}${new URL(cfg.baseUrl).pathname}`;
      assertOutboundUrlAllowed(baseUrl);
    } catch (err) {
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, err?.message || `Invalid ${provider} server URL`);
    }
    send = (url, init) => guardedProbeFetch(url, init, undefined, (guardedUrl, guardedInit) => proxyAwareFetch(guardedUrl, guardedInit, proxyOptions));
  }

  const key = credentials?.apiKey || credentials?.accessToken;
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (isRecord(cfg?.headers)) Object.assign(headers, cfg.headers);
  // This header is OpenCode-native protocol metadata, never generic System One.
  if (provider === "opencode" || provider === "opencode-zen") headers["x-opencode-session"] = generateOpencodeSessionId();
  const requestBody = { ...body, model };

  log?.debug?.("SYSTEMONE", `${provider} | ${model} | ${baseUrl}`);

  let res;
  try {
    res = await send(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: signal || undefined
    });
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError") {
      return createErrorResult(499, "System One request aborted");
    }
    if (err?.code === "OUTBOUND_URL_GUARD_BLOCKED" && err?.message === "Guarded provider probe cannot use an outbound proxy") {
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Outbound proxies are not supported for guarded System One server URLs");
    }
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, sanitizeErrorMessageWithSecrets(err?.message || "System One request failed", [credentials?.apiKey, credentials?.accessToken]));
  }

  if (!res.ok) {
    let errInfo;
    try {
      errInfo = await parseUpstreamError(res, null, { signal, credentials, proxyOptions });
    } catch (err) {
      if (signal?.aborted || err?.name === "AbortError") {
        return createErrorResult(499, "System One request aborted");
      }
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Unable to read System One provider error");
    }
    return createErrorResult(
      errInfo.statusCode || res.status,
      sanitizeErrorMessageWithSecrets(errInfo.message || `Upstream error from ${provider}`, [credentials?.apiKey, credentials?.accessToken]),
      errInfo.resetsAtMs,
      errInfo.errorBody,
      errInfo.rateLimitEvidence,
      credentials,
    );
  }

  let responseBody;
  try {
    responseBody = JSON.parse(await readBoundedResponseText(res, { signal, maxBytes: 8 * 1024 * 1024, timeoutMs: 10000, throwOnTimeout: true }));
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError") {
      return createErrorResult(499, "System One request aborted");
    }
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, sanitizeErrorMessageWithSecrets(`Invalid JSON response from ${provider}: ${err?.message || "invalid response"}`, [credentials?.apiKey, credentials?.accessToken]));
  }

  if (onRequestSuccess) await onRequestSuccess();

  const usage = responseBody?.usage;
  return {
    success: true,
    status: res.status,
    usage: usage
      ? { prompt_tokens: usage.input_tokens || 0, completion_tokens: usage.output_tokens || 0 }
      : null,
    response: new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    })
  };
}
