import { USAGE_COST_FIELDS } from "../../../shared/utils/usageCostAllocation.js";

/**
 * Latency is summed everywhere and divided once, at the end. Rows written
 * before timing existed carry tokens but no duration, so counting their tokens
 * against other rows' time would invent throughput that never happened: carry
 * the sample counts so the daily rollup and the live query divide by the same
 * subset they multiplied.
 *
 * @param {object} target - Accumulator that gains the latency sums
 * @param {object} source - Row or bucket contributing latency
 * @param {number} [completionTokens=0] - Output tokens of `source`, used when it carries no `timedCompletionTokens`
 */
export function addLatency(target, source, completionTokens = 0) {
  const latencyMs = Number(source.latencyMs) || 0;
  const ttftMs = Number(source.ttftMs) || 0;
  // A stored sample count of 0 is a real measurement; only a missing one means
  // `source` is a single row whose own timing decides.
  const sampleOr = (value, fallback) => value === undefined || value === null ? fallback : Number(value) || 0;
  target.latencyMs = (target.latencyMs || 0) + latencyMs;
  target.ttftMs = (target.ttftMs || 0) + ttftMs;
  target.latencySamples = (target.latencySamples || 0) + sampleOr(source.latencySamples, latencyMs > 0 ? 1 : 0);
  target.ttftSamples = (target.ttftSamples || 0) + sampleOr(source.ttftSamples, ttftMs > 0 ? 1 : 0);
  // Tokens count toward throughput only when the row has decode time to divide
  // them by; a row whose whole duration is TTFT would otherwise add tokens for free.
  target.timedCompletionTokens = (target.timedCompletionTokens || 0) +
  sampleOr(source.timedCompletionTokens, latencyMs > ttftMs ? completionTokens : 0);
}

const UNSPLIT_FIELDS = ["promptTokens", "completionTokens", "cachedTokens", "reasoningTokens", "cacheCreationTokens", "cost"];

/**
 * Carry the per-rate cost split from `source` into `target`. Call it before
 * `source` is added to `target`'s token and cost counters.
 *
 * Usage rows store their split at insert, where each request's own tier is
 * known. Rows written before that, or whose cost the provider reported, have no
 * split; their tokens and cost collect in `target.unsplit` so the read path can
 * price that remainder separately, or decline to split it.
 *
 * @param {object} target - Dimension counter being accumulated
 * @param {object} source - Row, entry or counter with token counters and `cost`
 */
export function addCostSplit(target, source) {
  const hasSplit = source.inputCost !== undefined && source.inputCost !== null;
  // A counter summed before splits were stored holds only unsplit cost.
  if (hasSplit && target.inputCost === undefined && !target.unsplit && Number(target.cost) > 0) {
    target.unsplit = {};
    for (const field of UNSPLIT_FIELDS) target.unsplit[field] = Number(target[field]) || 0;
  }
  if (hasSplit) {
    for (const field of USAGE_COST_FIELDS) target[field] = (target[field] || 0) + (Number(source[field]) || 0);
  }
  const rest = hasSplit ? source.unsplit : source;
  if (!rest || !(Number(rest.cost) > 0)) return;
  target.unsplit ||= {};
  for (const field of UNSPLIT_FIELDS) target.unsplit[field] = (target.unsplit[field] || 0) + (Number(rest[field]) || 0);
  if (rest.mixed) target.unsplit.mixed = true;
}

export function addToCounter(target, key, values) {
  if (!Object.hasOwn(target, key)) Object.defineProperty(target, key, {
    value: { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0 },
    enumerable: true, configurable: true, writable: true,
  });
  addCostSplit(target[key], values);
  target[key].requests += values.requests ?? 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].reasoningTokens += values.reasoningTokens || 0;
  target[key].cacheCreationTokens += values.cacheCreationTokens || 0;
  target[key].cost += values.cost || 0;
  target[key].unknownCostRequests = (target[key].unknownCostRequests || 0) + (values.unknownCostRequests || 0);
  addLatency(target[key], values, values.completionTokens || 0);
  if (values.meta) Object.assign(target[key], values.meta);
}
