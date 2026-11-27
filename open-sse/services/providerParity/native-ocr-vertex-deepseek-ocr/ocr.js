// One vertex-deepseek-ocr request on the selected connection (#2034, staged).
// Source: OmniRoute c71f0065 open-sse/handlers/ocr.ts (handleOcr with the
// vertex-deepseek-ocr credential and base URL resolution of
// src/app/api/v1/ocr/route.ts). Order: refuse the retired model, resolve the
// connection scope, validate the request, mint the token, then send once
// through the foundation dispatcher. Nothing billable leaves the gateway
// before the request and the connection were both accepted locally, and a
// failure after the send is never replayed (the foundation marks it with
// acceptedJob).
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { createErrorResult } from "../../../utils/error.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isString } from "../../../../src/shared/utils/typeChecks.js";
import { createOcrDispatcher, OCR_TIMEOUT_MS, validateOcrRequest } from "../native-ocr-foundation/index.js";
import { createVertexDeepseekOcrAdapter, isRetiredVertexDeepseekOcrModel } from "./adapter.js";
import { resolveVertexOcrToken, vertexDeepseekOcrScope } from "./auth.js";
import {
  VERTEX_DEEPSEEK_OCR_PROVIDER_ID,
  VERTEX_DEEPSEEK_OCR_RETIRED_MODEL_ID,
  VERTEX_DEEPSEEK_OCR_TOKEN_TIMEOUT_MS,
} from "./config.js";

const PREFIX = `${VERTEX_DEEPSEEK_OCR_PROVIDER_ID}/`;

const local = (status, message) => ({ ...createErrorResult(status, message), local: true });
const secretsOf = (credentials) => ({ apiKey: credentials?.apiKey, accessToken: credentials?.accessToken });

/**
 * Run one OCR request on vertex-deepseek-ocr for the connection the caller
 * selected. No account fallback happens here.
 *
 * @param {object} args
 * @param {object} args.body client body `{ model, document }`
 * @param {object} args.credentials the selected connection: `{ apiKey?, accessToken?, providerSpecificData? }`
 * @param {AbortSignal} [args.signal]
 * @param {Function} [args.fetchImpl] transport for the OCR call (tests inject a closed mock)
 * @param {Function} [args.sleepImpl]
 * @param {Function} [args.mintToken] Service Account / ADC token minter (tests inject a fake)
 * @param {number} [args.timeoutMs] one budget for minting and the OCR call
 * @param {number} [args.tokenTimeoutMs]
 * @param {number} [args.maxResponseBytes]
 * @param {object} [args.log]
 * @returns {Promise<object>} the foundation's success or failure result
 */
export async function runVertexDeepseekOcr({
  body,
  credentials,
  signal,
  fetchImpl,
  sleepImpl,
  mintToken,
  timeoutMs = OCR_TIMEOUT_MS,
  tokenTimeoutMs = VERTEX_DEEPSEEK_OCR_TOKEN_TIMEOUT_MS,
  maxResponseBytes,
  log,
} = {}) {
  const started = Date.now();
  const requested = body?.model;
  if (isString(requested) && isRetiredVertexDeepseekOcrModel(requested.startsWith(PREFIX) ? requested.slice(PREFIX.length) : requested)) {
    return local(HTTP_STATUS.BAD_REQUEST,
      `Model "${VERTEX_DEEPSEEK_OCR_RETIRED_MODEL_ID}" was retired by Google on 2026-10-21. Self-deploy DeepSeek-OCR on Vertex Model Garden and pass its model id.`);
  }

  let scope;
  try {
    scope = vertexDeepseekOcrScope(credentials);
  } catch (error) {
    if (!error?.vertexOcrAuth) throw error;
    return { ...createErrorResult(error.status, error.message, undefined, undefined, null, secretsOf(credentials)), local: true };
  }

  // Validate before any token is minted: a refused request costs nothing.
  try {
    validateOcrRequest(createVertexDeepseekOcrAdapter({ ...scope, token: null }), body);
  } catch (error) {
    if (error?.ocrInput) return local(HTTP_STATUS.BAD_REQUEST, error.message);
    throw error;
  }

  const proxyOptions = resolveCredentialProxyOptions(credentials);
  let token;
  try {
    token = await resolveVertexOcrToken(scope, {
      mintToken, log, proxyOptions, signal, timeoutMs: Math.min(tokenTimeoutMs, timeoutMs),
    });
  } catch (error) {
    if (error?.name === "AbortError") return local(499, "Vertex DeepSeek-OCR request aborted; nothing was sent");
    if (!error?.vertexOcrAuth) throw error;
    return { ...createErrorResult(error.status, error.message, undefined, undefined, null, secretsOf(credentials)), local: true };
  }

  const adapter = createVertexDeepseekOcrAdapter({ ...scope, token });
  const dispatcherOptions = { adapters: [adapter], timeoutMs: Math.max(1, timeoutMs - (Date.now() - started)) };
  if (fetchImpl) dispatcherOptions.fetchImpl = fetchImpl;
  if (sleepImpl) dispatcherOptions.sleepImpl = sleepImpl;
  if (maxResponseBytes) dispatcherOptions.maxResponseBytes = maxResponseBytes;
  const dispatcher = createOcrDispatcher(dispatcherOptions);
  // The minted token is passed as accessToken so error sanitizing redacts it.
  return dispatcher.dispatch({
    provider: VERTEX_DEEPSEEK_OCR_PROVIDER_ID,
    body,
    credentials: { ...credentials, accessToken: token },
    signal,
  });
}
