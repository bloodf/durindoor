// Every message here is written by DurinDoor. Upstream bodies and transport
// error text are never copied, because they can echo credentials.
import { isRefusedRedirect } from "../sendRequest.js";

export class VeniceWebError extends Error {
  constructor(status, message, type = "upstream_error", code = `HTTP_${status}`, retryAfter = null) {
    super(message);
    this.name = "VeniceWebError";
    this.status = status;
    this.type = type;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export const invalidCredential = (message) => new VeniceWebError(401, message, "authentication_error", "invalid_credential");

export const expiredSession = () => new VeniceWebError(
  401,
  "Venice Web session expired or was rejected. Sign in at venice.ai and import the __client cookie again.",
  "authentication_error",
  "session_expired",
);

export const invalidRequest = (message) => new VeniceWebError(400, message, "invalid_request_error", "invalid_request");

export const malformedReply = (what) => new VeniceWebError(502, `Venice Web returned ${what}`, "upstream_error", "invalid_response");

export const isRedirect = (response) =>
  response.type === "opaqueredirect" || response.redirected === true || (response.status >= 300 && response.status < 400);

function retryAfterSeconds(response) {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * The failure for a rejected or redirected reply. `signIn` marks the two Clerk
 * requests, where a 403 also means the cookie was not accepted.
 */
export function httpFailure(response, stage, { signIn = false } = {}) {
  const { status } = response;
  if (isRedirect(response) || status === 401 || (signIn && status === 403)) return expiredSession();
  if (status === 403) {
    return new VeniceWebError(403, `Venice Web refused the ${stage} (HTTP 403). The session, account or model may not be allowed.`, "permission_error", "forbidden");
  }
  if (status === 429) {
    return new VeniceWebError(429, `Venice Web rate limit reached during the ${stage}. Try again later.`, "rate_limit_error", "rate_limited", retryAfterSeconds(response));
  }
  const safe = status >= 400 && status < 600 ? status : 502;
  return new VeniceWebError(safe, `Venice Web ${stage} failed (HTTP ${status})`);
}

export const isAbort = (error, signal) => signal?.aborted || error?.name === "AbortError";

/** A rejected send as a mapped failure; aborts pass through untouched. */
export function transportFailure(error, signal) {
  if (isAbort(error, signal)) return error;
  if (isRefusedRedirect(error)) return expiredSession();
  if (error?.name === "TimeoutError") return new VeniceWebError(504, "Venice Web request timed out");
  return new VeniceWebError(502, "Venice Web request failed: network error", "upstream_error", "network_error");
}
