/**
 * Kiro AWS EventStream terminal classification.
 *
 * Adapted from OmniRoute #19723 (cheaper-inference/OmniRoute, MIT): the exception
 * status table and the max-token / content-filter / malformed stop mapping. The
 * missing-messageStopEvent rule stays DurinDoor's: an accounting frame alone is
 * never a successful completion.
 *
 * Stop reasons are compared lowercased. Bedrock-style lowercase values
 * (`max_tokens`, `content_filtered`) and uppercase values (`MAX_TOKENS`) mean the
 * same stop.
 */
import { OPENAI_FINISH } from "../translator/schema/finishReasons.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const TRUNCATION_STOPS = new Set(["max_tokens", "model_context_window_exceeded"]);
const CONTENT_FILTER_STOPS = new Set(["content_filtered", "guardrail_intervened"]);

// OpenAI error types the gateway already understands. A 400 is request-scoped:
// every account would reject it, so the gateway does not try a sibling.
const ERROR_TYPE_BY_STATUS = {
  400: "invalid_request_error",
  401: "authentication_error",
  403: "permission_error",
  429: "rate_limit_error"
};

/**
 * HTTP status for an AWS exception frame inside a 200 EventStream body.
 * Unknown names stay 502, so failover still runs.
 * @param {string} name `:exception-type` / `:error-code` header value
 * @returns {number}
 */
export function kiroExceptionStatus(name) {
  const value = isString(name) ? name : "";
  if (/Throttling|ServiceQuotaExceeded/i.test(value)) return 429;
  if (/Unauthorized/i.test(value)) return 401;
  if (/AccessDenied/i.test(value)) return 403;
  if (/Validation|InvalidModel/i.test(value)) return 400;
  if (/ResourceNotFound/i.test(value)) return 404;
  if (/Conflict/i.test(value)) return 409;
  return 502;
}

/**
 * In-band OpenAI error frame payload. The message is fixed text: provider
 * exception messages never reach the client. `status` is the field the buffered
 * SSE-to-JSON path reads for the HTTP status; `status_code` matches the in-band
 * frames built by earlyStreamKeepalive.
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
export function kiroStreamFailure(status, code, message) {
  return {
    error: {
      message,
      type: ERROR_TYPE_BY_STATUS[status] || "server_error",
      code,
      status,
      status_code: status
    }
  };
}

/** @returns {string|null} lowercased stop reason, or null when absent */
export function normalizeKiroStopReason(value) {
  return isString(value) && value.trim() ? value.trim().toLowerCase() : null;
}

/** `malformed_tool_use` / `malformed_model_output`: the turn failed, it did not finish. */
export function isKiroMalformedStop(stopReason) {
  return isString(stopReason) && stopReason.startsWith("malformed");
}

/**
 * OpenAI finish_reason for a completed Kiro turn. Tool calls keep precedence.
 * A truncation stop maps to `length` only after output was emitted.
 * @param {string|null} stopReason normalized stop reason
 * @param {{hasToolCalls: boolean, emittedOutput: boolean}} state
 */
export function kiroFinishReason(stopReason, { hasToolCalls, emittedOutput }) {
  if (hasToolCalls) return OPENAI_FINISH.TOOL_CALLS;
  if (TRUNCATION_STOPS.has(stopReason) && emittedOutput) return OPENAI_FINISH.LENGTH;
  if (CONTENT_FILTER_STOPS.has(stopReason)) return OPENAI_FINISH.CONTENT_FILTER;
  return OPENAI_FINISH.STOP;
}
