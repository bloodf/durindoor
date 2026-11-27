// One bounded submit per call: no refresh, retry, failover or chat fallback.
// A lost or unreadable POST may already have consumed Firecrawl credits.
import { isRecord } from "../../../../src/shared/utils/typeChecks.js";
import { createErrorResult, readBoundedResponseText, parseRateLimitEvidence } from "../../../utils/error.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { FIRECRAWL_ID, FIRECRAWL_ORIGIN } from "./config.js";
import { firecrawlSearchAdapter, firecrawlSearchHeaders, resultBlocks, estimatedSearchCostUsd } from "./adapter.js";

const KIND = "search";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 30_000;
const SUCCESS_BYTES = 4 * 1024 * 1024;
const ERROR_BYTES = 16 * 1024;
const discard = (response) => { try { void response?.body?.cancel?.().catch(() => {}); } catch { /* Already locked. */ } };
const unsentCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const connectionOf = (credentials) => credentials?.id ?? credentials?.connectionId ?? null;
const QUOTA_CODES = /^(?:insufficient_credits|insufficient_quota|quota_exceeded|payment_required|credit_limit)$/i;

/** Firecrawl v2 `creditsUsed` is a native credit count, never interpreted as USD. */
function credits(raw) {
  return Number.isSafeInteger(raw?.creditsUsed) && raw.creditsUsed >= 0 ? raw.creditsUsed : null;
}
function accepted(result, credentials, state, raw = null) {
  const accounting = mediaAccounting(null, FIRECRAWL_ID, KIND);
  const used = credits(raw);
  if (used !== null) { accounting.nativeUnits.credits = used; accounting.meta.nativeUnitsSource = "creditsUsed"; }
  return { ...result, acceptedJob: { ...accounting, costSource: "accepted-job",
    meta: { ...accounting.meta, jobState: state, connectionId: connectionOf(credentials) } } };
}

async function submit({ payload, credentials, signal, timeoutMs, fetchImpl }) {
  if (signal?.aborted) return createErrorResult(499, "Firecrawl search aborted");
  let headers;
  try { headers = firecrawlSearchHeaders(credentials); } catch { return createErrorResult(401, "Firecrawl API key required"); }
  const abort = new AbortController();
  const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => reject(new Error("Firecrawl interrupted"));
    combined.addEventListener("abort", onAbort, { once: true });
  });
  let response;
  let sent = false;
  const unknown = (result, state = "submit-unknown", raw = null) => accepted(result, credentials, state, raw);
  try {
    // Fixed constant URL; no caller/env/connection base URL reaches the request.
    sent = true;
    const pending = Promise.resolve().then(() => {
      if (combined.aborted) { sent = false; throw new Error("Firecrawl cancelled before send"); }
      return fetchImpl(firecrawlSearchAdapter.buildUrl(), {
        method: "POST", headers, body: JSON.stringify(payload), redirect: "manual", signal: combined,
      }, resolveCredentialProxyOptions(credentials));
    });
    pending.then((late) => { if (combined.aborted) discard(late); }, () => {});
    response = await Promise.race([pending, interrupted]);
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      discard(response);
      return createErrorResult(502, "Firecrawl redirect refused");
    }
    let origin = FIRECRAWL_ORIGIN;
    try { if (response.url) origin = new URL(response.url).origin; } catch { origin = null; }
    if (response.redirected || origin !== FIRECRAWL_ORIGIN) {
      discard(response);
      return unknown(createErrorResult(502, "Firecrawl foreign response refused"));
    }
    const rawText = await Promise.race([readBoundedResponseText(response, {
      signal: combined, maxBytes: response.ok ? SUCCESS_BYTES : ERROR_BYTES, timeoutMs, throwOnTimeout: true,
    }), interrupted]);
    let raw;
    try { raw = JSON.parse(rawText); } catch { /* Never expose a parser message or body. */ }
    if (!response.ok) {
      const status = response.status;
      const code = raw?.error?.code ?? raw?.code;
      if (status >= 500) return unknown(createErrorResult(502, "Firecrawl search outcome unknown"));
      if (status === 402 || (status === 403 && typeof code === "string" && QUOTA_CODES.test(code))) {
        return { ...createErrorResult(402, "Firecrawl connection quota exhausted"), quotaExhausted: true };
      }
      const evidence = status === 429 ? parseRateLimitEvidence({
        status, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now(),
      }) : null;
      return createErrorResult(status >= 400 && status < 500 ? status : 502, "Firecrawl search refused", evidence?.resetAtMs, undefined, evidence);
    }
    if (!isRecord(raw)) return unknown(createErrorResult(502, "Invalid Firecrawl search response"), "completed-unusable");
    return { ok: true, raw };
  } catch (error) {
    discard(response);
    const failed = createErrorResult(signal?.aborted ? 499 : abort.signal.aborted ? 504 : 502,
      signal?.aborted ? "Firecrawl search aborted" : abort.signal.aborted ? "Firecrawl deadline exceeded" : "Firecrawl search interrupted");
    return sent && !unsentCodes.has(error?.cause?.code ?? error?.code)
      ? unknown(failed, response?.ok ? "completed-unread" : "submit-unknown") : failed;
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", onAbort);
  }
}

/**
 * Same result shape as open-sse/handlers/search/index.js handleSearchCore
 * ({ success, data, accounting, response } / { success:false, status, error, response }),
 * plus `acceptedJob` on failures that may already be billed.
 */
export async function handleFirecrawlSearchNative({ body, provider, credentials, signal, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = proxyAwareFetch, now = () => Date.now() }) {
  const providerId = typeof provider === "string" ? provider : provider?.id;
  if (providerId !== undefined && providerId !== FIRECRAWL_ID) return createErrorResult(400, "Unsupported Firecrawl service");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) return createErrorResult(400, "Invalid Firecrawl deadline");
  let payload;
  try { payload = firecrawlSearchAdapter.buildBody(body); } catch { return createErrorResult(400, "Unsupported Firecrawl search request"); }
  const startedAt = now();
  const result = await submit({ payload, credentials, signal, timeoutMs, fetchImpl });
  if (!result.ok) return result;
  let normalized;
  try { normalized = firecrawlSearchAdapter.normalize(result.raw, payload); }
  catch { return accepted(createErrorResult(502, "Invalid Firecrawl search response"), credentials, "completed-unusable", result.raw); }
  const duration = Math.max(0, now() - startedAt);
  const data = {
    provider: FIRECRAWL_ID,
    query: payload.query,
    results: normalized.results,
    answer: null,
    // Registry list-price estimate exactly as the source computes it; not a provider receipt.
    usage: { queries_used: 1, search_cost_usd: estimatedSearchCostUsd(normalized.results.length) },
    metrics: { response_time_ms: duration, upstream_latency_ms: duration, total_results_available: normalized.totalResults },
    errors: normalized.dropped ? [{ code: "unsafe_result_dropped", count: normalized.dropped }] : [],
  };
  const accounting = mediaAccounting(null, FIRECRAWL_ID, KIND);
  // Evidenced billing blocks; the public handler prices them at costPerQuery as an estimate.
  accounting.nativeUnits.operations = resultBlocks(normalized.results.length);
  accounting.meta.nativeUnitsSource = "returned-result-blocks";
  const used = credits(result.raw);
  if (used !== null) { accounting.nativeUnits.credits = used; accounting.meta.creditsSource = "creditsUsed"; }
  accounting.meta.connectionId = connectionOf(credentials);
  return { success: true, status: 200, data, accounting, response: Response.json(data, { headers: { "Access-Control-Allow-Origin": "*" } }) };
}
