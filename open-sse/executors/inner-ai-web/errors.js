/** A failure with a fixed, gateway-authored message. Upstream text is never copied into one. */
export class InnerAiWebError extends Error {
  constructor(status, message, type = "upstream_error", code = `HTTP_${status}`, retryAfter = null) {
    super(message);
    this.name = "InnerAiWebError";
    this.status = status;
    this.type = type;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export const expiredSession = () => new InnerAiWebError(
  401,
  "Inner.ai Web session expired or was rejected. Sign in at app.innerai.com and paste the new token cookie.",
  "authentication_error",
  "session_expired",
);

/** 401, 403 and any redirect (a sign-in bounce) all mean the session is no longer accepted. */
export const isSessionRejection = (status) => status === 401 || status === 403 || (status >= 300 && status < 400);

export const malformedReply = (what) => new InnerAiWebError(502, `Inner.ai Web returned ${what}`, "upstream_error", "invalid_response");

/** Map a non-2xx reply. */
export function httpFailure(response, what) {
  const { status } = response;
  if (isSessionRejection(status)) return expiredSession();
  if (status === 429) {
    const seconds = Number(response.headers?.get?.("retry-after"));
    return new InnerAiWebError(429, "Inner.ai Web rate limit reached", "rate_limit_error", "rate_limited",
      Number.isFinite(seconds) && seconds > 0 ? seconds : null);
  }
  return new InnerAiWebError(status >= 400 ? status : 502, `Inner.ai Web ${what} failed (HTTP ${status})`);
}
