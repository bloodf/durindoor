// MCP Streamable HTTP session for one Z.AI web_search_prime call:
// initialize -> notifications/initialized -> tools/call, each on a fresh session.
// One bounded attempt per step, no refresh/retry/failover. Once tools/call is
// sent, a lost or unreadable answer may already have consumed plan quota and is
// reported as an accepted job; it is never replayed.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { createErrorResult, readBoundedResponseText, parseRateLimitEvidence } from "../../../utils/error.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import {
  ZAI_SEARCH_ID, ZAI_SEARCH_ORIGIN, ZAI_SEARCH_MCP_URL, MCP_SUPPORTED_PROTOCOL_VERSIONS,
  ZAI_SEARCH_TOTAL_TIMEOUT_MS, ZAI_SEARCH_MAX_TIMEOUT_MS, searchConfig,
} from "./config.js";
import { zaiSearchAdapter, drainSseEvents, findResponse } from "./adapter.js";

const KIND = "search";
const MAX_SUCCESS_BYTES = 2 * 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const SESSION_RE = /^[\x21-\x7e]{1,512}$/;
const QUOTA_CODES = /^(?:insufficient_quota|quota_exceeded|insufficient_balance|insufficient_credits|1113)$/;
const unsentCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const connectionOf = (credentials) => credentials?.id ?? credentials?.connectionId ?? null;
const discard = (response) => { try { void response?.body?.cancel?.().catch(() => {}); } catch { /* Already locked. */ } };

/** A step failure with a client-safe message; never carries upstream text. */
class StepError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function accepted(result, credentials, state) {
  const accounting = mediaAccounting(null, ZAI_SEARCH_ID, KIND);
  return { ...result, acceptedJob: { ...accounting, costSource: "accepted-job",
    meta: { ...accounting.meta, jobState: state, connectionId: connectionOf(credentials) } } };
}

/** Read a body incrementally; `onText` returns true to stop early (SSE). Bounded and abortable. */
async function readIncremental(response, { maxBytes, interrupted, onText }) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const whole = await Promise.race([readBoundedResponseText(response, { maxBytes, timeoutMs: ZAI_SEARCH_MAX_TIMEOUT_MS }), interrupted]);
    onText(whole, true);
    return;
  }
  const decoder = new TextDecoder();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (done) { onText(decoder.decode(), true); return; }
      total += value.byteLength;
      if (total > maxBytes) throw new StepError(502, "Z.AI search response too large", { unreadable: true });
      if (onText(decoder.decode(value, { stream: true }), false)) return;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Collect the JSON-RPC response for `id` from a JSON or SSE body. */
async function readRpcResponse(response, id, interrupted) {
  const type = (response.headers.get("content-type") || "").toLowerCase();
  if (type.includes("text/event-stream")) {
    let buffer = "";
    let found = null;
    await readIncremental(response, { maxBytes: MAX_SUCCESS_BYTES, interrupted, onText(chunk, done) {
      buffer += chunk;
      const { messages, rest, malformed } = drainSseEvents(done ? `${buffer}\n\n` : buffer);
      buffer = rest;
      if (malformed) throw new StepError(502, "Invalid Z.AI search response", { unreadable: true });
      found = findResponse(messages, id);
      return Boolean(found);
    } });
    return found;
  }
  if (!type.includes("application/json")) throw new StepError(502, "Invalid Z.AI search response", { unreadable: true });
  let text = "";
  await readIncremental(response, { maxBytes: MAX_SUCCESS_BYTES, interrupted, onText(chunk) { text += chunk; return false; } });
  try { return findResponse(JSON.parse(text), id); } catch { return null; }
}

async function httpFailure(response, phase, interrupted) {
  const status = response.status;
  let raw;
  try {
    raw = JSON.parse(await Promise.race([readBoundedResponseText(response, { maxBytes: MAX_ERROR_BYTES, timeoutMs: 2_000 }), interrupted]));
  } catch { /* Upstream bodies are never relayed. */ }
  const code = String(raw?.error?.code ?? raw?.error?.type ?? raw?.code ?? "");
  if (status === 402 || ([403, 429].includes(status) && QUOTA_CODES.test(code))) {
    return new StepError(402, "Z.AI connection quota exhausted", { quotaExhausted: true });
  }
  if (status === 401 || status === 403) return new StepError(status, "Z.AI search credential rejected");
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() });
    return new StepError(429, "Z.AI search rate limited", { evidence });
  }
  if (status === 404 && phase !== "initialize") return new StepError(502, "Z.AI MCP session rejected");
  if (status >= 500) return new StepError(502, "Z.AI search upstream error", { unknownOutcome: phase === "tool" });
  return new StepError(502, "Z.AI search request refused");
}

/**
 * Handle one POST /v1/search request on the selected connection. Returns the
 * local search-core result shape (`{ success, status, data, accounting, response }`)
 * or an error result, with `acceptedJob` when the tool call may have run.
 */
export async function handleZaiSearchNative({
  body, credentials, signal, timeoutMs = searchConfig.timeoutMs, totalTimeoutMs = ZAI_SEARCH_TOTAL_TIMEOUT_MS,
  fetchImpl = proxyAwareFetch, providerId = ZAI_SEARCH_ID,
} = {}) {
  if (signal?.aborted) return createErrorResult(499, "Z.AI search aborted");
  for (const value of [timeoutMs, totalTimeoutMs]) {
    if (!Number.isFinite(value) || value < 1 || value > ZAI_SEARCH_MAX_TIMEOUT_MS) return createErrorResult(400, "Invalid Z.AI search deadline");
  }
  let params;
  try { params = zaiSearchAdapter.validate(body); } catch (error) { return createErrorResult(400, error.message); }
  try { zaiSearchAdapter.buildHeaders(credentials); } catch { return createErrorResult(401, "Z.AI API key required"); }

  const startedAt = Date.now();
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const total = new AbortController();
  const totalTimer = setTimeout(() => total.abort(), totalTimeoutMs);
  const outer = signal ? AbortSignal.any([signal, total.signal]) : total.signal;
  const session = { sessionId: null, protocolVersion: null };
  let toolSent = false;
  let toolAnswered = false;
  let stepTimedOut = false;

  /** POST one JSON-RPC message; returns the matching response, or null for a notification. */
  async function post(message, phase) {
    if (outer.aborted) throw new StepError(signal?.aborted ? 499 : 504, "Z.AI search interrupted");
    const step = new AbortController();
    const remaining = totalTimeoutMs - (Date.now() - startedAt);
    const stepTimer = setTimeout(() => { stepTimedOut = true; step.abort(); }, Math.max(1, Math.min(timeoutMs, remaining)));
    const combined = AbortSignal.any([outer, step.signal]);
    let onAbort;
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(new StepError(0, "Z.AI search interrupted", { aborted: true }));
      combined.addEventListener("abort", onAbort, { once: true });
    });
    interrupted.catch(() => {});
    let response;
    try {
      const headers = zaiSearchAdapter.buildHeaders(credentials, session);
      if (phase === "tool") toolSent = true;
      const pending = Promise.resolve().then(() => {
        if (combined.aborted) { if (phase === "tool") toolSent = false; throw new StepError(0, "cancelled before send", { aborted: true }); }
        // Fixed constant URL: no caller- or connection-supplied endpoint is ever used.
        return fetchImpl(ZAI_SEARCH_MCP_URL, {
          method: "POST", headers, body: JSON.stringify(message), redirect: "manual", signal: combined,
        }, proxyOptions);
      });
      pending.then((late) => { if (combined.aborted) discard(late); }, () => {});
      try {
        response = await Promise.race([pending, interrupted]);
      } catch (error) {
        if (phase === "tool" && unsentCodes.has(error?.cause?.code ?? error?.code)) toolSent = false;
        throw error;
      }
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        discard(response);
        throw new StepError(502, "Z.AI search redirect refused", { unknownOutcome: false });
      }
      if (response.redirected || (response.url && URL.parse(response.url)?.origin !== ZAI_SEARCH_ORIGIN)) {
        discard(response);
        throw new StepError(502, "Z.AI search foreign response refused", { unknownOutcome: phase === "tool" });
      }
      if (!response.ok) throw await httpFailure(response, phase, interrupted);
      if (!("id" in message)) { discard(response); return null; }
      if (phase === "tool") toolAnswered = true;
      const rpc = await readRpcResponse(response, message.id, interrupted);
      if (!rpc) throw new StepError(502, "Invalid Z.AI search response", { unreadable: true });
      if (phase === "initialize") {
        const sessionId = response.headers.get("mcp-session-id");
        if (sessionId !== null && !SESSION_RE.test(sessionId)) throw new StepError(502, "Invalid Z.AI MCP session");
        session.sessionId = sessionId;
      }
      return rpc;
    } catch (error) {
      discard(response);
      throw error;
    } finally {
      clearTimeout(stepTimer);
      combined.removeEventListener("abort", onAbort);
    }
  }

  try {
    const init = await post(zaiSearchAdapter.buildInitialize(0), "initialize");
    const version = init.result?.protocolVersion;
    if (init.error || !isRecord(init.result) || !isString(version) || !MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
      throw new StepError(502, "Z.AI MCP initialize refused");
    }
    session.protocolVersion = version;
    await post(zaiSearchAdapter.buildInitialized(), "initialized");
    const rpc = await post(zaiSearchAdapter.buildToolCall(1, params), "tool");
    if (rpc.error) {
      const code = rpc.error?.code;
      // JSON-RPC protocol errors are definite refusals; server-defined codes are not.
      const definite = Number.isInteger(code) && code <= -32600 && code >= -32700;
      throw new StepError(502, "Z.AI search tool refused", { unknownOutcome: !definite, state: "tool-error" });
    }
    let normalized;
    try {
      normalized = zaiSearchAdapter.normalize(rpc.result, params, { providerId });
    } catch (error) {
      throw new StepError(502, error.toolError ? "Z.AI search tool error" : "Invalid Z.AI search response",
        { unknownOutcome: true, state: error.toolError ? "tool-error" : "completed-unusable" });
    }
    const duration = Date.now() - startedAt;
    const data = {
      provider: providerId,
      query: params.query,
      results: normalized.results,
      answer: null,
      // Source wire: one query at the registry's costPerQuery (0, coding-plan quota).
      usage: { queries_used: 1, search_cost_usd: searchConfig.costPerQuery },
      metrics: { response_time_ms: duration, upstream_latency_ms: duration, total_results_available: normalized.totalResults },
      errors: [],
    };
    // Plan quota consumption is not reported in dollars: cost stays unknown in the ledger.
    const accounting = mediaAccounting(null, ZAI_SEARCH_ID, KIND);
    accounting.meta.connectionId = connectionOf(credentials);
    return { success: true, status: 200, data, accounting, response: jsonResponse(data) };
  } catch (error) {
    const aborted = signal?.aborted;
    const timedOut = !aborted && (total.signal.aborted || stepTimedOut);
    let result;
    if (error instanceof StepError && error.status) {
      result = createErrorResult(error.status, error.message, error.evidence?.resetAtMs, undefined, error.evidence ?? null);
      if (error.quotaExhausted) result.quotaExhausted = true;
    } else {
      result = createErrorResult(aborted ? 499 : timedOut ? 504 : 502,
        aborted ? "Z.AI search aborted" : timedOut ? "Z.AI search deadline exceeded" : "Z.AI search request interrupted");
    }
    const uncertain = toolSent && (error?.unknownOutcome === true || !(error instanceof StepError && error.status));
    return uncertain || (toolAnswered && error?.unreadable)
      ? accepted(result, credentials, error?.state ?? (toolAnswered ? "completed-unread" : "submit-unknown"))
      : result;
  } finally {
    clearTimeout(totalTimer);
  }
}
