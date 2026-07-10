import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../config/errorConfig.js";

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

  return {
    error: {
      message: message || DEFAULT_ERROR_MESSAGES[statusCode] || "An error occurred",
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

/**
 * Parse upstream provider error response
 * @param {Response} response - Fetch response from provider
 * @param {object} [executor] - Optional executor with parseError() override for provider-specific parsing
 * @returns {Promise<{statusCode: number, message: string, resetsAtMs?: number}>}
 */
export async function parseUpstreamError(response, executor = null) {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }

  // Let executor-specific parser extract provider-specific fields (e.g. codex resetsAtMs)
  if (executor && typeof executor.parseError === "function") {
    try {
      const parsed = executor.parseError(response, bodyText);
      if (parsed && typeof parsed === "object") {
        const msg = parsed.message || DEFAULT_ERROR_MESSAGES[response.status] || `Upstream error: ${response.status}`;
        return {
          statusCode: parsed.status || response.status,
          message: msg,
          resetsAtMs: parsed.resetsAtMs,
          errorBody: parsed.errorBody,
        };
      }
    } catch { /* fall through to default parsing */ }
  }

  let message = "";
  try {
    const json = JSON.parse(bodyText);
    message = json.error?.message || json.message || json.error || bodyText;
  } catch {
    message = bodyText;
  }

  const messageStr = typeof message === "string" ? message : JSON.stringify(message);
  const finalMessage = messageStr || DEFAULT_ERROR_MESSAGES[response.status] || `Upstream error: ${response.status}`;

  return { statusCode: response.status, message: finalMessage };
}

/**
 * Create error result for chatCore handler
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {number} [resetsAtMs] - Optional precise cooldown expiry (ms epoch) for provider-specific quota errors
 * @returns {{ success: false, status: number, error: string, response: Response, resetsAtMs?: number }}
 */
export function createErrorResult(statusCode, message, resetsAtMs, errorBody) {
  return {
    success: false,
    status: statusCode,
    error: message,
    resetsAtMs,
    response: errorBody
      ? new Response(JSON.stringify(errorBody), {
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
  const retryAfterSec = Math.max(Math.ceil((retryAfterMs - Date.now()) / 1000), 1);
  const msg = `${message} (${retryAfterHuman})`;
  const error = { message: msg };
  // #6523: for 429 rate-limit responses, surface the OpenAI-shaped type/code
  // and an ISO `retry_after` timestamp so SDKs can back off deterministically.
  // Kept alongside the `Retry-After` seconds header (RFC 7231) — some clients
  // read one, some the other. Only emitted for 429; other statuses keep the
  // legacy minimal envelope to avoid changing existing call-site contracts.
  if (statusCode === 429) {
    error.type = "rate_limit_error";
    error.code = "rate_limit_exceeded";
    if (Number.isFinite(retryAfterMs)) {
      error.retry_after = new Date(retryAfterMs).toISOString();
    }
  }
  return new Response(
    JSON.stringify({ error }),
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec)
      }
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
  const message = error.message || "Unknown error";
  // Expose low-level cause (e.g. UND_ERR_SOCKET, ECONNRESET, ETIMEDOUT) for diagnosing fetch failures
  const causeCode = error.cause?.code;
  const causeMsg = error.cause?.message;
  const causeStr = causeCode || causeMsg ? ` (cause: ${[causeCode, causeMsg].filter(Boolean).join(": ")})` : "";
  return `[${code}]: ${message}${causeStr}`;
}

/**
 * Keep provider-facing transport errors useful without leaking stack traces or
 * local paths from WebSocket exceptions.
 * @param {string} message
 * @returns {string}
 */
export function sanitizeErrorMessage(message) {
  const firstLine = String(message || "Upstream provider error").split(/\r?\n/)[0].trim();
  return firstLine
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /("(?:access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|ctoken|token|x[-_]?api[-_]?key|api[-_]?key|key|auth|authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|secret|client[-_]?secret|password|private[-_]?key|signature|sig)"\s*:\s*")[^"]*"/gi,
      '$1[redacted]"',
    )
    .replace(/([A-Za-z0-9_-]*(?:auth(?:orization)?|cookie|token|key|secret|signature|password|credential)[A-Za-z0-9_-]*\s*:\s*)[^\r\n]+/gi, "$1[redacted]")
    .replace(
      /((?:[?&;#]\s*|^)(?:access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|ctoken|token|x[-_]?api[-_]?key|api[-_]?key|key|auth|authorization|cookie|secret|client[-_]?secret|password|private[-_]?key|signature|sig)=)[^&;\s]+/gi,
      "$1[redacted]",
    )
    .replace(/file:\/\/\S+/g, "[path]")
    .replace(/\/(?:Users|home|var|tmp)\/\S+/g, "[path]")
    .slice(0, 500) || "Upstream provider error";
}
