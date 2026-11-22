// MiniMax Code account executor (staged: not listed in executors/index.js).
//
// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/executors/minimax-code.ts and minimaxCodeGateway.ts (MIT). The managed gateway
// speaks the Anthropic Messages contract, so DefaultExecutor sends the (translated) request
// with a `claude` transport; this class owns the guard, the credential lifecycle and the
// error mapping.
//
// Safety posture:
//  - Dispatch is off unless the connection sets providerSpecificData.enableSessionDispatch === true.
//  - Only the connection's own access token is sent, as a bearer token to a MiniMax host.
//    A stored `apiKey` is ignored so a MiniMax API key can never reach the account gateway.
//  - The gateway URL is fixed. A connection may override it only with an https URL on a
//    MiniMax domain, and the CN region has no known gateway, so it must supply one.
//  - Refresh uses only that connection's refresh token and persists the rotated one back to
//    the same connection, so two connections never share or overwrite each other's tokens.
//  - Budgets (open-sse/services/minimaxCodeBudget.js, MINIMAX_CODE_* settings): an input ceiling
//    and a default max_tokens/context window are applied before sending, the whole call has one
//    time budget, and a 429, 5xx or dropped connection is retried with a backoff (once by
//    default). Any other 4xx is never retried.
import { DefaultExecutor } from "./default.js";
import { buildErrorBody } from "../utils/error.js";
import { MINIMAX_CODE_GATEWAY_URL, MINIMAX_CODE_MODELS } from "../providers/registry/minimax-code.js";
import { normalizeMinimaxCodeRegion, refreshMinimaxCodeToken } from "../services/minimaxCodeAuth.js";
import {
  MINIMAX_CODE_DEFAULT_RETRY_BASE_MS,
  applyMinimaxCodeBudgets,
  isRetryableMinimaxCodeStatus,
  minimaxCodeBackoffMs,
  resolveMinimaxCodeRetries,
  resolveMinimaxCodeTimeoutMs,
} from "../services/minimaxCodeBudget.js";
import { isObject, isRecord, isString } from "../../src/shared/utils/typeChecks.js";

export const MINIMAX_CODE_OPT_IN_KEY = "enableSessionDispatch";
const MODEL_IDS = new Set(MINIMAX_CODE_MODELS.map((model) => model.id));
const NAMESPACES = ["minimax-code/", "mmcode/"];
const MINIMAX_GATEWAY_HOST = /(^|\.)minimax\.(io|cn)$/i;
const CONTEXT_WINDOW_ERROR =
  /context window exceeds limit|prompt is too long|maximum context length|input is too long|context[_ ]length[_ ]exceeded|model_context_window_exceeded|too many tokens|token limit exceeded|exceeds the maximum allowed input length|exceeded model token limit/i;

export function isMinimaxCodeDispatchEnabled(credentials) {
  return credentials?.providerSpecificData?.[MINIMAX_CODE_OPT_IN_KEY] === true;
}

/** `{ ok, model }` or `{ ok: false, error }`; accepts the provider id and alias namespaces. */
export function resolveMinimaxCodeModel(model) {
  const requested = isString(model) ? model.trim() : "";
  const fallback = MINIMAX_CODE_MODELS[0].id;
  if (!requested) return { ok: true, model: fallback };
  if (requested.startsWith("-")) return { ok: false, error: `Invalid MiniMax Code model "${requested}": model must not start with "-".` };
  const namespace = NAMESPACES.find((prefix) => requested.startsWith(prefix));
  const name = namespace ? requested.slice(namespace.length) : requested;
  if (!MODEL_IDS.has(name)) {
    return { ok: false, error: `Unknown MiniMax Code model "${requested}". Supported models: ${[...MODEL_IDS].join(", ")}.` };
  }
  return { ok: true, model: name };
}

/** The gateway URL for a connection, or `{ error }` when none can be trusted. */
export function resolveMinimaxCodeGatewayUrl(credentials) {
  const data = credentials?.providerSpecificData;
  const custom = isString(data?.gatewayUrl) ? data.gatewayUrl.trim() : "";
  if (custom) {
    try {
      const url = new URL(custom);
      if (url.protocol === "https:" && !url.username && !url.password && MINIMAX_GATEWAY_HOST.test(url.hostname)) return { url: url.toString() };
    } catch { /* fall through */ }
    return { error: "providerSpecificData.gatewayUrl must be an https URL on a minimax.io or minimax.cn host." };
  }
  if (normalizeMinimaxCodeRegion(data?.region) === "cn") {
    return { error: "No MiniMax Code gateway is known for the cn region. Set providerSpecificData.gatewayUrl to an https minimax.cn URL." };
  }
  return { url: MINIMAX_CODE_GATEWAY_URL };
}

const failure = (status, code, message, extraHeaders = {}) => ({
  response: new Response(JSON.stringify(buildErrorBody(status, message, { type: status === 401 ? "authentication_error" : status === 429 ? "rate_limit_error" : "provider_error", code })), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  }),
  url: MINIMAX_CODE_GATEWAY_URL,
  headers: {},
  transformedBody: null,
});

/** Anthropic error shape in a 200 body (or a bare `error`) -> a status that says what failed. */
function bodyErrorStatus(type, message) {
  if (CONTEXT_WINDOW_ERROR.test(message)) return 413;
  if (/invalid_request|not_found_error|request_too_large|permission_error/i.test(type)) return 400;
  if (/authentication/i.test(type)) return 401;
  if (/rate_limit|quota|overloaded/i.test(type)) return 429;
  return 500;
}

function bodyError(doc) {
  if (!isObject(doc)) return null;
  const raw = doc.error;
  if (raw === undefined || raw === null) {
    return doc.type === "error" ? { type: "error", message: isString(doc.message) ? doc.message : "the gateway answered with an error" } : null;
  }
  if (isString(raw)) return { type: "error", message: raw };
  return {
    type: isString(raw.type) ? raw.type : isString(doc.type) ? doc.type : "error",
    message: isString(raw.message) ? raw.message : isString(doc.message) ? doc.message : "the gateway answered with an error",
  };
}

async function readText(response) {
  try { return (await response.text()).slice(0, 600); } catch { return ""; }
}

function messageOf(text, fallback) {
  try {
    const parsed = JSON.parse(text);
    const error = bodyError(parsed);
    if (error?.message) return error.message;
    if (isString(parsed?.message)) return parsed.message;
  } catch { /* plain text body */ }
  return text || fallback;
}

export class MinimaxCodeExecutor extends DefaultExecutor {
  // The gateway has no documented count_tokens endpoint, and the pre-flight count would send the
  // prompt and the stored token upstream before the opt-in guard in execute() runs.
  supportsNativeTokenCount = false;

  constructor(options = {}) {
    super("minimax-code");
    this.options = options;
  }

  // Backoff before a retry: exponential from the base delay, ignoring Retry-After so the
  // wait stays inside the call budget. Called by the base retry loop for 429/5xx answers.
  computeRetryDelay(response, attempt, delayMs) {
    return minimaxCodeBackoffMs(attempt, delayMs);
  }

  // The retry count is a deployment setting read on every call (MINIMAX_CODE_GATEWAY_RETRIES).
  // It covers a 429, any 5xx and a dropped connection (the base loop keys those as 502).
  #retryConfig() {
    const attempts = resolveMinimaxCodeRetries();
    const delayMs = this.options.retryBaseMs ?? MINIMAX_CODE_DEFAULT_RETRY_BASE_MS;
    const retry = {};
    for (let status = 400; status <= 599; status += 1) retry[status] = { attempts: isRetryableMinimaxCodeStatus(status) ? attempts : 0, delayMs };
    return retry;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return resolveMinimaxCodeGatewayUrl(credentials).url || MINIMAX_CODE_GATEWAY_URL;
  }

  buildHeaders(credentials = {}, stream = true, requestContext = null, model = "") {
    // The account gateway takes only the signed-in access token: a stored API key is ignored.
    const headers = super.buildHeaders({ ...credentials, apiKey: undefined }, stream, requestContext, model);
    delete headers["x-api-key"];
    delete headers["X-Api-Key"];
    return headers;
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    return refreshMinimaxCodeToken(credentials, log, proxyOptions, this.options.fetchImpl || null);
  }

  // Only a rejected token (401) is worth a refresh. A 403 from the opt-in guard, or an
  // entitlement refusal from the gateway, must not spend (and rotate) the refresh token.
  shouldRefreshAfterAuthFailure(parsedError) {
    return parsedError?.statusCode === 401;
  }

  async execute(input) {
    const { credentials } = input;
    if (!isMinimaxCodeDispatchEnabled(credentials)) {
      return failure(403, "minimax_code_dispatch_disabled",
        `MiniMax Code dispatch is disabled for this connection. Set providerSpecificData.${MINIMAX_CODE_OPT_IN_KEY} to true to opt in.`);
    }
    const resolution = resolveMinimaxCodeModel(input.model);
    if (!resolution.ok) return failure(400, "minimax_code_invalid_model", resolution.error);
    const gateway = resolveMinimaxCodeGatewayUrl(credentials);
    if (gateway.error) return failure(400, "minimax_code_gateway_unavailable", gateway.error);
    if (!isString(credentials?.accessToken) || !credentials.accessToken) {
      return failure(401, "minimax_code_not_signed_in", "MiniMax Code connection has no access token. Sign in again from the provider page.");
    }

    const body = isRecord(input.body) ? input.body : {};
    const budgeted = applyMinimaxCodeBudgets(body);
    if (budgeted.error) {
      input.log?.warn?.("MINIMAX_CODE", budgeted.error);
      // 413, not 400: the refusal belongs to the request and says nothing about the model.
      return failure(413, "context_length_exceeded", budgeted.error);
    }

    // One time budget for the whole call: the attempt, the backoff and the retry. It stops at
    // the response headers, so a stream that is already flowing is not cut by it.
    const timeoutMs = resolveMinimaxCodeTimeoutMs();
    const budget = new AbortController();
    const timer = setTimeout(() => budget.abort(new Error(`MiniMax Code gateway call timed out after ${timeoutMs} ms`)), timeoutMs);
    const signal = input.signal ? AbortSignal.any([input.signal, budget.signal]) : budget.signal;
    this.config = { ...this.config, retry: this.#retryConfig() };
    let result;
    try {
      result = await super.execute({ ...input, signal, model: resolution.model, body: budgeted.body });
    } catch (error) {
      // Our own timeout is not a verdict on the model, so it answers 500 (not 504, which
      // would take the model out of every fallback combo).
      if (budget.signal.aborted && !input.signal?.aborted) {
        return failure(500, "gateway_timeout", `MiniMax Code gateway call timed out after ${timeoutMs} ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    return this.#mapResult(result, input.stream === true || body.stream === true);
  }

  async #mapResult(result, streaming) {
    const { response } = result;
    if (!response.ok) {
      const text = await readText(response);
      const upstream = messageOf(text, `HTTP ${response.status}`);
      let status = response.status;
      let code = "gateway_error";
      let message = upstream;
      if (status === 401) {
        code = "invalid_credentials";
        message = "MiniMax Code rejected the connection's access token. Refresh failed or the sign-in was revoked; sign in again.";
      } else if (status === 429) {
        code = "quota_exceeded";
        message = `MiniMax Code quota or rate limit reached: ${upstream}`;
      } else if (status === 400 && CONTEXT_WINDOW_ERROR.test(upstream)) {
        // A request that does not fit the window says nothing about the model's health.
        status = 413;
        code = "context_length_exceeded";
      }
      const retryAfter = response.headers.get("retry-after");
      return { ...result, response: failure(status, code, message, retryAfter ? { "Retry-After": retryAfter } : {}).response };
    }
    if (streaming || !/json/i.test(response.headers.get("content-type") || "")) return result;
    // A 200 answer can carry the gateway's refusal in its body; surfacing it as a completion
    // would hand the client an empty answer and lose the refusal.
    const text = await readText(response.clone());
    let doc = null;
    try { doc = JSON.parse(text); } catch { return result; }
    const error = bodyError(doc);
    if (!error) return result;
    const status = bodyErrorStatus(error.type, error.message);
    return { ...result, response: failure(status, status === 429 ? "quota_exceeded" : "gateway_error", `MiniMax gateway error: ${error.message}`).response };
  }
}

export default MinimaxCodeExecutor;
