// One bounded fixed-origin GET; no refresh, retry, replay, pagination or failover.
// Xquik meters per returned post, so a lost GET may already be billed and is never resent.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { createErrorResult, readBoundedResponseText, parseRateLimitEvidence } from "../../../utils/error.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { XQUIK_SEARCH_ID, XQUIK_SEARCH_ORIGIN, searchConfig } from "./config.js";
import { xquikSearchAdapter, xquikSearchHeaders } from "./adapter.js";

const KIND = "search";
const MAX_DEADLINE_MS = 15_000; // local search GLOBAL_TIMEOUT_MS == source registry timeoutMs
const QUOTA_CODES = /^(?:insufficient_credits|insufficient_quota|quota_exceeded|credit_limit|no_credits|payment_required)$/;
const unsentCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const discard = (response) => { try { void response?.body?.cancel?.().catch(() => {}); } catch { /* Already locked. */ } };
const connectionOf = (credentials) => credentials?.id ?? credentials?.connectionId ?? null;

/** Xquik returns no usage receipt; cost stays unknown and the registry estimate is metadata only. */
function accounting(credentials, extra = {}) {
  const acc = mediaAccounting(null, XQUIK_SEARCH_ID, KIND);
  acc.meta = { ...acc.meta, connectionId: connectionOf(credentials), ...extra };
  return acc;
}
function accepted(result, credentials, state) {
  const acc = accounting(credentials, { jobState: state, registryCostPerQueryUsd: searchConfig.costPerQuery });
  return { ...result, acceptedJob: { ...acc, costSource: "accepted-job" } };
}

function errorCode(raw) {
  if (!isRecord(raw)) return undefined;
  if (isRecord(raw.error)) return raw.error.code ?? raw.error.type;
  return isString(raw.error) ? raw.error : raw.code;
}

async function submit({ url, credentials, signal, timeoutMs, fetchImpl }) {
  if (signal?.aborted) return createErrorResult(499, "Xquik Search request aborted");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_DEADLINE_MS) return createErrorResult(400, "Invalid Xquik Search deadline");
  let headers;
  try { headers = xquikSearchHeaders(credentials); } catch { return createErrorResult(401, "Xquik Search API key required"); }
  const abort = new AbortController();
  const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => reject(new Error("Xquik Search interrupted"));
    combined.addEventListener("abort", onAbort, { once: true });
  });
  interrupted.catch(() => {});
  let response;
  let sent = false;
  try {
    sent = true;
    const pending = Promise.resolve().then(() => {
      if (combined.aborted) { sent = false; throw new Error("Xquik Search cancelled before send"); }
      // Fixed origin/path; no caller base URL, path or redirect is ever followed.
      return fetchImpl(url, { method: "GET", headers, redirect: "manual", signal: combined }, resolveCredentialProxyOptions(credentials));
    });
    pending.then((late) => { if (combined.aborted) discard(late); }, () => {});
    response = await Promise.race([pending, interrupted]);
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      discard(response);
      return accepted(createErrorResult(502, "Xquik Search redirect refused"), credentials, "submit-unknown");
    }
    if (response.redirected || (response.url && new URL(response.url).origin !== XQUIK_SEARCH_ORIGIN)) {
      discard(response);
      return accepted(createErrorResult(502, "Xquik Search foreign response refused"), credentials, "submit-unknown");
    }
    const rawText = await Promise.race([readBoundedResponseText(response, {
      signal: combined, maxBytes: response.ok ? 8 * 1024 * 1024 : 16 * 1024, timeoutMs, throwOnTimeout: true,
    }), interrupted]);
    let raw;
    try { raw = JSON.parse(rawText); } catch { /* Never expose a parser message/body. */ }
    if (!response.ok) {
      const status = response.status;
      const code = errorCode(raw);
      const quota = status === 402 || ([403, 429].includes(status) && isString(code) && QUOTA_CODES.test(code));
      if (status >= 500) return accepted(createErrorResult(502, "Xquik Search outcome unknown"), credentials, "submit-unknown");
      if (quota) return { ...createErrorResult(402, "Xquik Search connection quota exhausted"), quotaExhausted: true };
      if (status === 401 || status === 403) return createErrorResult(status, "Xquik Search credential refused");
      const evidence = status === 429 ? parseRateLimitEvidence({ status, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() }) : null;
      return createErrorResult(status >= 400 && status < 500 ? status : 502, "Xquik Search request refused", evidence?.resetAtMs, undefined, evidence);
    }
    if (raw === undefined) return accepted(createErrorResult(502, "Invalid Xquik Search response"), credentials, "completed-unusable");
    return { ok: true, raw };
  } catch (error) {
    discard(response);
    const failed = createErrorResult(signal?.aborted ? 499 : abort.signal.aborted ? 504 : 502,
      signal?.aborted ? "Xquik Search request aborted" : abort.signal.aborted ? "Xquik Search deadline exceeded" : "Xquik Search request interrupted");
    return sent && !unsentCodes.has(error?.cause?.code ?? error?.code)
      ? accepted(failed, credentials, response?.ok ? "completed-unread" : "submit-unknown") : failed;
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", onAbort);
  }
}

/**
 * Local handleSearchCore result shape ({ success, data, accounting, response } or an error
 * result) plus `acceptedJob` for failures where the GET may have been billed.
 * `data` matches tryDedicatedProvider: { provider, query, results, answer, usage, metrics, errors }.
 */
export async function handleXquikSearchNative({ body, credentials, signal, timeoutMs = searchConfig.timeoutMs, fetchImpl = proxyAwareFetch, now, nowMs }) {
  let params;
  try { params = xquikSearchAdapter.buildParams(body, credentials, nowMs ?? Date.now()); } catch { return createErrorResult(400, "Unsupported Xquik Search request"); }
  const started = Date.now();
  const result = await submit({ url: xquikSearchAdapter.buildUrl(params), credentials, signal, timeoutMs, fetchImpl });
  if (!result.ok) return result;
  let normalized;
  try { normalized = xquikSearchAdapter.normalize(result.raw, params.limit, now); }
  catch { return accepted(createErrorResult(502, "Invalid Xquik Search response"), credentials, "completed-unusable"); }
  const duration = Date.now() - started;
  const returnedPosts = normalized.results.length;
  const data = {
    provider: XQUIK_SEARCH_ID,
    query: params.q,
    results: normalized.results,
    answer: null,
    // Source handler reports the registry estimate (config.costPerQuery); not a provider receipt.
    usage: { queries_used: 1, search_cost_usd: searchConfig.costPerQuery },
    metrics: { response_time_ms: duration, upstream_latency_ms: duration, total_results_available: normalized.totalResults },
    errors: [],
  };
  const acc = accounting(credentials, { registryCostPerQueryUsd: searchConfig.costPerQuery, returnedPosts, queryType: params.queryType });
  return { success: true, status: 200, data, accounting: acc, response: Response.json(data) };
}
