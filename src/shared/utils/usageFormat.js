// Timing figures for the usage dashboard: turning summed latency into rates,
// and rendering those rates. Token and cost formatting already live in
// formatCompact.js and the usage tables; this module only covers what they did
// not have. The derivation is shared with the server aggregation in
// src/lib/db/repos/usageRepo.js so both sides divide the same way.

/**
 * Turn summed latency into the rates the dashboard shows. Throughput divides
 * output tokens by decode time (total minus time-to-first-token) so a slow
 * first token does not read as slow generation, and summing before dividing
 * weights long requests properly instead of averaging per-request rates.
 *
 * Each average divides by its own sample count, because rows recorded before
 * timing existed contribute tokens but no duration.
 *
 * @param {object} agg - Accumulator carrying latencyMs, ttftMs, the two sample counts and timedCompletionTokens
 * @returns {{avgDurationMs:number|null,avgTtftMs:number|null,avgTps:number|null}}
 */
export function deriveLatencyRates(agg = {}) {
  const latencyMs = agg.latencyMs || 0;
  const decodeMs = latencyMs - (agg.ttftMs || 0);
  const timedCompletionTokens = agg.timedCompletionTokens || 0;
  return {
    avgDurationMs: agg.latencySamples > 0 ? latencyMs / agg.latencySamples : null,
    avgTtftMs: agg.ttftSamples > 0 ? agg.ttftMs / agg.ttftSamples : null,
    avgTps: timedCompletionTokens > 0 && decodeMs > 0 ? timedCompletionTokens / (decodeMs / 1000) : null
  };
}

/** Em space is not used here: the dash marks "no sample", not a range. */
const NO_SAMPLE = "-";

/**
 * Duration across ms, seconds and minutes without losing the unit.
 *
 * @param {number|null|undefined} ms
 * @returns {string} Formatted duration, or "-" when there is nothing to show
 */
export function formatDurationMs(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return NO_SAMPLE;
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(1)} s`;
  const minutes = Math.floor(value / 60000);
  const seconds = Math.round(value % 60000 / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Generation throughput, measured against decode time by the caller. Precision
 * tightens as the rate grows so the digits stay meaningful.
 *
 * @param {number|null|undefined} tps - Tokens per second
 * @returns {string} Formatted rate, or "-" when there is no usable sample
 */
export function formatTps(tps) {
  const value = Number(tps);
  if (!Number.isFinite(value) || value <= 0) return NO_SAMPLE;
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
