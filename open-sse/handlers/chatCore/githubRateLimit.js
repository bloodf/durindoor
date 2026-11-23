/** Keep only bounded numeric rate-limit headers; never persist upstream text. */
export function githubRateLimit(headers, now = Date.now()) {
  const number = (name) => {
    const value = headers.get(name);
    if (!value || !/^\d{1,12}$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };
  const reset = number("x-ratelimit-reset");
  const retry = headers.get("retry-after");
  let resetMs = reset === null ? null : reset * 1000;
  if (resetMs === null && retry) {
    resetMs = /^\d{1,8}$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry);
  }
  if (!Number.isFinite(resetMs) || resetMs < 0 || resetMs > 8640000000000000) resetMs = null;
  return { limit: number("x-ratelimit-limit"), remaining: number("x-ratelimit-remaining"), resetAt: resetMs === null ? null : new Date(resetMs).toISOString(), lastSeenAt: new Date(now).toISOString() };
}
