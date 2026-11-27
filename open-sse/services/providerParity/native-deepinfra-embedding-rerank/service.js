// One bounded submit, no refresh/retry/failover. A lost POST may already be billed.
import { isRecord } from "../../../../src/shared/utils/typeChecks.js";
import { createErrorResult, readBoundedResponseText, parseRateLimitEvidence } from "../../../utils/error.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { DEEPINFRA_ID, DEEPINFRA_ORIGIN, DEEPINFRA_MODELS_URL, embeddingModels, rerankModels } from "./config.js";
import { deepinfraEmbeddingAdapter, deepinfraRerankAdapter, deepinfraHeaders, safeModel } from "./adapter.js";

const discard = (response) => { try { void response?.body?.cancel?.().catch(() => {}); } catch { /* Already locked. */ } };
const unsentCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
function receipt(raw) {
  // Only documented numeric token/USD fields; never retain arbitrary upstream strings.
  const usage = {};
  for (const key of ["prompt_tokens", "total_tokens", "cost_usd", "cost_in_usd"]) {
    if (Number.isFinite(raw?.usage?.[key]) && raw.usage[key] >= 0 &&
        (!key.endsWith("tokens") || Number.isSafeInteger(raw.usage[key]))) usage[key] = raw.usage[key];
  }
  return Object.keys(usage).length ? { usage } : null;
}
function accepted(result, kind, credentials, state, raw = null) {
  const accounting = mediaAccounting(receipt(raw), DEEPINFRA_ID, kind);
  return { ...result, acceptedJob: { ...accounting,
    costSource: accounting.costStatus === "known" ? accounting.costSource : "accepted-job",
    meta: { ...accounting.meta, jobState: state, connectionId: credentials?.id ?? credentials?.connectionId ?? null } } };
}

/** Bounded fixed-origin transport shared by submission and read-only discovery. */
async function request({ url, body, credentials, signal, timeoutMs = 30_000, fetchImpl = proxyAwareFetch, kind }) {
  if (signal?.aborted) return createErrorResult(499, "DeepInfra request aborted");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return createErrorResult(400, "Invalid DeepInfra deadline");
  let headers;
  try { headers = deepinfraHeaders(credentials); } catch { return createErrorResult(401, "DeepInfra API key required"); }
  const abort = new AbortController();
  const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => reject(new Error("DeepInfra interrupted"));
    combined.addEventListener("abort", onAbort, { once: true });
  });
  let response;
  let sent = false;
  const unknown = (result, state = "submit-unknown") => kind === "discovery" ? result : accepted(result, kind, credentials, state);
  try {
    // url is constructed only from fixed constants and safeModel; no user base URL.
    sent = true;
    const pending = Promise.resolve().then(() => {
      if (combined.aborted) { sent = false; throw new Error("DeepInfra cancelled before send"); }
      const init = { method: body ? "POST" : "GET", headers, redirect: "manual", signal: combined };
      if (body) init.body = JSON.stringify(body);
      return fetchImpl(url, init, resolveCredentialProxyOptions(credentials));
    });
    pending.then((late) => { if (combined.aborted) discard(late); }, () => {});
    response = await Promise.race([pending, interrupted]);
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      discard(response);
      return createErrorResult(502, "DeepInfra redirect refused");
    }
    if (response.redirected || (response.url && new URL(response.url).origin !== DEEPINFRA_ORIGIN)) {
      discard(response);
      return unknown(createErrorResult(502, "DeepInfra foreign response refused"));
    }
    const rawText = await Promise.race([readBoundedResponseText(response, {
      signal: combined, maxBytes: response.ok ? 8 * 1024 * 1024 : 16 * 1024, timeoutMs, throwOnTimeout: true,
    }), interrupted]);
    let raw;
    try { raw = JSON.parse(rawText); } catch { /* Never expose a parser message/body. */ }
    if (!response.ok) {
      const status = response.status;
      const quota = status === 402 || ([403, 429].includes(status) && /^(?:insufficient_quota|quota_exceeded|insufficient_balance|insufficient_credits)$/.test(raw?.error?.code ?? raw?.code));
      if (status >= 500) return unknown(createErrorResult(502, "DeepInfra submission outcome unknown"));
      if (quota) return { ...createErrorResult(402, "DeepInfra connection quota exhausted"), quotaExhausted: true };
      const evidence = status === 429 ? parseRateLimitEvidence({ status, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() }) : null;
      return createErrorResult(status >= 400 && status < 500 ? status : 502, "DeepInfra request refused", evidence?.resetAtMs, undefined, evidence);
    }
    if (!isRecord(raw) || raw.error) return unknown(createErrorResult(502, "Invalid DeepInfra response"), "completed-unusable");
    return { ok: true, raw };
  } catch (error) {
    discard(response);
    const failed = createErrorResult(signal?.aborted ? 499 : abort.signal.aborted ? 504 : 502,
      signal?.aborted ? "DeepInfra request aborted" : abort.signal.aborted ? "DeepInfra deadline exceeded" : "DeepInfra request interrupted");
    return sent && !unsentCodes.has(error?.cause?.code ?? error?.code) ? unknown(failed, response?.ok ? "completed-unread" : "submit-unknown") : failed;
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", onAbort);
  }
}

/** Existing core result shape, including separate receipt accounting and acceptedJob. */
export async function handleDeepinfraNative({ kind, body, modelInfo, credentials, signal, timeoutMs, fetchImpl }) {
  const adapter = kind === "embedding" ? deepinfraEmbeddingAdapter : kind === "rerank" ? deepinfraRerankAdapter : null;
  if (!adapter || (modelInfo?.provider !== undefined && modelInfo.provider !== DEEPINFRA_ID)) return createErrorResult(400, "Unsupported DeepInfra service");
  let payload, url;
  try {
    payload = adapter.buildBody(modelInfo?.model, body);
    url = adapter.buildUrl(modelInfo.model);
  } catch { return createErrorResult(400, "Unsupported DeepInfra request"); }
  const result = await request({ url, body: payload, credentials, signal, timeoutMs, fetchImpl, kind });
  if (!result.ok) return result;
  let normalized;
  try { normalized = adapter.normalize(result.raw, modelInfo.model, body); }
  catch { return accepted(createErrorResult(502, "Invalid DeepInfra response"), kind, credentials, "completed-unusable", result.raw); }
  const cleanReceipt = receipt(result.raw);
  if (cleanReceipt) normalized.usage = cleanReceipt.usage;
  const accounting = mediaAccounting(cleanReceipt, DEEPINFRA_ID, kind);
  accounting.meta.connectionId = credentials?.id ?? credentials?.connectionId ?? null;
  return { success: true, status: 200, accounting, response: Response.json(normalized) };
}

/** Dynamic IDs remain capability-unknown unless in the pinned service catalogs. No cache crosses credentials. */
export async function discoverDeepinfraModels(options = {}) {
  const result = await request({ ...options, url: DEEPINFRA_MODELS_URL, body: null, kind: "discovery" });
  if (!result.ok) return result;
  if (!Array.isArray(result.raw.data) || result.raw.data.length > 10000) return createErrorResult(502, "Invalid DeepInfra model catalog");
  const rows = new Map();
  for (const row of result.raw.data) {
    try { safeModel(row?.id); } catch { return createErrorResult(502, "Invalid DeepInfra model catalog"); }
    rows.set(row.id, { id: row.id, serviceKinds: [
      ...(embeddingModels.some((m) => m.id === row.id) ? ["embedding"] : []),
      ...(rerankModels.some((m) => m.id === row.id) ? ["rerank"] : []),
    ] });
  }
  return { success: true, models: [...rows.values()] };
}
