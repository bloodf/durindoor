/**
 * Gateway-measured generation throughput (tokens/sec), ported from OmniRoute #12631.
 *
 * tok/s MUST exclude TTFT: `output_tokens / total_latency` counts queueing and
 * first-token wait, which is not generation speed. When TTFT is unknown
 * (typical non-streaming JSON, where the whole body arrives at once), omit
 * the field rather than guessing.
 */
import { isObject, isNumber, isString } from "../../src/shared/utils/typeChecks.js";

/**
 * @param {number} totalMs - Total request latency in ms.
 * @param {number|null|undefined} ttftMs - Time to first token in ms, or null/undefined when unknown.
 * @returns {number|null} Generation-only duration in ms, or null when not computable.
 */
export function generationDurationMs(totalMs, ttftMs) {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return null;
  if (ttftMs == null || !Number.isFinite(ttftMs) || ttftMs < 0) return null;
  const generationMs = totalMs - ttftMs;
  return generationMs > 0 ? generationMs : null;
}

/**
 * @param {number} outputTokens
 * @param {number|null|undefined} generationMs - Duration returned by generationDurationMs.
 * @returns {number|null}
 */
export function tokensPerSecond(outputTokens, generationMs) {
  if (generationMs == null || !Number.isFinite(generationMs) || generationMs <= 0) return null;
  if (!Number.isFinite(outputTokens) || outputTokens <= 0) return null;
  return outputTokens / (generationMs / 1000);
}

function outputTokenCount(usage) {
  const raw =
    usage.completion_tokens ??
    usage.output_tokens ??
    usage.candidatesTokenCount ??
    usage.outputTokens ??
    usage.completionTokens;
  const n = isNumber(raw) ? raw : isString(raw) ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Attach `tokens_per_second` when generation duration (excluding TTFT) is known.
 * No-op (returns usage unchanged) when generationMs is not computable.
 * @param {object} usage
 * @param {number|null|undefined} generationMs
 * @returns {object}
 */
export function attachTokensPerSecond(usage, generationMs) {
  if (!usage || !isObject(usage) || Array.isArray(usage)) return usage;
  const tps = tokensPerSecond(outputTokenCount(usage), generationMs);
  if (tps == null) return usage;
  return { ...usage, tokens_per_second: Number(tps.toFixed(3)) };
}
