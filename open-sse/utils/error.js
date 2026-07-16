import {
  ERROR_TYPES,
  DEFAULT_ERROR_MESSAGES,
  MAX_RATE_LIMIT_COOLDOWN_MS,
} from "../config/errorConfig.js";
import { unwrapClinepassEnvelope } from "./clinepassEnvelope.js";

/**
 * Build OpenAI-compatible error response body
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {object} Error response object
 */
export function buildErrorBody(statusCode, message) {
  const errorInfo = ERROR_TYPES[statusCode] || 
    (statusCode >= 500 
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" });

  // Root seam (OmniRoute #6886): every non-streaming (`errorResponse`) and
  // SSE (`writeStreamError`) API error body built here routes its
  // `error.message` through sanitizeErrorMessage — no per-handler wrappers.
  // The status-specific default is sanitized too (harmless) so an empty/blank
  // message still yields the status default, never `""`. A caller-supplied
  // structured errorBody bypasses this builder; createErrorResult sanitizes
  // that shape's `error.message` separately. Other structured fields (e.g.
  // `upstream_details`) are not rewritten here.
  return {
    error: {
      message: sanitizeErrorMessage(message || DEFAULT_ERROR_MESSAGES[statusCode] || "An error occurred"),
      type: errorInfo.type,
      code: errorInfo.code
    }
  };
}

/**
 * Create error Response object (for non-streaming)
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {Response} HTTP Response object
 */
export function errorResponse(statusCode, message) {
  return new Response(JSON.stringify(buildErrorBody(statusCode, message)), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

/**
 * Write error to SSE stream (for streaming)
 * @param {WritableStreamDefaultWriter} writer - Stream writer
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 */
export async function writeStreamError(writer, statusCode, message) {
  const errorBody = buildErrorBody(statusCode, message);
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(`data: ${JSON.stringify(errorBody)}\n\n`));
}

const RESET_HEADERS = Object.freeze([
  "x-ratelimit-reset",
  "x-ratelimit-reset-requests",
  "x-ratelimit-reset-tokens",
]);
const RELATIVE_MILLISECOND_FIELDS = new Set(["retry_after_ms", "retryafterms"]);
const RELATIVE_SECOND_FIELDS = new Set(["retryafter", "retry_after"]);
const ABSOLUTE_RESET_FIELDS = new Set(["reset_at", "resets_at", "resetat", "resetsat"]);
const EXPLICIT_QUOTA_TEXT = /(?:\bquota\b[^\n]{0,48}\b(?:reached|exceeded|exhausted|depleted|reset)\b|\b(?:reached|exceeded|exhausted|depleted)\b[^\n]{0,48}\bquota\b|\b(?:weekly|daily|session|usage)\b[^\n]{0,48}\blimit\b[^\n]{0,48}\b(?:reached|exceeded|exhausted)\b|\b(?:reached|exceeded|exhausted)\b[^\n]{0,48}\b(?:weekly|daily|session|usage)\b[^\n]{0,48}\blimit\b|\blimit\b[^\n]{0,48}\b(?:weekly|daily|session|usage)\b[^\n]{0,48}\b(?:reached|exceeded|exhausted)\b)/i;
const STRUCTURED_QUOTA_EXHAUSTION_CODES = new Set([
  "billing_hard_limit_reached",
  "insufficient_quota",
  "quota_exceeded",
  "usage_limit_reached",
]);

function boundedAbsoluteReset(value, now, maxDelayMs) {
  const reset = Number(value);
  if (!Number.isFinite(reset) || reset <= now || reset - now > maxDelayMs) return null;
  return Math.floor(reset);
}

function absoluteFromEpoch(value, now, maxDelayMs) {
  if (typeof value === "string" && !/^\d{1,16}$/.test(value.trim())) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return boundedAbsoluteReset(number < 1e12 ? number * 1000 : number, now, maxDelayMs);
}

function absoluteFromIso(value, now, maxDelayMs) {
  if (typeof value !== "string" || !value.trim() || value.length > 128) return null;
  return boundedAbsoluteReset(Date.parse(value), now, maxDelayMs);
}

function relativeReset(value, multiplier, now, maxDelayMs) {
  if (typeof value === "string" && !/^\d{1,12}$/.test(value.trim())) return null;
  const duration = Number(value) * multiplier;
  if (!Number.isSafeInteger(duration) || duration <= 0 || duration > maxDelayMs) return null;
  return now + duration;
}

function retryAfterReset(value, now, maxDelayMs) {
  if (typeof value !== "string" || !value.trim() || value.length > 128) return null;
  const text = value.trim();
  if (/^\d{1,9}$/.test(text)) return relativeReset(text, 1000, now, maxDelayMs);
  return absoluteFromIso(text, now, maxDelayMs);
}

function durationHeaderReset(value, now, maxDelayMs) {
  if (typeof value !== "string" || !value.trim() || value.length > 64) return null;
  const compact = value.trim().replace(/\s+/g, "");
  if (!/^(?:\d{1,6}(?:ms|[wdhms]))+$/i.test(compact)) return null;
  const factors = { w: 604_800_000, d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000, ms: 1 };
  let duration = 0;
  let consumed = "";
  for (const match of compact.matchAll(/(\d{1,6})(ms|[wdhms])/gi)) {
    const amount = Number(match[1]);
    const factor = factors[match[2].toLowerCase()];
    duration += amount * factor;
    consumed += match[0];
    if (!Number.isSafeInteger(duration) || duration <= 0 || duration > maxDelayMs) return null;
  }
  return consumed.toLowerCase() === compact.toLowerCase() ? now + duration : null;
}

function findJsonReset(value, now, maxDelayMs) {
  let visited = 0;
  const visit = (node, depth) => {
    if (depth > 4 || visited++ > 100 || !node || typeof node !== "object") return null;
    for (const [rawKey, item] of Object.entries(node).slice(0, 50)) {
      const key = rawKey.toLowerCase();
      let reset = null;
      if (RELATIVE_MILLISECOND_FIELDS.has(key)) reset = relativeReset(item, 1, now, maxDelayMs);
      else if (RELATIVE_SECOND_FIELDS.has(key)) {
        reset = relativeReset(item, 1000, now, maxDelayMs) || absoluteFromIso(item, now, maxDelayMs);
      } else if (ABSOLUTE_RESET_FIELDS.has(key)) {
        reset = absoluteFromEpoch(item, now, maxDelayMs) || absoluteFromIso(item, now, maxDelayMs);
      }
      if (reset) return reset;
      const nested = visit(item, depth + 1);
      if (nested) return nested;
    }
    return null;
  };
  return visit(value, 0);
}

function hasStructuredQuotaExhaustion(text) {
  if (typeof text !== "string" || text.length > 64 * 1024) return false;
  let root;
  try { root = JSON.parse(text); } catch { return false; }
  let visited = 0;
  const visit = (node, depth) => {
    if (depth > 4 || visited++ > 100 || !node || typeof node !== "object") return false;
    for (const [key, value] of Object.entries(node).slice(0, 50)) {
      if (["code", "type", "reason"].includes(key.toLowerCase())) {
        const normalized = String(value || "").trim().toLowerCase();
        if (STRUCTURED_QUOTA_EXHAUSTION_CODES.has(normalized)) return true;
      }
      if (visit(value, depth + 1)) return true;
    }
    return false;
  };
  return visit(root, 0);
}

function durationResetFromText(text, now, maxDelayMs) {
  if (typeof text !== "string" || text.length > 64 * 1024) return null;
  const unitMs = {
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    h: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    m: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    s: 1000,
    second: 1000,
    seconds: 1000,
  };
  const deadlines = new Set();
  const clausePattern = /\b(?:retry|retrying|reset|resets|resetting)\b[^\r\n]{0,32}?\b(?:in|after)\s+((?:\d{1,6}\s*(?:weeks?|days?|hours?|minutes?|seconds?|[wdhms])\s*){1,6})/gi;
  for (const clause of text.matchAll(clausePattern)) {
    let duration = 0;
    let matches = 0;
    for (const match of clause[1].matchAll(/(\d{1,6})\s*(weeks?|days?|hours?|minutes?|seconds?|[wdhms])/gi)) {
      const amount = Number(match[1]);
      const factor = unitMs[match[2].toLowerCase()];
      if (!Number.isSafeInteger(amount) || !factor) continue;
      duration += amount * factor;
      matches += 1;
      if (!Number.isSafeInteger(duration) || duration > maxDelayMs) return null;
    }
    if (matches > 0 && duration > 0) deadlines.add(now + duration);
  }
  return deadlines.size === 1 ? [...deadlines][0] : null;
}

/**
 * Reduce a 429 response to bounded, non-secret evidence. Raw headers and body
 * are consumed only for parsing and never appear in the returned object.
 */
export function parseRateLimitEvidence({
  status,
  headers = null,
  bodyText = "",
  executorResetAtMs = null,
  now = Date.now(),
  maxDelayMs = MAX_RATE_LIMIT_COOLDOWN_MS,
} = {}) {
  if (Number(status) !== 429) return null;
  const clock = Number(now);
  const safeNow = Number.isFinite(clock) ? clock : Date.now();
  const explicitQuota = EXPLICIT_QUOTA_TEXT.test(String(bodyText || ""))
    || hasStructuredQuotaExhaustion(bodyText);

  let resetAtMs = boundedAbsoluteReset(executorResetAtMs, safeNow, maxDelayMs);
  let source = resetAtMs ? "executor" : null;
  if (!resetAtMs) {
    resetAtMs = retryAfterReset(headers?.get?.("retry-after"), safeNow, maxDelayMs);
    if (resetAtMs) source = "retry_after";
  }
  if (!resetAtMs) {
    const headerDeadlines = RESET_HEADERS
      .map((header) => {
        const value = headers?.get?.(header);
        return absoluteFromEpoch(value, safeNow, maxDelayMs) || durationHeaderReset(value, safeNow, maxDelayMs);
      })
      .filter(Number.isFinite)
      .sort((left, right) => right - left);
    resetAtMs = headerDeadlines[0] || null;
    if (resetAtMs) source = "reset_header";
  }
  if (!resetAtMs && typeof bodyText === "string" && bodyText.length <= 64 * 1024) {
    try {
      resetAtMs = findJsonReset(JSON.parse(bodyText), safeNow, maxDelayMs);
      if (resetAtMs) source = "structured_body";
    } catch { /* non-JSON provider body */ }
  }
  if (!resetAtMs) {
    resetAtMs = durationResetFromText(bodyText, safeNow, maxDelayMs);
    if (resetAtMs) source = "quota_text";
  }

  return {
    state: explicitQuota ? "exhausted" : "cooldown",
    resetAtMs,
    source: source || "local_policy",
  };
}

/**
 * Parse upstream provider error response
 * @param {Response} response - Fetch response from provider
 * @param {object} [executor] - Optional executor with parseError() override for provider-specific parsing
 * @returns {Promise<{statusCode: number, message: string, resetsAtMs?: number}>}
 */
export async function readBoundedResponseText(response, {
  signal = null,
  maxBytes = 64 * 1024,
  timeoutMs = 2_000,
  throwOnTimeout = false,
} = {}) {
  const timeoutFailure = () => {
    const error = new Error("Provider response body timed out");
    error.name = "TimeoutError";
    return error;
  };
  const abortFailure = () => signal?.reason instanceof Error && signal.reason.name === "AbortError"
    ? signal.reason
    : new DOMException("Request aborted", "AbortError");
  if (signal?.aborted) throw abortFailure();
  const reader = response?.body?.getReader?.();
  if (!reader) {
    const readCompatibilityBody = typeof response?.text === "function"
      ? () => response.text()
      : typeof response?.json === "function"
        ? async () => JSON.stringify(await response.json())
        : null;
    if (!readCompatibilityBody) return "";
    let timeout = null;
    let onAbort = null;
    const timeoutPromise = new Promise((resolve) => {
      timeout = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    });
    const abortPromise = signal
      ? new Promise((_, reject) => {
          onAbort = () => reject(abortFailure());
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        })
      : new Promise(() => {});
    try {
      const result = await Promise.race([
        Promise.resolve().then(readCompatibilityBody).then((text) => ({ text })),
        timeoutPromise,
        abortPromise,
      ]);
      if (signal?.aborted) throw abortFailure();
      if (result?.timedOut) {
        if (throwOnTimeout) throw timeoutFailure();
        return "";
      }
      if (typeof result?.text !== "string") return "";
      return new TextEncoder().encode(result.text).byteLength <= maxBytes ? result.text : "";
    } finally {
      if (timeout) clearTimeout(timeout);
      if (onAbort) signal?.removeEventListener?.("abort", onAbort);
    }
  }
  const chunks = [];
  let total = 0;
  let timeout = null;
  let onAbort = null;
  const timeoutPromise = new Promise((resolve) => {
    timeout = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  const abortPromise = signal
    ? new Promise((_, reject) => {
        onAbort = () => {
          reject(abortFailure());
          void reader.cancel("provider error body aborted").catch(() => {});
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      })
    : new Promise(() => {});
  try {
    while (true) {
      const result = await Promise.race([reader.read(), timeoutPromise, abortPromise]);
      if (signal?.aborted) throw abortFailure();
      if (result?.timedOut) {
        void reader.cancel("provider error body timeout").catch(() => {});
        if (throwOnTimeout) throw timeoutFailure();
        return "";
      }
      if (result.done) break;
      const value = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value || []);
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel("provider error body exceeds limit").catch(() => {});
        return "";
      }
      chunks.push(value);
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(joined);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (onAbort) signal?.removeEventListener?.("abort", onAbort);
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

export async function parseUpstreamError(response, executor = null, options = {}) {
  let bodyText = "";
  try {
    bodyText = await readBoundedResponseText(response, options);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    bodyText = "";
  }

  // Let executor-specific parser extract provider-specific fields (e.g. codex resetsAtMs)
  let executorParsed = null;
  if (executor && typeof executor.parseError === "function") {
    try {
      const parsed = executor.parseError(response, bodyText);
      if (parsed && typeof parsed === "object") {
        executorParsed = parsed;
      }
    } catch { /* fall through to default parsing */ }
  }

  const effectiveStatus = executorParsed?.status || response.status;
  const rateLimitEvidence = parseRateLimitEvidence({
    status: effectiveStatus,
    headers: response.headers,
    bodyText,
    executorResetAtMs: executorParsed?.resetsAtMs,
    now: options?.now ?? Date.now(),
  });
  if (executorParsed) {
    const parsedMessage = executorParsed.message || DEFAULT_ERROR_MESSAGES[effectiveStatus] || `Upstream error: ${effectiveStatus}`;
    // A 429 evidence object is the bounded authority, including an intentional
    // null reset. Falling back on null would resurrect a rejected raw executor
    // deadline and let downstream compatibility code turn it into a long lock.
    const normalizedResetAtMs = rateLimitEvidence
      ? rateLimitEvidence.resetAtMs
      : executorParsed.resetsAtMs;
    return {
      statusCode: effectiveStatus,
      // A raw 429 body can contain request/account material. The client gets a
      // stable wire-compatible message while the bounded evidence travels out
      // of band for fallback state.
      message: effectiveStatus === 429 ? DEFAULT_ERROR_MESSAGES[429] : sanitizeErrorMessage(parsedMessage),
      resetsAtMs: normalizedResetAtMs,
      errorBody: effectiveStatus === 429 ? undefined : executorParsed.errorBody,
      rateLimitEvidence,
    };
  }

  let message = "";
  try {
    const json = JSON.parse(bodyText);
    // ClinePass wraps failures as {success:false, error}; surface the inner
    // message instead of the wrapper. Source: decolua/9router#2332 @ 005d970f49.
    const { error: envError } = unwrapClinepassEnvelope(json, executor?.getProvider?.() || executor?.provider);
    if (envError) {
      message = envError.message;
    } else {
      message = json.error?.message || json.message || json.error || bodyText;
    }
  } catch {
    message = bodyText;
  }

  const messageStr = typeof message === "string" ? message : JSON.stringify(message);
  const finalMessage = messageStr || DEFAULT_ERROR_MESSAGES[response.status] || `Upstream error: ${response.status}`;

  return {
    statusCode: response.status,
    message: response.status === 429 ? DEFAULT_ERROR_MESSAGES[429] : sanitizeErrorMessage(finalMessage),
    resetsAtMs: rateLimitEvidence?.resetAtMs,
    rateLimitEvidence,
  };
}

/**
 * Create error result for chatCore handler
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {number} [resetsAtMs] - Optional precise cooldown expiry (ms epoch) for provider-specific quota errors
 * @returns {{ success: false, status: number, error: string, response: Response, resetsAtMs?: number }}
 */
export function createErrorResult(statusCode, message, resetsAtMs, errorBody, rateLimitEvidence = null) {
  // A caller-supplied structured errorBody bypasses buildErrorBody (its
  // provider-shaped type/code/details must be preserved, not rebuilt), so
  // sanitize its message field on a shallow clone instead — the caller's
  // object is never mutated (OmniRoute #6886).
  const safeBody =
    errorBody && typeof errorBody.error?.message === "string"
      ? { ...errorBody, error: { ...errorBody.error, message: sanitizeErrorMessage(errorBody.error.message) } }
      : errorBody;
  return {
    success: false,
    status: statusCode,
    error: message,
    resetsAtMs,
    ...(rateLimitEvidence ? { rateLimitEvidence } : {}),
    response: safeBody
      ? new Response(JSON.stringify(safeBody), {
          status: statusCode,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        })
      : errorResponse(statusCode, message),
  };
}

/**
 * Create unavailable response when all accounts are rate limited
 * @param {number} statusCode - Original error status code
 * @param {string} message - Error message (without retry info)
 * @param {string} retryAfter - ISO timestamp when earliest account becomes available
 * @param {string} retryAfterHuman - Human-readable retry info e.g. "reset after 30s"
 * @returns {Response}
 */
export function unavailableResponse(statusCode, message, retryAfter, retryAfterHuman) {
  const retryAfterMs = new Date(retryAfter).getTime();
  const hasRetryDeadline = Number.isFinite(retryAfterMs) && retryAfterMs > Date.now();
  const retryAfterSec = hasRetryDeadline
    ? Math.max(Math.ceil((retryAfterMs - Date.now()) / 1000), 1)
    : null;
  // Sanitize at this shared builder too (OmniRoute #6886) — unavailableResponse
  // bypasses buildErrorBody. The human retry suffix is appended after
  // sanitizing the base message so it survives verbatim.
  const msg = `${sanitizeErrorMessage(message)}${retryAfterHuman ? ` (${retryAfterHuman})` : ""}`;
  const error = { message: msg };
  // #6523: for 429 rate-limit responses, surface the OpenAI-shaped type/code
  // and an ISO `retry_after` timestamp so SDKs can back off deterministically.
  // Kept alongside the `Retry-After` seconds header (RFC 7231) — some clients
  // read one, some the other. Only emitted for 429; other statuses keep the
  // legacy minimal envelope to avoid changing existing call-site contracts.
  if (statusCode === 429) {
    error.type = "rate_limit_error";
    error.code = "rate_limit_exceeded";
    if (hasRetryDeadline) {
      error.retry_after = new Date(retryAfterMs).toISOString();
    }
  }
  const headers = { "Content-Type": "application/json" };
  if (retryAfterSec !== null) headers["Retry-After"] = String(retryAfterSec);
  return new Response(
    JSON.stringify({ error }),
    {
      status: statusCode,
      headers,
    }
  );
}

/**
 * Format provider error with context
 * @param {Error} error - Original error
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {number|string} statusCode - HTTP status code or error code
 * @returns {string} Formatted error message
 */
export function formatProviderError(error, provider, model, statusCode) {
  const code = statusCode || error.code || "FETCH_FAILED";
  const message = sanitizeErrorMessage(error.message || "Unknown error");
  // Expose low-level cause (e.g. UND_ERR_SOCKET, ECONNRESET, ETIMEDOUT) for diagnosing fetch failures
  const causeCode = error.cause?.code;
  const causeMsg = error.cause?.message ? sanitizeErrorMessage(error.cause.message) : null;
  const safeCauseCode = typeof causeCode === "string" && /^[A-Z0-9_]{1,64}$/.test(causeCode) ? causeCode : null;
  const causeStr = safeCauseCode || causeMsg ? ` (cause: ${[safeCauseCode, causeMsg].filter(Boolean).join(": ")})` : "";
  return `[${code}]: ${message}${causeStr}`;
}

// Source extensions whose absolute paths are masked (upstream OmniRoute #6886
// looksLikeAbsolutePath). Whitespace-tokenized instead of one regex so a safe
// URL like `https://cdn/app.js` (token has a scheme, not an absolute-path head)
// survives unchanged and CodeQL js/polynomial-redos stays clean.
const SOURCE_EXT = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];

function looksLikeAbsolutePath(tok) {
  if (tok.length < 4 || tok.length > 2048) return false;
  const isPosix = tok.charCodeAt(0) === 0x2f; // '/'
  const isWindows = tok.length > 2 && tok.charCodeAt(1) === 0x3a && /[A-Za-z]/.test(tok[0]);
  if (!isPosix && !isWindows) return false;
  const dot = tok.lastIndexOf(".");
  if (dot <= 0 || dot === tok.length - 1) return false;
  // Strip a parenthesized line/col suffix (`app.ts(10,5)`) before the colon
  // form so the extension check sees `ts`, not `ts(10,5` (Codex P2).
  const ext = tok.slice(dot + 1).replace(/\(.*$/, "").split(":", 1)[0].toLowerCase();
  return SOURCE_EXT.includes(ext);
}

function maskSourcePaths(line) {
  // Split on captured separators to preserve original whitespace. Stack frames
  // wrap paths in `("...")` and JSON/key-value bodies wrap them in
  // `"key":"value"` — strip those wrappers for the detection test, then
  // replace the WHOLE token so no path fragment survives adjacent to
  // punctuation (Codex P2: `{"path":"/opt/app.ts"}` must still mask).
  const parts = line.split(/(\s+)/);
  for (let i = 0; i < parts.length; i++) {
    const core = parts[i].replace(/^[("'{]+|[)"',.;:}]+$/g, "").replace(/^[A-Za-z0-9_-]+":"/, "");
    if (core && looksLikeAbsolutePath(core)) parts[i] = "<path>";
  }
  return parts.join("");
}

/**
 * Keep provider- and API-facing error messages useful without leaking stack
 * traces, credentials, or local absolute paths.
 *
 * Contract (OmniRoute #6886 "Rule 12" port):
 * - Stack tail: only the FIRST line survives (stack frames live on later lines).
 * - Absolute source paths: POSIX (`/home/u/x.ts`, `/opt/app/src/db.js:88:12`, …)
 *   and Windows (`C:\\Users\\u\\app.ts`, `D:/proj/a.mjs:10`) whitespace-delimited
 *   tokens whose final extension is a source extension (ts/tsx/js/jsx/mjs/cjs)
 *   become `<path>`. Separately, the legacy rule masks anything under
 *   `/Users|/home|/var|/tmp` (and `file://` URLs) as `[path]`. URLs with a
 *   scheme (`https://cdn/app.js`) are NOT source-path-masked.
 * - Secrets: URL userinfo, Bearer tokens, JSON credential fields, `key: value`
 *   pairs, and query-param credentials become `[redacted]`.
 * - Safe messages (no stack/path/secret) pass through UNCHANGED.
 * - Output is capped at 4096 chars (pathological-input guard).
 * @param {string} message
 * @returns {string}
 */
export function sanitizeErrorMessage(message) {
  // Cap BEFORE tokenization (upstream MAX_ERROR_LEN) so a pathological
  // multi-MB single-line message cannot stall the whitespace-token walker.
  // When the cap actually cut the message, a credential tail can lose the
  // closing delimiter its redactor needs (`"...@`, `"..."`) — redact such an
  // incomplete tail too, but ONLY in the truncated form so a safe terminal
  // URL (`https://api.example.com`) or ordinary text is untouched otherwise
  // (Codex P1 on OmniRoute #6886).
  const full = String(message || "Upstream provider error");
  // The incomplete-tail rules below apply only when the 4096 cap cut the
  // FIRST line itself (a long single-line credential). If the excess length
  // lives in later stack lines, the first line ended normally and its
  // delimiters are intact — tail redaction would be a false positive.
  const raw = full.slice(0, 4096);
  const firstLineCut = full.length > 4096 && !raw.includes("\n") && !raw.includes("\r");
  const firstLine = raw.split(/\r?\n/)[0].trim();
  let out = maskSourcePaths(firstLine)
    .replace(/\b(https?|socks5h?):\/\/[^@\s/]+@/gi, "$1://[redacted]@")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk[-_][A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{12,}|ya29\.[A-Za-z0-9._-]{12,}|AIza[A-Za-z0-9_-]{20,})\b/gi, "[redacted]")
    .replace(
      /("(?:access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|ctoken|token|x[-_]?api[-_]?key|api[-_]?key|key|auth|authorization|authorization[-_]?code|oauth[-_]?code|code[-_]?verifier|oauth[-_]?state|proxy[-_]?authorization|cookie|set[-_]?cookie|secret|client[-_]?secret|password|private[-_]?key|signature|sig)"\s*:\s*")[^"]*"/gi,
      '$1[redacted]"',
    )
    .replace(/([A-Za-z0-9_-]*(?:auth(?:orization)?|cookie|token|key|secret|signature|password|credential)[A-Za-z0-9_-]*\s*:\s*)[^\r\n]+/gi, "$1[redacted]")
    .replace(
      /((?:[?&;#]\s*|^)(?:access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|ctoken|token|x[-_]?api[-_]?key|api[-_]?key|key|auth|authorization|authorization[-_]?code|oauth[-_]?code|code|code[-_]?verifier|state|oauth[-_]?state|cookie|secret|client[-_]?secret|password|private[-_]?key|signature|sig)=)[^&;\s]+/gi,
      "$1[redacted]",
    )
    .replace(/file:\/\/\S+/g, "[path]")
    .replace(/\/(?:Users|home|var|tmp)\/\S+/g, "[path]");
  if (firstLineCut) {
    // The 4096 cut may have removed a credential's closing delimiter, leaving
    // an unredacted secret prefix at the end of the capped text. Redact an
    // incomplete JSON credential tail and an incomplete URL userinfo tail
    // (`user:secret` shape, no `@`; a purely numeric second segment is a
    // port, not a password) — anchored to the end so complete,
    // delimiter-closed forms above are never double-touched (Codex P1).
    out = out
      .replace(
        /("(?:access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|ctoken|token|x[-_]?api[-_]?key|api[-_]?key|key|auth|authorization|authorization[-_]?code|oauth[-_]?code|code[-_]?verifier|oauth[-_]?state|proxy[-_]?authorization|cookie|set[-_]?cookie|secret|client[-_]?secret|password|private[-_]?key|signature|sig)"\s*:\s*")[^"]+$/i,
        '$1[redacted]"',
      )
      .replace(/\b(https?|socks5h?):\/\/[^@\s/:]+:(?![0-9]+$)[^@\s/]+$/i, "$1://[redacted]@");
  }
  return out.slice(0, 4096) || "Upstream provider error";
}
