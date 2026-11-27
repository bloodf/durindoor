/**
 * Kiro upstream failure classification. Web-safe: no Node built-ins, no I/O.
 *
 * Source: OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523 (MIT),
 * open-sse/services/tokenRefresh/providers/kiro.ts:54-66, :126-146, :257-273.
 * AWS SSO OIDC reports `{"__type": "InvalidGrantException"}`; Microsoft and
 * other OAuth2 IdPs report `{"error": "invalid_grant"}`. Those codes mean the
 * stored grant is dead and only re-authentication helps.
 */

import { isObject, isString } from "../../shared/utils/typeChecks.js";

const UNRECOVERABLE_CODES = new Set([
  "InvalidGrantException",
  "ExpiredTokenException",
  "invalid_grant",
  "invalid_client"
]);

// Only protocol error identifiers may leave the service. An arbitrary short
// identifier can itself be a credential; syntax validation alone cannot redact it.
const SAFE_CODES = new Set([
  ...UNRECOVERABLE_CODES,
  "invalid_client_metadata",
  "invalid_request",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
  "access_denied",
  "authorization_pending",
  "slow_down",
  "expired_token",
  "server_error",
  "temporarily_unavailable"
]);

/**
 * Reduce an upstream error body to a safe, stable code. The body itself is
 * never returned, so upstream text cannot reach a client response or log.
 * @param {string} bodyText
 * @returns {{ code: string|null, unrecoverable: boolean }}
 */
export function classifyKiroUpstreamFailure(bodyText) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(bodyText || ""));
  } catch {
    parsed = null;
  }
  const raw = parsed !== null && isObject(parsed) ? parsed.__type ?? parsed.error : null;
  // AWS JSON-1.0 can namespace the type: "com.amazon...#InvalidGrantException".
  const tail = isString(raw) ? raw.split("#").pop().trim() : "";
  const code = SAFE_CODES.has(tail) ? tail : null;
  return { code, unrecoverable: code !== null && UNRECOVERABLE_CODES.has(code) };
}

/**
 * Build an Error for a failed upstream response without its body.
 * @param {string} prefix - caller-owned message prefix
 * @param {Response} response
 * @returns {Promise<Error & {status:number, code:string|null, unrecoverable:boolean}>}
 */
export async function kiroUpstreamError(prefix, response) {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }
  const { code, unrecoverable } = classifyKiroUpstreamFailure(bodyText);
  // Keep the existing generic 4xx message when no identifier is available.
  // Structured metadata still distinguishes a failed grant from a retryable error.
  const error = new Error(code || response.status >= 500 ? `${prefix}: HTTP ${response.status}${code ? ` (${code})` : ""}` : prefix);
  error.status = response.status;
  error.code = unrecoverable ? "unrecoverable_refresh_error" : code;
  error.upstreamCode = code;
  error.unrecoverable = unrecoverable;
  return error;
}
