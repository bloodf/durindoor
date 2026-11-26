import { sanitizeErrorMessage } from "../utils/error.js";
import { CURSOR_MODEL_UNAVAILABLE_MESSAGE } from "../config/errorConfig.js";

export const CURSOR_EMPTY_TURN_EVENT = "Cursor AgentService returned an empty turn";

/** Classify Cursor Connect and transport failures without exposing credentials or local paths. */
export function classifyCursorError(raw) {
  const value = String(raw || "");
  // Scoped to this connection and model: a 404, never an upstream 5xx (OmniRoute #19972).
  if (value === CURSOR_EMPTY_TURN_EVENT) {
    return { kind: "not_found", status: 404, type: "not_found_error", message: `${CURSOR_MODEL_UNAVAILABLE_MESSAGE}: ${CURSOR_EMPTY_TURN_EVENT}` };
  }
  const text = value.toLowerCase();
  const quota = /too many requests|quota|rate[ -]limit|throttl|out of usage|increase limits|actionrequired/.test(text);
  const large = !quota && /tool catalog too large|tool registration too large|too many tools|message too large|payload too large|request too large|request exceeds .*size|request (?:body|size) exceeds .*(?:size|limit)|maximum allowed size/.test(text);
  const entitlement = /\S{1,100} is not included in your weekly usage\b/.test(text);
  let kind = "upstream";
  if (entitlement) kind = "not_found";
  else if (/resource[_ ]exhausted/.test(text)) kind = large ? "invalid" : "rate_limit";
  else if (quota || (text.includes("model not found") && text.includes("reset after"))) kind = "rate_limit";
  else if (/model not found|not_found/.test(text)) kind = "not_found";
  else if (/unauthenticated|unauthorized|permission.denied|forbidden|invalid token|expired token|authentication|access denied/.test(text)) kind = "auth";
  else if (/unavailable|overloaded|temporarily|server is busy/.test(text)) kind = "overload";
  else if (large || /invalid|not found|unsupported|malformed|unimplemented/.test(text)) kind = "invalid";
  else if (/timed out|timeout|etimedout|deadline/.test(text)) kind = "timeout";
  else if (/econnreset|econnrefused|goaway|nghttp2|socket hang up|connection reset/.test(text)) kind = "connection";
  const definitions = {
    rate_limit: [429, "rate_limit_error", "Cursor rate limit / usage exceeded"], auth: [401, "authentication_error", "Cursor authentication failed"],
    not_found: [404, "invalid_request_error", "Cursor model not found"], invalid: [400, "invalid_request_error", "Cursor invalid request"],
    overload: [502, "api_error", "Cursor server overloaded"], timeout: [502, "api_error", "Cursor request timed out"],
    connection: [502, "api_error", "Cursor connection failed"], upstream: [502, "api_error", "Cursor upstream error"],
  };
  const [status, type, prefix] = definitions[kind];
  const detail = sanitizeCursorErrorDetail(value);
  return { kind, status, type, message: detail.startsWith(prefix) ? detail : detail ? `${prefix}: ${detail}` : prefix };
}

export function sanitizeCursorErrorDetail(message) {
  return sanitizeErrorMessage(message).replace(/(?:\/Users\/[^ "';,]+|\/home\/[^ "';,]+|[A-Za-z]:\\Users\\[^ "';,]+)/g, "[REDACTED_PATH]")
    .replace(/\b(authorization|auth[_-]?token|cursor[_-]?token|bearer)=([^&\s"',;]+)/gi, "$1=[REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(/resource[_ ]exhausted/gi, "resource limit exceeded").slice(0, 500);
}
