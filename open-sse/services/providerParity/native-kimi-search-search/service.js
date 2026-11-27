// One bounded fixed-origin submit; no refresh, retry, replay, chat fallback or failover.
// A lost POST may already be billed ($0.005 per non-empty call), so it is never resent.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { createErrorResult, readBoundedResponseText, parseRateLimitEvidence } from "../../../utils/error.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { KIMI_SEARCH_ID, KIMI_SEARCH_ORIGIN, searchConfig } from "./config.js";
import { kimiSearchAdapter, kimiSearchHeaders } from "./adapter.js";

const KIND = "search";
const MAX_DEADLINE_MS = 15_000; // local search GLOBAL_TIMEOUT_MS
const QUOTA_CODES = /^(?:exceeded_current_quota_error|insufficient_quota|quota_exceeded|insufficient_balance|insufficient_credits|credit_limit)$/;
const unsentCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const discard = (response) => { try { void response?.body?.cancel?.().catch(() => {}); } catch { /* Already locked. */ } };
const connectionOf = (credentials) => credentials?.id ?? credentials?.connectionId ?? null;

/** Kimi returns no usage receipt; cost stays unknown and the registry price is metadata only. */
function accounting(credentials, extra = {}) {
  const acc = mediaAccounting(null, KIMI_SEARCH_ID, KIND);
  acc.meta = { ...acc.meta, connectionId: connectionOf(credentials), ...extra };
  return acc;
}
function accepted(result, credentials, state) {
  const acc = accounting(credentials, { jobState: state, registryCostPerQueryUsd: searchConfig.costPerQuery });
  return { ...result, acceptedJob: { ...acc, costSource: "accepted-job" } };
}

async function submit({ payload, credentials, signal, timeoutMs, fetchImpl }) {
  if (signal?.aborted) return createErrorResult(499, "Kimi Search request aborted");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_DEADLINE_MS) return createErrorResult(400, "Invalid Kimi Search deadline");
  let headers;
  try { headers = kimiSearchHeaders(credentials); } catch { return createErrorResult(401, "Kimi Search API key required"); }
  const abort = new AbortController();
  const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => reject(new Error("Kimi Search interrupted"));
    combined.addEventListener("abort", onAbort, { once: true });
  });
  interrupted.catch(() => {});
  let response;
  let sent = false;
  try {
    sent = true;
    const pending = Promise.resolve().then(() => {
      if (combined.aborted) { sent = false; throw new Error("Kimi Search cancelled before send"); }
      // Fixed constant URL; no caller base URL, path or redirect is ever followed.
      return fetchImpl(kimiSearchAdapter.buildUrl(), {
        method: "POST", headers, body: JSON.stringify(payload), redirect: "manual", signal: combined,
      }, resolveCredentialProxyOptions(credentials));
    });
    pending.then((late) => { if (combined.aborted) discard(late); }, () => {});
    response = await Promise.race([pending, interrupted]);
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      discard(response);
      return accepted(createErrorResult(502, "Kimi Search redirect refused"), credentials, "submit-unknown");
    }
    if (response.redirected || (response.url && new URL(response.url).origin !== KIMI_SEARCH_ORIGIN)) {
      discard(response);
      return accepted(createErrorResult(502, "Kimi Search foreign response refused"), credentials, "submit-unknown");
    }
    const rawText = await Promise.race([readBoundedResponseText(response, {
      signal: combined, maxBytes: response.ok ? 8 * 1024 * 1024 : 16 * 1024, timeoutMs, throwOnTimeout: true,
    }), interrupted]);
    let raw;
    try { raw = JSON.parse(rawText); } catch { /* Never expose a parser message/body. */ }
    if (!response.ok) {
      const status = response.status;
      const code = isRecord(raw?.error) ? raw.error.type ?? raw.error.code : raw?.code;
      const quota = status === 402 || ([403, 429].includes(status) && isString(code) && QUOTA_CODES.test(code));
      if (status >= 500) return accepted(createErrorResult(502, "Kimi Search outcome unknown"), credentials, "submit-unknown");
      if (quota) return { ...createErrorResult(402, "Kimi Search connection quota exhausted"), quotaExhausted: true };
      if (status === 401 || status === 403) return createErrorResult(status, "Kimi Search credential refused");
      const evidence = status === 429 ? parseRateLimitEvidence({ status, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() }) : null;
      return createErrorResult(status >= 400 && status < 500 ? status : 502, "Kimi Search request refused", evidence?.resetAtMs, undefined, evidence);
    }
    if (raw === undefined) return accepted(createErrorResult(502, "Invalid Kimi Search response"), credentials, "completed-unusable");
    return { ok: true, raw };
  } catch (error) {
    discard(response);
    const failed = createErrorResult(signal?.aborted ? 499 : abort.signal.aborted ? 504 : 502,
      signal?.aborted ? "Kimi Search request aborted" : abort.signal.aborted ? "Kimi Search deadline exceeded" : "Kimi Search request interrupted");
    return sent && !unsentCodes.has(error?.cause?.code ?? error?.code)
      ? accepted(failed, credentials, response?.ok ? "completed-unread" : "submit-unknown") : failed;
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", onAbort);
  }
}

/**
 * Local handleSearchCore result shape ({ success, data, accounting, response } or an error
 * result) plus `acceptedJob` for failures where the POST may have been billed.
 * `data` matches tryDedicatedProvider: { provider, query, results, answer, usage, metrics, errors }.
 */
export async function handleKimiSearchNative({ body, credentials, signal, timeoutMs = searchConfig.timeoutMs, fetchImpl = proxyAwareFetch, now }) {
  let payload;
  try { payload = kimiSearchAdapter.buildBody(body); } catch { return createErrorResult(400, "Unsupported Kimi Search request"); }
  const started = Date.now();
  const result = await submit({ payload, credentials, signal, timeoutMs, fetchImpl });
  if (!result.ok) return result;
  let normalized;
  try { normalized = kimiSearchAdapter.normalize(result.raw, payload.limit, now); }
  catch { return accepted(createErrorResult(502, "Invalid Kimi Search response"), credentials, "completed-unusable"); }
  const duration = Date.now() - started;
  const nonEmpty = normalized.results.length > 0;
  const data = {
    provider: KIMI_SEARCH_ID,
    query: payload.text_query,
    results: normalized.results,
    answer: null,
    // Registry list price (empty calls are documented as free); not a provider receipt.
    usage: { queries_used: 1, search_cost_usd: nonEmpty ? searchConfig.costPerQuery : 0 },
    metrics: { response_time_ms: duration, upstream_latency_ms: duration, total_results_available: normalized.totalResults },
    errors: [],
  };
  const acc = accounting(credentials, { registryCostPerQueryUsd: searchConfig.costPerQuery, nonEmpty });
  return { success: true, status: 200, data, accounting: acc, response: Response.json(data) };
}
