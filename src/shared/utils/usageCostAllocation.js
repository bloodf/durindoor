/**
 * Allocates an already-computed provider cost across display categories by
 * token share. Cached and cache-write tokens are prompt subsets, but malformed
 * upstream usage can report those subsets above prompt; clamp normal input to
 * zero and use the displayed category sum as the denominator.
 */
export function allocateUsageCost(data = {}) {
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
  };
}
