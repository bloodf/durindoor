/**
 * Return the committed token count used by daily and lifetime API-key limits.
 *
 * Provider usage payloads disagree about component shapes. An explicit total
 * is authoritative. Otherwise input/output are counted once. Reasoning detail
 * is a subset of completion in the canonical storage contract, while Gemini's
 * raw thoughts field is added only when no explicit total exists. Anthropic
 * cache-read/cache-creation fields are added only for raw, non-canonical usage.
 * Nested cached/reasoning detail fields are subsets of their parent totals and
 * must never be added again.
 */
export function getCommittedTokenCount(tokens = {}, fallback = {}) {
  const value = (candidate) => {
    const number = Number(candidate);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };
  const first = (...candidates) => {
    for (const candidate of candidates) {
      const number = value(candidate);
      if (number > 0) return number;
    }
    return 0;
  };

  const explicitTotal = first(tokens.total_tokens, tokens.totalTokenCount);
  if (explicitTotal > 0) return Math.ceil(explicitTotal);

  const input = first(tokens.prompt_tokens, tokens.input_tokens, tokens.promptTokenCount, fallback.promptTokens);
  const output = first(tokens.completion_tokens, tokens.output_tokens, tokens.candidatesTokenCount, fallback.completionTokens);
  const rawThoughts = first(tokens.thoughtsTokenCount);
  const reasoningWithoutOutput = output === 0 ? first(tokens.reasoning_tokens) : 0;
  const hasCanonicalCacheMarker = Object.hasOwn(tokens, "cached_tokens");
  const cacheRead = hasCanonicalCacheMarker ? 0 : first(tokens.cache_read_input_tokens);
  const cacheCreation = hasCanonicalCacheMarker ? 0 : first(tokens.cache_creation_input_tokens);
  return Math.ceil(input + output + rawThoughts + reasoningWithoutOutput + cacheRead + cacheCreation);
}
