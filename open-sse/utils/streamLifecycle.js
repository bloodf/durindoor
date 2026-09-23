/**
 * Local stream lifecycle classifier (ported from OmniRoute #7907/#7908).
 *
 * When the caller drops the connection mid-stream (combo race loser, model
 * switch, tab close) the in-flight leg surfaces a DOM `AbortError`, or a bare
 * error whose message is `request_signal_aborted` / "Client disconnected" /
 * "operation was aborted" / "controller is already closed". These carry no
 * upstream status, so they default to HTTP 502 and would otherwise be counted
 * as provider failures — cooling down the serving connection and marking a
 * healthy account unavailable from a client-side cancellation alone.
 *
 * Treat them as local lifecycle events: the cooldown / fallback accrual must
 * skip them. Genuine upstream failures (5xx/429/401) still count.
 */
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
export function isLocalStreamLifecycleError(error) {
  if (!error) return false;
  const name = isString(error?.name) ? error.name : "";
  if (name === "AbortError") return true;
  const message =
  isString(error) ?
  error :
  isString(error?.message) ?
  error.message :
  "";
  if (!message) return false;
  return (
    /controller is already closed/i.test(message) ||
    /request_signal_aborted/i.test(message) ||
    /client disconnected/i.test(message) ||
    /operation was aborted/i.test(message));

}
/**
 * Stream abandon reason for request logs (ported from OmniRoute #14582).
 *
 * Tells a content stall (the watchdog saw no upstream bytes for the stall or
 * first-token window) apart from a severed transport (undici reports a dropped
 * socket as "terminated"). Anything else stays the generic "stream_error".
 *
 * @param {unknown} error
 * @returns {"stall_timeout"|"ttft_timeout"|"stream_terminated"|"stream_error"}
 */
export function classifyStreamAbandonReason(error) {
  const message = isString(error) ? error : isString(error?.message) ? error.message : "";
  const lower = message.toLowerCase();
  if (lower.startsWith("stream stall timeout")) return "stall_timeout";
  if (lower.startsWith("stream ttft timeout")) return "ttft_timeout";
  if (/\bterminated\b/.test(lower)) return "stream_terminated";
  return "stream_error";
}

const REQUEST_SCOPED_STREAM_ERROR_IDS = new Set([
  "invalid_request_error",
  "context_length_exceeded",
  "context_window_exceeded"
]);

/**
 * Pull the error envelope out of one parsed SSE payload, or null when the
 * frame is not an error. Covers OpenAI `{error}`, Anthropic `{type:"error"}`
 * and Responses `response.failed` / `error` events.
 *
 * @param {unknown} parsed
 * @returns {{type?: string, code?: string, message?: string}|null}
 */
export function extractStreamErrorPayload(parsed) {
  if (!parsed || !isObject(parsed)) return null;
  const raw =
  parsed.type === "response.failed" ? parsed.response?.error :
  parsed.error ?? (parsed.type === "error" ? parsed : null);
  if (!raw) return null;
  if (isString(raw)) return { message: raw };
  if (!isObject(raw)) return null;
  const pick = (value) => isString(value) && value.trim() ? value.trim() : undefined;
  return { type: pick(raw.type), code: pick(raw.code), message: pick(raw.message) };
}

/**
 * Whether an in-stream upstream error belongs to the request, not to the
 * account (ported from OmniRoute #14585). A malformed request or an
 * over-long context is rejected the same way by every connection, so it must
 * not cool down the serving account or trigger a sibling-connection retry.
 *
 * @param {{type?: string, code?: string}|null|undefined} error
 * @returns {boolean}
 */
export function isRequestScopedStreamError(error) {
  if (!error || !isObject(error)) return false;
  const type = isString(error.type) ? error.type.toLowerCase() : "";
  const code = isString(error.code) ? error.code.toLowerCase() : "";
  return REQUEST_SCOPED_STREAM_ERROR_IDS.has(type) || REQUEST_SCOPED_STREAM_ERROR_IDS.has(code);
}
