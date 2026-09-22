import { isNumber } from "./typeChecks.js";

/** Display categories the usage tables show a cost column for. */
export const USAGE_COST_FIELDS = ["inputCost", "cachedCost", "cacheCreationCost", "outputCost", "reasoningCost"];

/**
 * True when the server already priced each category at its own rate.
 *
 * `getUsageStats` attaches the split whenever it can resolve pricing for the
 * bucket's model. Buckets whose model has no pricing entry arrive without it
 * and fall back to the token-share allocation below.
 *
 * @param {object} data - One usage bucket from /api/usage/stats
 * @returns {boolean}
 */
export function hasServerCostSplit(data = {}) {
  return USAGE_COST_FIELDS.some((field) => isNumber(data[field]));
}

/**
 * Split a bucket's cost across the display categories.
 *
 * Prefers the per-rate split computed server-side, where pricing lives. The
 * fallback spreads the already-computed total by token share: cached and
 * cache-write tokens are prompt subsets, but malformed upstream usage can
 * report those subsets above prompt, so normal input clamps to zero and the
 * displayed category sum is the denominator. That fallback prices every token
 * the same, so read it as a proportion of spend rather than a rate.
 *
 * @param {object} data - One usage bucket from /api/usage/stats
 * @returns {{inputCost:number,cachedCost:number,cacheCreationCost:number,outputCost:number,reasoningCost:number,unsplitCost:number}}
 */
export function allocateUsageCost(data = {}) {
  if (hasServerCostSplit(data)) {
    // `unsplitCost` is spend the server could not assign to a rate exactly.
    const split = { unsplitCost: Number(data.unsplitCost) || 0 };
    for (const field of USAGE_COST_FIELDS) split[field] = Number(data[field]) || 0;
    return split;
  }

  const totalCost = Number(data.cost) || 0;
  const cachedTokens = Number(data.cachedTokens) || 0;
  const cacheCreationTokens = Number(data.cacheCreationTokens) || 0;
  const completionTokens = Number(data.completionTokens) || 0;
  const reasoningTokens = Number(data.reasoningTokens) || 0;
  const nonCachedInput = Math.max(
    0,
    (Number(data.promptTokens) || 0) - cachedTokens - cacheCreationTokens,
  );
  const allocationTokens = nonCachedInput + cachedTokens + cacheCreationTokens
    + completionTokens + reasoningTokens;
  const unitCost = allocationTokens > 0 ? totalCost / allocationTokens : 0;
  return {
    inputCost: nonCachedInput * unitCost,
    cachedCost: cachedTokens * unitCost,
    cacheCreationCost: cacheCreationTokens * unitCost,
    outputCost: completionTokens * unitCost,
    reasoningCost: reasoningTokens * unitCost,
    unsplitCost: 0,
  };
}
