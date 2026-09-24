import crypto from "node:crypto";
import { resolveLayaHost } from "../config/laya.js";
import { createErrorResult, parseUpstreamError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { PROVIDER_MEDIA } from "../providers/index.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { assertOutboundUrlAllowed, guardedProbeFetch } from "../utils/outboundUrlGuard.js";
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
  onRequestSuccess = null
}) {
  const { provider, model } = modelInfo;
  const cfg = PROVIDER_MEDIA[provider]?.systemoneConfig;
  if (!isRecord(cfg) || !cfg.baseUrl) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support System One.`);
  }

  // noAuth free lanes carry an accessToken stub; paid lanes carry apiKey.
  // A self-hosted engine (Laya) keeps its origin on the connection; only the
  // origin is taken, the path stays the registry's, and the host goes through
  // the outbound guard (including the resolved-address check).
  let baseUrl = cfg.baseUrl;
  let send = proxyAwareFetch;
  if (cfg.userConfigurableHost) {
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
    send = (url, init) => guardedProbeFetch(url, init);
  }

  const key = credentials?.apiKey || credentials?.accessToken;
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (isRecord(cfg.headers)) Object.assign(headers, cfg.headers);
  // Zen lanes expect the official client session header on every request.
  headers["x-opencode-session"] = generateOpencodeSessionId();
  const requestBody = { ...body, model };

  log?.debug?.("SYSTEMONE", `${provider} | ${model} | ${baseUrl}`);

  let res;
  try {
    res = await send(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody)
    });
  } catch (err) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, err?.message || "System One request failed");
  }

  if (!res.ok) {
    const errInfo = await parseUpstreamError(res, null);
    return createErrorResult(errInfo.statusCode || res.status, errInfo.message || `Upstream error from ${provider}`);
  }

  let responseBody;
  try {
    responseBody = await res.json();
  } catch {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
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
