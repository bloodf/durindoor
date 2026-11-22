import { createErrorResult, parseUpstreamError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { getExecutor } from "../executors/index.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../services/oauthCredentialManager.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
import { mediaAccounting } from "./mediaAccounting.js";

function isRecord(value) {
  return value !== null && isObject(value) && !Array.isArray(value);
}

// Derive a provider's /moderations endpoint from its chat completions baseUrl.
// https://api.openai.com/v1/chat/completions → https://api.openai.com/v1/moderations
// Tolerates an /openai segment (e.g. deepinfra's /v1/openai/chat/completions).
export function deriveModerationsUrl(baseUrl) {
  if (/\/chat\/completions$/.test(baseUrl)) return baseUrl.replace(/\/chat\/completions$/, "/moderations");
  // Fallback: drop the last path segment, append /moderations.
  const u = new URL(baseUrl);
  const parts = u.pathname.split("/").filter(Boolean);
  parts.pop();
  return `${u.origin}${parts.length ? "/" + parts.join("/") : ""}/moderations`;
}

/**
 * Core moderations handler — generic OpenAI-compatible passthrough.
 * Resolves the provider's /moderations URL, applies provider auth via the
 * executor's buildHeaders, routes through the credential's proxy options with
 * the caller's abort signal, and forwards { input, model } verbatim.
 * Raw receipt accounting is returned separately from the unchanged response body.
 *
 * @param {object} options
 * @param {object} options.body - Request body { input, model, ... }
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} [options.credentials]
 * @param {object} [options.log]
 * @param {function} [options.onRequestSuccess]
 * @param {AbortSignal} [options.signal] - Client abort signal forwarded to upstream fetch
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleModerationsCore({
  body,
  modelInfo,
  credentials = null,
  log = null,
  onRequestSuccess = null,
  signal = null
}) {
  const { provider, model } = modelInfo;
  const cfg = PROVIDERS[provider];
  const baseUrl = isRecord(cfg) && isString(cfg.baseUrl) ? cfg.baseUrl : undefined;
  if (!baseUrl) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' has no base URL for moderation`);
  }

  if (signal?.aborted) {
    return createErrorResult(499, "Moderation request aborted");
  }

  const executor = getExecutor(provider);
  const headers = executor.buildHeaders(credentials || {}, false, null, model);
  const url = deriveModerationsUrl(baseUrl);

  log?.debug?.("MODERATION", `${provider} | ${model} | ${url}`);

  let res;
  try {
    res = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, model }),
      signal
    }, resolveCredentialProxyOptions(credentials));
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError") {
      return createErrorResult(499, "Moderation request aborted");
    }
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, err?.message || "Moderation request failed");
  }

  if (!res.ok) {
    const errInfo = await parseUpstreamError(res, executor);
    return createErrorResult(errInfo.statusCode || res.status, errInfo.message || `Upstream error from ${provider}`);
  }

  if (onRequestSuccess) await onRequestSuccess();

  const text = await res.text();
  let raw;
  try { raw = JSON.parse(text); } catch { /* Preserve opaque successful responses. */ }
  const accounting = mediaAccounting(raw, provider, "moderation");
  return {
    success: true,
    status: res.status,
    accounting,
    response: new Response(text, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") || "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    })
  };
}