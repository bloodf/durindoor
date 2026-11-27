// One bounded submit, no refresh/retry/failover. A lost POST may already be billed.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { createErrorResult, readBoundedResponseText, parseRateLimitEvidence } from "../../../utils/error.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { SILICONFLOW_ID, SILICONFLOW_ORIGIN, SILICONFLOW_MODELS_URL, rerankModels } from "./config.js";
import { siliconflowRerankAdapter, siliconflowHeaders, safeModel } from "./adapter.js";

const KIND = "rerank";
const discard = (response) => { try { void response?.body?.cancel?.().catch(() => {}); } catch { /* Already locked. */ } };
const unsentCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const connectionOf = (credentials) => credentials?.id ?? credentials?.connectionId ?? null;
function receipt(raw) {
  // Only documented numeric token/USD fields; never retain arbitrary upstream strings.
  const usage = {};
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens", "cost_usd", "cost_in_usd"]) {
    if (Number.isFinite(raw?.usage?.[key]) && raw.usage[key] >= 0 &&
        (!key.endsWith("tokens") || Number.isSafeInteger(raw.usage[key]))) usage[key] = raw.usage[key];
  }
  return Object.keys(usage).length ? { usage } : null;
}
function accepted(result, credentials, state, raw = null) {
  const accounting = mediaAccounting(receipt(raw), SILICONFLOW_ID, KIND);
  return { ...result, acceptedJob: { ...accounting,
    costSource: accounting.costStatus === "known" ? accounting.costSource : "accepted-job",
    meta: { ...accounting.meta, jobState: state, connectionId: connectionOf(credentials) } } };
}

/** Bounded fixed-origin transport shared by submission and read-only discovery. */
async function request({ url, body, credentials, signal, timeoutMs = 30_000, fetchImpl = proxyAwareFetch, discovery = false }) {
  if (signal?.aborted) return createErrorResult(499, "SiliconFlow request aborted");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return createErrorResult(400, "Invalid SiliconFlow deadline");
  let headers;
  try { headers = siliconflowHeaders(credentials); } catch { return createErrorResult(401, "SiliconFlow API key required"); }
  const abort = new AbortController();
  const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => reject(new Error("SiliconFlow interrupted"));
    combined.addEventListener("abort", onAbort, { once: true });
  });
  let response;
  let sent = false;
  const unknown = (result, state = "submit-unknown") => discovery ? result : accepted(result, credentials, state);
  try {
    // url is one of the fixed constants; no user-provided base URL or path.
    sent = true;
    const pending = Promise.resolve().then(() => {
      if (combined.aborted) { sent = false; throw new Error("SiliconFlow cancelled before send"); }
      const init = { method: body ? "POST" : "GET", headers, redirect: "manual", signal: combined };
      if (body) init.body = JSON.stringify(body);
      return fetchImpl(url, init, resolveCredentialProxyOptions(credentials));
    });
    pending.then((late) => { if (combined.aborted) discard(late); }, () => {});
    response = await Promise.race([pending, interrupted]);
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      discard(response);
      return createErrorResult(502, "SiliconFlow redirect refused");
    }
    if (response.redirected || (response.url && new URL(response.url).origin !== SILICONFLOW_ORIGIN)) {
      discard(response);
      return unknown(createErrorResult(502, "SiliconFlow foreign response refused"));
    }
    const rawText = await Promise.race([readBoundedResponseText(response, {
      signal: combined, maxBytes: response.ok ? 8 * 1024 * 1024 : 16 * 1024, timeoutMs, throwOnTimeout: true,
    }), interrupted]);
    let raw;
    try { raw = JSON.parse(rawText); } catch { /* Never expose a parser message/body. */ }
    if (!response.ok) {
      const status = response.status;
      const code = raw?.error?.code ?? raw?.error?.type ?? raw?.code;
      const quota = status === 402 || ([403, 429].includes(status) &&
        /^(?:insufficient_quota|quota_exceeded|insufficient_balance|insufficient_credits|credit_limit)$/.test(code));
      if (status >= 500) return unknown(createErrorResult(502, "SiliconFlow submission outcome unknown"));
      if (quota) return { ...createErrorResult(402, "SiliconFlow connection quota exhausted"), quotaExhausted: true };
      const evidence = status === 429 ? parseRateLimitEvidence({ status, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() }) : null;
      return createErrorResult(status >= 400 && status < 500 ? status : 502, "SiliconFlow request refused", evidence?.resetAtMs, undefined, evidence);
    }
    if (raw === undefined || raw === null || (isRecord(raw) && raw.error)) return unknown(createErrorResult(502, "Invalid SiliconFlow response"), "completed-unusable");
    return { ok: true, raw };
  } catch (error) {
    discard(response);
    const failed = createErrorResult(signal?.aborted ? 499 : abort.signal.aborted ? 504 : 502,
      signal?.aborted ? "SiliconFlow request aborted" : abort.signal.aborted ? "SiliconFlow deadline exceeded" : "SiliconFlow request interrupted");
    return sent && !unsentCodes.has(error?.cause?.code ?? error?.code) ? unknown(failed, response?.ok ? "completed-unread" : "submit-unknown") : failed;
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", onAbort);
  }
}

/** Existing rerankCore result shape plus acceptedJob for possibly-billed failures. */
export async function handleSiliconflowRerankNative({ body, modelInfo, credentials, signal, timeoutMs, fetchImpl }) {
  if (modelInfo?.provider !== undefined && modelInfo.provider !== SILICONFLOW_ID) return createErrorResult(400, "Unsupported SiliconFlow service");
  let payload;
  try { payload = siliconflowRerankAdapter.buildBody(modelInfo?.model, body); } catch { return createErrorResult(400, "Unsupported SiliconFlow rerank request"); }
  const result = await request({ url: siliconflowRerankAdapter.buildUrl(), body: payload, credentials, signal, timeoutMs, fetchImpl });
  if (!result.ok) return result;
  let normalized;
  try { normalized = siliconflowRerankAdapter.normalize(result.raw, modelInfo.model, body); }
  catch { return accepted(createErrorResult(502, "Invalid SiliconFlow response"), credentials, "completed-unusable", result.raw); }
  const cleanReceipt = receipt(result.raw);
  if (cleanReceipt) normalized.usage = cleanReceipt.usage;
  const accounting = mediaAccounting(cleanReceipt, SILICONFLOW_ID, KIND);
  accounting.meta.connectionId = connectionOf(credentials);
  return { success: true, status: 200, accounting, response: Response.json(normalized) };
}

/**
 * Source normalizeOpenAiLikeModelsResponse (siliconflow is a NAMED_OPENAI_STYLE provider):
 * a bare array, `data` or `models` list; row id is `id || model || name`. Pricing/free
 * evidence is not retained here. Capabilities come only from the pinned catalog.
 * No cache crosses credentials.
 */
export async function discoverSiliconflowModels(options = {}) {
  const result = await request({ ...options, url: SILICONFLOW_MODELS_URL, body: null, discovery: true });
  if (!result.ok) return result;
  const raw = result.raw;
  const list = Array.isArray(raw) ? raw : isRecord(raw) ? (Array.isArray(raw.data) ? raw.data : raw.models) : undefined;
  if (!Array.isArray(list) || list.length > 10000) return createErrorResult(502, "Invalid SiliconFlow model catalog");
  const rows = new Map();
  for (const row of list) {
    const id = isRecord(row) ? [row.id, row.model, row.name].find((v) => isString(v) && v.trim()) : undefined;
    try { safeModel(id); } catch { return createErrorResult(502, "Invalid SiliconFlow model catalog"); }
    rows.set(id, { id, serviceKinds: rerankModels.some((m) => m.id === id) ? ["rerank"] : [] });
  }
  return { success: true, models: [...rows.values()] };
}
