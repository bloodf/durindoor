/** `/alpha/generate` rejects a larger `max_tokens` in its schema (decolua/9router#4691). */
export const COMMANDCODE_MAX_TOKENS = 200000;

/** Bounded CommandCode stream-prefix limits from upstream 9router PR #3405. */
export const COMMANDCODE_PREFLIGHT_MAX_BYTES = 64 * 1024;
export const COMMANDCODE_PREFLIGHT_MAX_FRAMES = 16;

export const COMMANDCODE_RATE_LIMIT_PATTERNS = Object.freeze([
  "rate limit",
  "too many requests",
]);

export const COMMANDCODE_OVERLOAD_PATTERNS = Object.freeze([
  "overload",
  "service unavailable",
  "temporarily unavailable",
]);
