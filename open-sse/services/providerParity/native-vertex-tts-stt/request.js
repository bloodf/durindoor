// One bounded Vertex `generateContent` call for the staged Gemini TTS/STT
// adapters, with accepted-job accounting for outcomes that may have billed.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/executors/vertexMedia.ts (`fetch(url, { method: "POST", headers,
// body: JSON.stringify(payload) })`, `vertexError`).
//
// Fork deviations: the call is bounded by the caller's signal and a deadline
// (the wait ends even if a transport ignores its signal; a late answer is
// discarded); redirects are refused and an answer from another origin is
// rejected; response bodies are size bounded; upstream error text never reaches
// a message (only Google's `error.status` enum, e.g. RESOURCE_EXHAUSTED); a call
// whose outcome is unknown (sent, then interrupted, timed out, 5xx, unreadable
// or unusable 2xx) carries `acceptedJob` and is never replayed.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { VERTEX_AUDIO_PROVIDER_ID } from "./config.js";

// Transport failures before a connection exists: nothing reached Google.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const GOOGLE_STATUS_RE = /^[A-Z][A-Z_]{1,63}$/;
const MAX_ERROR_BYTES = 16 * 1024;
const QUOTA_REASONS = new Set(["BILLING_DISABLED", "BILLING_NOT_ACTIVE"]);

const discard = (response) => void response?.body?.cancel?.().catch(() => {});

/** Accounting for a Vertex call that may have run (and billed) with no usable answer. */
export function vertexAudioAcceptedJob(modality, jobState, data = null) {
  const accounting = mediaAccounting(isRecord(data) && isRecord(data.usageMetadata) ? data : null, "gemini", modality);
  return { ...accounting, costSource: "accepted-job", meta: { ...accounting.meta, jobState } };
}

const withAcceptedJob = (result, modality, jobState, data) => ({ ...result, acceptedJob: vertexAudioAcceptedJob(modality, jobState, data) });
export const vertexAbortedResult = () => ({ ...createErrorResult(499, "Vertex audio request aborted"), local: true });

function googleErrorDetail(text) {
  try {
    const parsed = JSON.parse(text);
    const error = isRecord(parsed?.error) ? parsed.error : Array.isArray(parsed) && isRecord(parsed[0]?.error) ? parsed[0].error : null;
    const code = isString(error?.status) && GOOGLE_STATUS_RE.test(error.status) ? error.status : null;
    const reasons = Array.isArray(error?.details) ? error.details.map((d) => d?.reason).filter((r) => isString(r) && GOOGLE_STATUS_RE.test(r)) : [];
    return { code, reasons };
  } catch {
    return { code: null, reasons: [] };
  }
}

async function refused(response, { signal, label, modality, secrets }) {
  const { status } = response;
  let detail = { code: null, reasons: [] };
  try {
    detail = googleErrorDetail(await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs: 2_000 }));
  } catch {
    discard(response);
  }
  const suffix = detail.code ? ` (${detail.code})` : "";
  if (status >= 500) {
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Vertex ${label} failed with ${status}${suffix}; whether it was billed is unknown`, undefined, undefined, null, secrets),
      modality, "submit-unknown"
    );
  }
  if (detail.reasons.some((r) => QUOTA_REASONS.has(r))) {
    return { ...createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `Vertex AI billing is not active for this project${suffix}`, undefined, undefined, null, secrets), quotaExhausted: true };
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, `Vertex AI rate limited ${label}${suffix}`, usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `Vertex AI refused the ${label} request with ${status}${suffix}`, undefined, undefined, null, secrets);
}

/**
 * POST one generateContent body to a fixed Vertex endpoint.
 *
 * @returns {Promise<{ok: true, data: object} | (object & {success: false})>} the parsed
 *   JSON answer, or an error result (with `acceptedJob` when Vertex may have billed)
 */
export async function sendVertexGenerateContent({
  request, body, signal, timeoutMs, maxResponseBytes, proxyOptions = null, label, modality, secrets,
}) {
  if (signal?.aborted) return vertexAbortedResult();
  const deadline = new AbortController();
  const fetchSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  const timeoutError = () => Object.assign(new Error(`${label} timed out`), { name: "TimeoutError" });
  let timedOut = false;
  const startedAt = Date.now();
  const timer = setTimeout(() => {
    timedOut = true;
    deadline.abort(timeoutError());
  }, timeoutMs);
  let stopWaiting;
  const bound = new Promise((_, rejectWait) => {
    stopWaiting = () => rejectWait(timedOut ? timeoutError() : Object.assign(new Error("aborted"), { name: "AbortError" }));
    fetchSignal.addEventListener("abort", stopWaiting, { once: true });
  });
  bound.catch(() => {});
  const remaining = () => Math.max(1, timeoutMs - (Date.now() - startedAt));

  try {
    let response;
    const pending = fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(body),
      redirect: "manual",
      signal: fetchSignal,
      proxyOptions,
    });
    try {
      response = await Promise.race([pending, bound]);
    } catch (error) {
      pending.then(discard, () => {});
      const unsent = PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);
      if (signal?.aborted && !timedOut) return unsent ? vertexAbortedResult() : withAcceptedJob(vertexAbortedResult(), modality, "submit-unknown");
      if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Vertex ${label} could not connect`);
      return withAcceptedJob(createErrorResult(
        timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
        `Vertex ${label} ${timedOut ? "timed out" : "was interrupted"}; whether it was billed is unknown`
      ), modality, "submit-unknown");
    }

    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      discard(response);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Vertex ${label} redirect refused`);
    }
    let answeredBy = request.origin;
    try {
      if (response.url) answeredBy = new URL(response.url).origin;
    } catch {
      answeredBy = null;
    }
    if (response.redirected || answeredBy !== request.origin) {
      discard(response);
      return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Vertex ${label} was redirected`), modality, "submit-unknown");
    }
    if (!response.ok) return await refused(response, { signal: fetchSignal, label, modality, secrets });

    let text;
    try {
      text = await readBoundedResponseText(response, { signal: fetchSignal, maxBytes: maxResponseBytes, timeoutMs: remaining(), throwOnTimeout: true });
    } catch {
      if (signal?.aborted && !timedOut) return withAcceptedJob(vertexAbortedResult(), modality, "completed-unread");
      return withAcceptedJob(createErrorResult(timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY, `Vertex ${label} response could not be read`), modality, "completed-unread");
    }
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // The parser's message quotes the body, so it is dropped.
    }
    if (!isRecord(data)) {
      return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Vertex ${label} returned an unreadable or oversized response`), modality, "completed-unread");
    }
    return { ok: true, data };
  } finally {
    clearTimeout(timer);
    fetchSignal.removeEventListener("abort", stopWaiting);
  }
}

/** An error result for a completed call whose answer is unusable; it may have billed. */
export function vertexUnusableResult(message, modality, data) {
  return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, message), modality, "completed-unusable", data);
}
