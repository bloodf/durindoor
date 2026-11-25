// Freebuff session executor.
//
// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// MIT, open-sse/executors/freebuff.ts and the validator in
// src/lib/providers/validation.ts. Per request it runs the sequence the
// Freebuff CLI uses: acquire a Freebuff session, start an agent run, post the
// chat completion, then finish the run in the background. This is a
// reverse-engineered client, not a documented third-party API.
//
// Safety posture:
//  - Dispatch is off unless the connection sets
//    `providerSpecificData.enableSessionDispatch === true`.
//  - No state is kept between requests: the token, session id and run id live
//    in one execute() call, so two connections never share anything.
//  - The credential is a Freebuff device-session token. It is never sent to,
//    read from or compared with a paid Codebuff (`cb_...`) connection.
import { randomInt } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { credentialFetch } from "../utils/credentialFetch.js";
import { createExecutorSender, requestAbortError } from "./sendRequest.js";
import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { buildErrorBody } from "../utils/error.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
import {
  FREEBUFF_AGENT_BY_MODEL,
  FREEBUFF_API_BASE,
  FREEBUFF_OPT_IN_KEY,
} from "../config/freebuff.js";

export const FREEBUFF_SESSION_URL = `${FREEBUFF_API_BASE}/freebuff/session`;
export const FREEBUFF_RUNS_URL = `${FREEBUFF_API_BASE}/agent-runs`;
export const FREEBUFF_CHAT_URL = `${FREEBUFF_API_BASE}/chat/completions`;
export const FREEBUFF_DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const SESSION_USER_AGENT = "codebuff/0.1.0 (darwin-arm64)";
const CHAT_USER_AGENT = "ai-sdk/openai-compatible/1.0.25/codebuff";
const BUFFY_PROMPT = "You are Buffy, the strategic coding assistant.";
const ERROR_TEXT_LIMIT = 300;

export function isFreebuffDispatchEnabled(credentials) {
  return credentials?.providerSpecificData?.[FREEBUFF_OPT_IN_KEY] === true;
}

export function freebuffToken(credentials) {
  const token = credentials?.apiKey || credentials?.accessToken || "";
  return isString(token) ? token.replace(/^Bearer\s+/i, "").trim() : "";
}

function clientSessionId() {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 13; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

function snippet(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, ERROR_TEXT_LIMIT);
}

/**
 * Credential / quota error mapping shared by session, run and chat failures.
 * 401/403 -> 401 authentication_error (re-login required), 429 -> 429
 * rate_limit_error, anything else keeps its status.
 */
export function mapFreebuffError(status, detail, stage = "request") {
  const text = snippet(detail);
  if (status === 401 || status === 403) {
    return {
      status: 401,
      type: "authentication_error",
      code: "freebuff_auth_invalid",
      message: `Freebuff rejected the auth token at ${stage}; sign in to Freebuff again.${text ? ` (${text})` : ""}`,
    };
  }
  if (status === 429) {
    return {
      status: 429,
      type: "rate_limit_error",
      code: "freebuff_rate_limited",
      message: `Freebuff session, ad or usage limit reached at ${stage}.${text ? ` (${text})` : ""}`,
    };
  }
  return {
    status,
    type: "upstream_error",
    code: `freebuff_http_${status}`,
    message: `Freebuff ${stage} failed (${status})${text ? `: ${text}` : ""}`,
  };
}

function errorResult(info, extra = {}, retryAfter = null) {
  const headers = { "content-type": "application/json" };
  if (retryAfter) headers["retry-after"] = retryAfter;
  const body = buildErrorBody(info.status, info.message, { type: info.type, code: info.code });
  return {
    response: new Response(JSON.stringify(body), { status: info.status, headers }),
    url: FREEBUFF_CHAT_URL,
    headers: {},
    transformedBody: extra.transformedBody,
  };
}

/** Port of OmniRoute validateFreebuffProvider: a session probe, 409 means one already exists. */
export async function validateFreebuffToken({ apiKey }, { fetch: fetcher = proxyAwareFetch, proxyOptions = null } = {}) {
  const token = freebuffToken({ apiKey });
  if (!token) return { valid: false, error: "Freebuff Auth Token required", unsupported: false };
  try {
    const res = await credentialFetch((url, init) => fetcher(url, init, proxyOptions), FREEBUFF_SESSION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": SESSION_USER_AGENT,
        "x-freebuff-model": FREEBUFF_DEFAULT_MODEL,
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok || res.status === 409) return { valid: true, error: null };
    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: "Invalid or expired Freebuff Auth Token", unsupported: false };
    }
    const text = await res.text().catch(() => "");
    return { valid: false, error: `Freebuff validation returned ${res.status}: ${snippet(text).slice(0, 100)}`, unsupported: false, ...(res.status >= 500 ? { unavailable: true } : null) };
  } catch (error) {
    return { valid: false, error: `Freebuff validation network error: ${error?.message || error}`, unsupported: false, unavailable: true };
  }
}

async function readJson(res) {
  try {
    const parsed = JSON.parse(await res.text());
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export class FreebuffExecutor extends BaseExecutor {
  constructor(deps = {}) {
    super("freebuff", { id: "freebuff", baseUrl: FREEBUFF_API_BASE, format: "openai" });
    this.fetchImpl = deps.fetch || null;
  }

  // The Freebuff auth token has no refresh grant (re-login replaces it), so
  // there is nothing to refresh: returning null makes the caller surface the
  // 401 instead of retrying a dead token.
  async refreshCredentials() {
    return null;
  }

  needsRefresh() {
    return false;
  }

  #call(sender, url, init, proxyOptions, options) {
    const send = (target, request) => sender.sendRequest(target, request, proxyOptions, this.fetchImpl ?
      { ...options, transport: (merged) => this.fetchImpl(target, merged, proxyOptions) } : options);
    // An injected transport owns its redirects; the real one follows only same-origin ones.
    return this.fetchImpl ? send(url, init) : credentialFetch(send, url, init);
  }

  async execute(input) {
    const { model, body, stream, credentials, signal, proxyOptions = null } = input;
    if (signal?.aborted) throw requestAbortError(signal.reason);
    const sender = createExecutorSender(this, input, { observePatchedFetch: false });
    // Session and run bookkeeping are not billable; only the chat completion is.
    const setup = { quotaBearing: false };
    const payload = isObject(body) ? body : {};

    if (!isFreebuffDispatchEnabled(credentials)) {
      return errorResult({
        status: 403,
        type: "permission_error",
        code: "freebuff_dispatch_disabled",
        message: `Freebuff session dispatch is disabled for this connection. Set providerSpecificData.${FREEBUFF_OPT_IN_KEY} to true to opt in.`,
      }, { transformedBody: payload });
    }
    const token = freebuffToken(credentials);
    if (!token) {
      return errorResult({
        status: 401,
        type: "authentication_error",
        code: "freebuff_auth_missing",
        message: "Freebuff Auth Token required",
      }, { transformedBody: payload });
    }

    const requested = (isString(model) && model ? model : payload.model || FREEBUFF_DEFAULT_MODEL).replace(/^(freebuff|fb)\//, "");
    const agentId = FREEBUFF_AGENT_BY_MODEL[requested] || "base2-free";
    const authHeaders = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": SESSION_USER_AGENT,
    };

    // 1. Session acquisition.
    let instanceId = "";
    try {
      const res = await this.#call(sender, FREEBUFF_SESSION_URL, {
        method: "POST",
        headers: { ...authHeaders, "x-freebuff-model": requested },
        body: JSON.stringify({}),
        signal,
      }, proxyOptions, setup);
      const data = res.ok || res.status === 409 ? await readJson(res) : {};
      if (res.ok || (res.status === 409 && isString(data.instanceId) && data.instanceId)) {
        instanceId = isString(data.instanceId) ? data.instanceId : "";
      } else {
        const text = res.ok ? "" : await res.text().catch(() => "");
        return errorResult(mapFreebuffError(res.status, text, "session"), { transformedBody: payload }, res.headers.get("retry-after"));
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      return errorResult({
        status: 502,
        type: "upstream_error",
        code: "freebuff_network_error",
        message: `Freebuff session network error: ${snippet(error?.message || error)}`,
      }, { transformedBody: payload });
    }

    // 2. Start the agent run (best effort, as upstream: a failed start only drops the run id).
    let runId = "";
    try {
      const res = await this.#call(sender, FREEBUFF_RUNS_URL, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ action: "START", agentId }),
        signal,
      }, proxyOptions, setup);
      if (res.ok) {
        const data = await readJson(res);
        runId = isString(data.runId) ? data.runId : "";
      }
    } catch (error) {
      if (signal?.aborted) throw error;
    }

    // 3. Chat payload with the Buffy system prompt and Freebuff run metadata.
    const messages = Array.isArray(payload.messages) ? payload.messages.filter(isObject) : [];
    const first = messages[0];
    const hasBuffy = first?.role === "system" && isString(first.content) && first.content.trim().startsWith("You are Buffy");
    if (!hasBuffy) messages.unshift({ role: "system", content: BUFFY_PROMPT });
    const metadata = { run_id: runId, cost_mode: "free", client_id: clientSessionId(), freebuff_instance_id: instanceId };
    if (isObject(payload.codebuff_metadata)) Object.assign(metadata, payload.codebuff_metadata);
    const upstreamBody = { ...payload, model: requested, messages, stream: stream !== false, codebuff_metadata: metadata };
    const chatHeaders = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": CHAT_USER_AGENT,
      Accept: "application/json, text/event-stream",
      "x-freebuff-instance-id": instanceId,
      "x-codebuff-agent-id": agentId,
    };
    if (runId) chatHeaders["x-codebuff-run-id"] = runId;

    // 4. Chat completion.
    let response;
    try {
      response = await this.#call(sender, FREEBUFF_CHAT_URL, {
        method: "POST",
        headers: chatHeaders,
        body: JSON.stringify(upstreamBody),
        signal,
      }, proxyOptions);
    } catch (error) {
      if (signal?.aborted) throw error;
      this.#finishRun(authHeaders, runId, proxyOptions, "failed");
      if (isQuotaDispatchUnavailable(error)) throw error;
      return {
        ...errorResult({
          status: 502,
          type: "upstream_error",
          code: "freebuff_network_error",
          message: `Freebuff chat network error: ${snippet(error?.message || error)}`,
        }, { transformedBody: upstreamBody }),
        attemptStartedAt: sender.attemptStartedAt,
      };
    }

    // 5. Finish the run in the background.
    this.#finishRun(authHeaders, runId, proxyOptions, response.ok ? "completed" : "failed");

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const failed = errorResult(mapFreebuffError(response.status, text, "chat"), { transformedBody: upstreamBody }, response.headers.get("retry-after"));
      transferProviderAttemptDispatch(response, failed.response);
      return { ...failed, attemptStartedAt: sender.attemptStartedAt };
    }
    return { response, url: FREEBUFF_CHAT_URL, headers: chatHeaders, transformedBody: upstreamBody, attemptStartedAt: sender.attemptStartedAt };
  }

  #finishRun(headers, runId, proxyOptions, status) {
    if (!runId) return;
    // The run outlives the request, so it gets its own sender and no caller signal.
    const sender = createExecutorSender(this, {}, { observePatchedFetch: false });
    void Promise.resolve()
      .then(() => this.#call(sender, FREEBUFF_RUNS_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "FINISH", runId, status, totalSteps: 1, directCredits: 0, totalCredits: 0 }),
      }, proxyOptions, { quotaBearing: false }))
      .catch(() => {});
  }
}
