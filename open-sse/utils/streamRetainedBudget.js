// Per-stream cap on the text the response translators keep while a stream is open
// (tool-call arguments and names, reasoning text, thinking signatures). One SSE
// line is already capped (pendingSseLine.js), but these buffers grow across lines,
// so many small frames could otherwise exhaust process memory. Port of
// OmniRoute #21176. Sizes are string lengths (UTF-16 code units).
export const DEFAULT_MAX_STREAM_RETAINED_BYTES = 64 * 1024 * 1024;

const budgets = new WeakMap();

/** STREAM_MAX_RETAINED_BYTES overrides the 64 MiB default; 0 turns the cap off. */
function maxRetainedBytes() {
  const raw = process.env.STREAM_MAX_RETAINED_BYTES?.trim();
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MAX_STREAM_RETAINED_BYTES;
  return parsed === 0 ? Infinity : Math.floor(parsed);
}

/**
 * Reserve `length` more retained units for the stream that owns `state`. Call it
 * before keeping the fragment. Past the cap it throws `invalid_sse_payload`, the
 * same failure as an oversized SSE line, so no caller can silently truncate.
 */
export function chargeRetained(state, length) {
  if (!(length > 0)) return;
  let budget = budgets.get(state);
  if (!budget) budgets.set(state, budget = { used: 0, max: maxRetainedBytes() });
  if (budget.used + length > budget.max) {
    // `used` is left unchanged: any later fragment of this size throws again.
    const error = new Error("Upstream stream exceeded the retained size limit");
    error.code = "invalid_sse_payload";
    throw error;
  }
  budget.used += length;
}
