// One bounded submit to the fixed s.jina.ai origin; no refresh, retry, replay or failover.
// A lost POST may already be billed (Jina charges search tokens on acceptance).
import { isRecord } from "../../../../src/shared/utils/typeChecks.js";
import { createErrorResult, readBoundedResponseText, parseRateLimitEvidence } from "../../../utils/error.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import {
  JINA_SEARCH_ID, JINA_SEARCH_ORIGIN, JINA_SEARCH_DEFAULT_TIMEOUT_MS, JINA_SEARCH_MAX_TIMEOUT_MS,
  searchConfig, searchModels,
} from "./config.js";
import { jinaSearchAdapter, jinaSearchHeaders } from "./adapter.js";

const KIND = "search";
const discard = (response) => { try { void response?.body?.cancel?.().catch(() => {}); } catch { /* Already locked. */ } };
const unsentCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const connectionOf = (credentials) => credentials?.id ?? credentials?.connectionId ?? null;
const QUOTA_RE = /^(?:InsufficientBalanceError|insufficient_balance|insufficient_quota|quota_exceeded)$/;

/** Jina reports consumed search tokens at meta.usage.tokens; it is never priced here. */
function jinaTokens(raw) {
  const tokens = raw?.meta?.usage?.tokens;
  return Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : null;
}

function accountingFor(raw, credentials) {
  // No top-level usage/USD receipt exists in Jina responses; cost stays unknown.
  const accounting = mediaAccounting(null, JINA_SEARCH_ID, KIND);
  const tokens = jinaTokens(raw);
  if (tokens !== null) {
    accounting.nativeUnits.jina_tokens = tokens;
    accounting.meta.nativeUnitsSource = "meta.usage.tokens";
  }
  accounting.meta.connectionId = connectionOf(credentials);
  return accounting;
}

function accepted(result, credentials, state, raw = null) {
  const accounting = accountingFor(raw, credentials);
  return { ...result, acceptedJob: { ...accounting, costSource: "accepted-job",
    meta: { ...accounting.meta, jobState: state } } };
}

function resolveTimeout(timeoutMs, deadlineAt, now) {
  const perCall = timeoutMs ?? JINA_SEARCH_DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(perCall) || perCall < 1 || perCall > JINA_SEARCH_MAX_TIMEOUT_MS) return null;
  if (deadlineAt === undefined) return perCall;
  if (!Number.isFinite(deadlineAt)) return null;
  const remaining = deadlineAt - now;
  return remaining < 1 ? 0 : Math.min(perCall, remaining);
}

/** Bounded fixed-origin transport; manual redirects; credential-free errors. */
async function submit({ payload, credentials, signal, timeout, fetchImpl }) {
  const headers = jinaSearchHeaders(credentials);
  const abort = new AbortController();
  const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  const timer = setTimeout(() => abort.abort(), timeout);
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => reject(new Error("Jina Search interrupted"));
    combined.addEventListener("abort", onAbort, { once: true });
  });
  let response;
  let sent = false;
  const unknown = (result, state = "submit-unknown") => accepted(result, credentials, state);
  try {
    sent = true;
    const pending = Promise.resolve().then(() => {
      if (combined.aborted) { sent = false; throw new Error("Jina Search cancelled before send"); }
      // Fixed constant URL: no caller- or connection-supplied base URL is honored.
      return fetchImpl(jinaSearchAdapter.buildUrl(), {
        method: "POST", headers, body: JSON.stringify(payload), redirect: "manual", signal: combined,
      }, resolveCredentialProxyOptions(credentials));
    });
    pending.then((late) => { if (combined.aborted) discard(late); }, () => {});
    response = await Promise.race([pending, interrupted]);
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      discard(response);
      return unknown(createErrorResult(502, "Jina Search redirect refused"));
    }
    if (response.redirected || (response.url && new URL(response.url).origin !== JINA_SEARCH_ORIGIN)) {
      discard(response);
      return unknown(createErrorResult(502, "Jina Search foreign response refused"));
    }
    const rawText = await Promise.race([readBoundedResponseText(response, {
      signal: combined, maxBytes: response.ok ? 8 * 1024 * 1024 : 16 * 1024, timeoutMs: timeout, throwOnTimeout: true,
    }), interrupted]);
    let raw;
    try { raw = JSON.parse(rawText); } catch { /* Never expose a parser message or body. */ }
    if (!response.ok) {
      const status = response.status;
      const name = raw?.name ?? raw?.error?.code ?? raw?.code;
      if (status >= 500) return unknown(createErrorResult(502, "Jina Search submission outcome unknown"));
      if (status === 402 || ([403, 429].includes(status) && QUOTA_RE.test(String(name ?? "")))) {
        return { ...createErrorResult(402, "Jina Search connection quota exhausted"), quotaExhausted: true };
      }
      if (status === 401 || status === 403) return createErrorResult(status, "Jina Search credentials refused");
      const evidence = status === 429 ? parseRateLimitEvidence({
        status, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now(),
      }) : null;
      return createErrorResult(status >= 400 && status < 500 ? status : 502, "Jina Search request refused", evidence?.resetAtMs, undefined, evidence);
    }
    if (raw === undefined || (isRecord(raw) && raw.error)) {
      return unknown(createErrorResult(502, "Invalid Jina Search response"), "completed-unusable");
    }
    return { ok: true, raw };
  } catch (error) {
    discard(response);
    const failed = createErrorResult(signal?.aborted ? 499 : abort.signal.aborted ? 504 : 502,
      signal?.aborted ? "Jina Search request aborted" : abort.signal.aborted ? "Jina Search deadline exceeded" : "Jina Search request interrupted");
    return sent && !unsentCodes.has(error?.cause?.code ?? error?.code) ?
      unknown(failed, response?.ok ? "completed-unread" : "submit-unknown") : failed;
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", onAbort);
  }
}

/**
 * Same result shape as open-sse/handlers/search/index.js handleSearchCore:
 * `{ success, status, data, accounting, response }`, or an error result that
 * carries `acceptedJob` whenever the request may already have been billed.
 */
export async function handleJinaSearchNative({
  body, credentials, signal, timeoutMs, deadlineAt, fetchImpl = proxyAwareFetch, now = Date.now,
} = {}) {
  if (signal?.aborted) return createErrorResult(499, "Jina Search request aborted");
  const startedAt = now();
  const timeout = resolveTimeout(timeoutMs, deadlineAt, startedAt);
  if (timeout === null) return createErrorResult(400, "Invalid Jina Search deadline");
  if (timeout === 0) return createErrorResult(504, "Jina Search deadline exceeded");
  let payload;
  try { payload = jinaSearchAdapter.buildBody(body); } catch { return createErrorResult(400, "Unsupported Jina Search request"); }
  try { jinaSearchHeaders(credentials); } catch { return createErrorResult(401, "Jina Search API key required"); }

  const result = await submit({ payload, credentials, signal, timeout, fetchImpl });
  if (!result.ok) return result;
  let normalized;
  try { normalized = jinaSearchAdapter.normalize(result.raw, payload.num); }
  catch { return accepted(createErrorResult(502, "Invalid Jina Search response"), credentials, "completed-unusable", result.raw); }

  const duration = Math.max(0, now() - startedAt);
  const data = {
    provider: JINA_SEARCH_ID,
    query: payload.q,
    results: normalized.results,
    answer: null,
    // Listed registry rate, as the local search envelope reports it; the ledger cost stays unknown.
    usage: { queries_used: 1, search_cost_usd: searchConfig.costPerQuery },
    metrics: { response_time_ms: duration, upstream_latency_ms: duration, total_results_available: normalized.totalResults },
    errors: normalized.dropped ? [{ code: "unsafe_results_dropped", count: normalized.dropped }] : [],
  };
  const accounting = accountingFor(result.raw, credentials);
  return {
    success: true, status: 200, data, accounting,
    response: new Response(JSON.stringify(data), {
      status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    }),
  };
}

/** The source has no dynamic discovery for search providers: the provider is the model. No network. */
export function listJinaSearchModels() {
  return { success: true, models: searchModels.map((m) => ({ id: m.id, serviceKinds: ["webSearch"] })) };
}
