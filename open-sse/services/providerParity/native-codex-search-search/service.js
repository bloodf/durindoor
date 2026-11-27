// One bounded fixed-origin submit per call: no token refresh, retry, replay, chat fallback
// or failover. The POST spends ChatGPT subscription quota (~10k input tokens per source),
// so a submit whose outcome is uncertain is reported as an accepted job and never resent.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { createErrorResult, readBoundedResponseText, parseRateLimitEvidence } from "../../../utils/error.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { CODEX_SEARCH_ID, CODEX_SEARCH_ORIGIN, CODEX_SEARCH_LOCK_KEY, searchConfig } from "./config.js";
import { codexSearchAdapter, codexSearchHeaders, CodexSearchError, CODEX_SEARCH_MAX_BYTES, makeCodexSearchResult } from "./adapter.js";

const KIND = "search";
export const MAX_TIMEOUT_MS = searchConfig.timeoutMs; // source: min(registry 60s, remaining global budget)
const ERROR_BYTES = 16 * 1024;
const QUOTA_CODES = /usage_limit|insufficient_quota|quota_exceeded|rate_limit_exceeded/i;
const unsentCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const discard = (response) => { try { void response?.body?.cancel?.().catch(() => {}); } catch { /* Already locked. */ } };
const connectionOf = (credentials) => credentials?.id ?? credentials?.connectionId ?? null;

/** Subscription-backed search: tokens come from the upstream receipt, USD cost stays unknown. */
function accounting(credentials, usage = null, extra = {}) {
  const acc = mediaAccounting(usage ? { usage } : null, CODEX_SEARCH_ID, KIND);
  acc.meta = { ...acc.meta, connectionId: connectionOf(credentials), quotaScope: CODEX_SEARCH_LOCK_KEY, billing: "chatgpt-subscription", ...extra };
  return acc;
}
function accepted(result, credentials, state, usage = null) {
  return { ...result, acceptedJob: { ...accounting(credentials, usage, { jobState: state }), costSource: "accepted-job" } };
}
/** Search cooldowns use the search-only scope; never the shared Codex chat scope. */
const scoped = (result, credentials, extra) => ({ ...result, lockKey: CODEX_SEARCH_LOCK_KEY, lockConnectionId: connectionOf(credentials), ...extra });

async function submit({ payload, credentials, signal, timeoutMs, fetchImpl }) {
  if (signal?.aborted) return createErrorResult(499, "Codex web search aborted");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) return createErrorResult(400, "Invalid Codex web search deadline");
  let headers;
  try { headers = codexSearchHeaders(credentials); } catch { return createErrorResult(401, "Codex account credential required"); }
  const abort = new AbortController();
  const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => reject(new Error("Codex web search interrupted"));
    combined.addEventListener("abort", onAbort, { once: true });
  });
  interrupted.catch(() => {});
  let response;
  let sent = false;
  try {
    sent = true;
    const pending = Promise.resolve().then(() => {
      if (combined.aborted) { sent = false; throw new Error("Codex web search cancelled before send"); }
      // Fixed constant URL: no caller/connection base URL can receive the OAuth token.
      return fetchImpl(codexSearchAdapter.buildUrl(), {
        method: "POST", headers, body: JSON.stringify(payload), redirect: "manual", signal: combined,
      }, resolveCredentialProxyOptions(credentials));
    });
    pending.then((late) => { if (combined.aborted) discard(late); }, () => {});
    response = await Promise.race([pending, interrupted]);
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      discard(response);
      return accepted(createErrorResult(502, "Codex web search redirect refused"), credentials, "submit-unknown");
    }
    let origin = CODEX_SEARCH_ORIGIN;
    try { if (response.url) origin = new URL(response.url).origin; } catch { origin = null; }
    if (response.redirected || origin !== CODEX_SEARCH_ORIGIN) {
      discard(response);
      return accepted(createErrorResult(502, "Codex web search foreign response refused"), credentials, "submit-unknown");
    }
    const status = response.status;
    if (status === 401 || status === 403) {
      // Source: 401 is a credential failure, not a quota cooldown; the body is never read.
      discard(response);
      return createErrorResult(status, "Codex account credential refused");
    }
    const rawText = await Promise.race([readBoundedResponseText(response, {
      signal: combined, maxBytes: response.ok ? CODEX_SEARCH_MAX_BYTES : ERROR_BYTES, timeoutMs, throwOnTimeout: true,
    }), interrupted]);
    if (!response.ok) {
      let raw;
      try { raw = JSON.parse(rawText); } catch { /* Never expose a parser message or body. */ }
      const err = isRecord(raw?.error) ? raw.error : isRecord(raw) ? raw : {};
      const code = [err.type, err.code].find(isString) ?? "";
      if (status >= 500) return accepted(createErrorResult(502, "Codex web search outcome unknown"), credentials, "submit-unknown");
      if (status === 429 || status === 402) {
        const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() });
        const quota = status === 402 || QUOTA_CODES.test(code);
        return scoped(createErrorResult(429, quota ? "Codex search quota exhausted" : "Codex web search rate limited", evidence?.resetAtMs, undefined, evidence),
          credentials, { rateLimited: true, quotaExhausted: quota });
      }
      return createErrorResult(status >= 400 && status < 500 ? status : 502, "Codex web search request refused");
    }
    return { ok: true, text: rawText };
  } catch (error) {
    discard(response);
    const failed = createErrorResult(signal?.aborted ? 499 : abort.signal.aborted ? 504 : 502,
      signal?.aborted ? "Codex web search aborted" : abort.signal.aborted ? "Codex web search deadline exceeded" : "Codex web search interrupted");
    return sent && !unsentCodes.has(error?.cause?.code ?? error?.code)
      ? accepted(failed, credentials, response?.ok ? "completed-unread" : "submit-unknown") : failed;
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", onAbort);
  }
}

/**
 * Local handleSearchCore result shape ({ success, data, accounting, response } or an error
 * result) plus `acceptedJob` for failures where subscription quota may have been spent.
 * `data` matches the source executeCodexSearch envelope.
 */
export async function handleCodexSearchNative({ body, credentials, signal, timeoutMs = searchConfig.timeoutMs, fetchImpl = proxyAwareFetch, now }) {
  let params;
  try { params = codexSearchAdapter.buildParams(body, credentials?.providerSpecificData); } catch { return createErrorResult(400, "Unsupported Codex web search request"); }
  const payload = codexSearchAdapter.buildBody(params);
  const started = Date.now();
  const result = await submit({ payload, credentials, signal, timeoutMs, fetchImpl });
  if (!result.ok) return result;
  let parsed;
  try { parsed = codexSearchAdapter.parse(result.text, params.maxResults); }
  catch (error) {
    // A stream-level failure follows a 200: the turn ran, so quota may be spent.
    const status = error instanceof CodexSearchError ? error.statusHint : 502;
    const failed = accepted(createErrorResult(status === 429 ? 429 : status === 400 ? 400 : 502,
      status === 429 ? "Codex search quota exhausted" : "Codex web search failed"), credentials, "completed-unusable");
    return status === 429 ? scoped(failed, credentials, { rateLimited: true, quotaExhausted: true }) : failed;
  }
  const at = now ?? new Date().toISOString();
  const results = parsed.results.map((row, idx) => makeCodexSearchResult(row, idx, at));
  const duration = Date.now() - started;
  const data = {
    provider: CODEX_SEARCH_ID,
    query: params.query,
    results,
    answer: null,
    // Registry costPerQuery: no per-query API charge. Subscription quota cost is unknown (see accounting).
    usage: { queries_used: parsed.searches, search_cost_usd: 0 },
    metrics: { response_time_ms: duration, upstream_latency_ms: duration, total_results_available: results.length },
    errors: [],
  };
  const acc = accounting(credentials, Object.keys(parsed.usage).length ? parsed.usage : null, { model: params.model });
  acc.nativeUnits = { ...acc.nativeUnits, queries: parsed.searches };
  return { success: true, status: 200, data, accounting: acc, response: Response.json(data) };
}
