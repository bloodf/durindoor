// Shared by the write path, daily rollups and the scalar-column backfill.
export function usageTokenColumns(tokens = {}) {
  return {
    cachedTokens: tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0,
    reasoningTokens: tokens?.reasoning_tokens || tokens?.completion_tokens_details?.reasoning_tokens || tokens?.output_tokens_details?.reasoning_tokens || 0,
    cacheCreationTokens: tokens?.cache_creation_input_tokens || 0,
  };
}
