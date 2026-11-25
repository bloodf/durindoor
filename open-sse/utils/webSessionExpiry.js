/**
 * Local helpers for manually pasted web-session bearer tokens (Copilot Web and
 * Microsoft 365 Copilot Web). Nothing here talks to a provider: a token that
 * is a JWT with a past `exp` claim is reported as expired before any request,
 * and a WebSocket upgrade rejection (`Unexpected server response: 401`) is
 * mapped back to its HTTP status so the gateway flags the credential instead
 * of treating the failure as a transient 502.
 */
import { isNumber, isString } from "../../src/shared/utils/typeChecks.js";

/** Expiry of a JWT access token in epoch milliseconds, or null when not a JWT or no numeric `exp`. */
export function jwtExpiryMs(token) {
  if (!isString(token)) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return isNumber(payload?.exp) && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** True only for a JWT whose `exp` has passed. Opaque tokens are never judged locally. */
export function isExpiredSessionToken(token, now = Date.now()) {
  const expiry = jwtExpiryMs(token);
  return expiry !== null && expiry <= now;
}

/** HTTP status carried by a `ws` upgrade rejection, limited to 401 and 403; otherwise undefined. */
export function webSocketAuthStatus(error) {
  const message = isString(error) ? error : error?.message;
  const match = isString(message) ? message.match(/Unexpected server response:\s*(401|403)\b/) : null;
  return match ? Number(match[1]) : undefined;
}
