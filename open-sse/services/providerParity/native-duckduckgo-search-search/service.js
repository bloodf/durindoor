// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT),
// open-sse/handlers/search.ts tryDuckDuckGoFreeProvider + open-sse/services/freeWebSearch.ts.
// One bounded submit to a fixed origin; no retry, refresh, replay or failover.
import { createErrorResult, readBoundedResponseText, parseRateLimitEvidence } from "../../../utils/error.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { DDG_FREE_ID, DDG_LITE_ORIGIN, searchConfig } from "./config.js";
import { duckduckgoSearchAdapter, isAnomalyPage } from "./adapter.js";

const KIND = "search";
export const MAX_DEADLINE_MS = 15_000; // local search/index.js GLOBAL_TIMEOUT_MS
const MAX_SUCCESS_BYTES = 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const discard = (response) => { try { void response?.body?.cancel?.().catch(() => {}); } catch { /* Already locked. */ } };
const unsentCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const connectionOf = (credentials) => credentials?.connectionId ?? credentials?.id ?? null;

function baseAccounting(credentials) {
  // No upstream receipt exists: cost stays unknown; one query was executed.
  const accounting = mediaAccounting(null, DDG_FREE_ID, KIND);
  accounting.nativeUnits = { operations: 1 };
  accounting.meta = { ...accounting.meta, connectionId: connectionOf(credentials) };
  return accounting;
}
function accepted(result, credentials, state) {
  const accounting = baseAccounting(credentials);
  return { ...result, acceptedJob: { ...accounting, costSource: "accepted-job", meta: { ...accounting.meta, jobState: state } } };
}
const rateLimited = (message, evidence = null) =>
  ({ ...createErrorResult(429, message, evidence?.resetAtMs, undefined, evidence), rateLimited: true });

/**
 * Local handleSearchCore result shape: `{ success, status, data, accounting, response }`
 * or a createErrorResult failure. Credentials only select the connection (proxy and
 * accounting scope); no credential value is ever sent to DuckDuckGo (authType "none").
 */
export async function handleDuckDuckGoFreeSearchNative({
  body, credentials = null, signal, timeoutMs = searchConfig.timeoutMs, fetchImpl = proxyAwareFetch, log,
} = {}) {
  if (signal?.aborted) return createErrorResult(499, "DuckDuckGo search aborted");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_DEADLINE_MS) return createErrorResult(400, "Invalid DuckDuckGo deadline");
  let params;
  try { params = duckduckgoSearchAdapter.parseParams(body); } catch { return createErrorResult(400, "Unsupported DuckDuckGo search request"); }
  const { url, init } = duckduckgoSearchAdapter.buildRequest(params);
  const startTime = Date.now();
  log?.info?.("SEARCH", `${DDG_FREE_ID} | type=${params.searchType}`);

  const abort = new AbortController();
  const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => reject(new Error("DuckDuckGo interrupted"));
    combined.addEventListener("abort", onAbort, { once: true });
  });
  interrupted.catch(() => {});
  let response;
  let sent = false;
  const uncertain = (result, state = "submit-unknown") => accepted(result, credentials, state);
  try {
    sent = true;
    const pending = Promise.resolve().then(() => {
      if (combined.aborted) { sent = false; throw new Error("DuckDuckGo cancelled before send"); }
      return fetchImpl(url, { ...init, redirect: "manual", signal: combined }, resolveCredentialProxyOptions(credentials));
    });
    pending.then((late) => { if (combined.aborted) discard(late); }, () => {});
    response = await Promise.race([pending, interrupted]);
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      discard(response);
      return createErrorResult(502, "DuckDuckGo redirect refused");
    }
    if (response.redirected || (response.url && new URL(response.url).origin !== DDG_LITE_ORIGIN)) {
      discard(response);
      return uncertain(createErrorResult(502, "DuckDuckGo foreign response refused"));
    }
    const html = await Promise.race([readBoundedResponseText(response, {
      signal: combined, maxBytes: response.ok ? MAX_SUCCESS_BYTES : MAX_ERROR_BYTES, timeoutMs, throwOnTimeout: true,
    }), interrupted]);
    if (isAnomalyPage(html)) return rateLimited("DuckDuckGo anti-bot challenge");
    if (!response.ok) {
      const status = response.status;
      if (status >= 500) return uncertain(createErrorResult(502, "DuckDuckGo search outcome unknown"));
      if (status === 429) {
        const evidence = parseRateLimitEvidence({ status, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() });
        return rateLimited("DuckDuckGo rate limited", evidence);
      }
      return createErrorResult(status >= 400 && status < 500 ? status : 502, "DuckDuckGo search refused");
    }
    // 202 is DuckDuckGo's deferred/throttled answer: it carries no results page.
    if (response.status !== 200) return rateLimited("DuckDuckGo deferred response");
    const type = response.headers.get("content-type");
    if (!html || (type && !/^text\/html\b/i.test(type))) return uncertain(createErrorResult(502, "Invalid DuckDuckGo response"), "completed-unusable");
    const duration = Date.now() - startTime;
    const data = duckduckgoSearchAdapter.normalize(html, params, duration);
    return {
      success: true,
      status: 200,
      data,
      accounting: baseAccounting(credentials),
      response: new Response(JSON.stringify(data), {
        status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }),
    };
  } catch (error) {
    discard(response);
    const failed = createErrorResult(signal?.aborted ? 499 : abort.signal.aborted ? 504 : 502,
      signal?.aborted ? "DuckDuckGo search aborted" : abort.signal.aborted ? "DuckDuckGo deadline exceeded" : "DuckDuckGo search interrupted");
    return sent && !unsentCodes.has(error?.cause?.code ?? error?.code) ? uncertain(failed, response?.ok ? "completed-unread" : "submit-unknown") : failed;
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", onAbort);
  }
}

/** The source has no model catalog or discovery endpoint for this provider. */
export function discoverDuckDuckGoFreeModels() {
  return { success: true, models: [], discovery: "none" };
}
