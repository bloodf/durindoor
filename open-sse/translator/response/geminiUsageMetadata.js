// Project an OpenAI Chat usage object onto the Gemini-family usageMetadata shape.
//
// OmniRoute #18643 introduced this helper upstream so the trailing usage-only
// chunk and the finish chunk share one projection instead of two copies of the
// same math.
//
// Local adaptation (deliberate, not an oversight): upstream's helper reports
// `completion_tokens` verbatim as `candidatesTokenCount`. This fork keeps its
// own accounting rule on top of the upstream shape — OpenAI completion tokens
// include reasoning, while Gemini counts thoughts separately — so the
// reasoning share is subtracted from `candidatesTokenCount` (floor 0) and
// reported on its own as `thoughtsTokenCount`. That keeps
// promptTokenCount + candidatesTokenCount + thoughtsTokenCount ===
// totalTokenCount on the stream path, matching the JSON projector. See
// internal/docs/v5-protocol-conformance.md.
//
// The upstream total is never recomputed, and the detail fields stay absent
// when the upstream reports none: a usage object without reasoning or cache
// details must project byte-identically to the pre-#18643 output.
export function buildGeminiUsageMetadata(usage) {
  if (!usage) return null;

  const metadata = {
    promptTokenCount: usage.prompt_tokens || 0,
    candidatesTokenCount: usage.completion_tokens || 0,
    totalTokenCount: usage.total_tokens || 0
  };

  if (usage.completion_tokens_details?.reasoning_tokens) {
    metadata.thoughtsTokenCount = usage.completion_tokens_details.reasoning_tokens;
    // OpenAI completion tokens include reasoning; Gemini counts thoughts separately.
    // The non-streaming projector (nonStreamingHandler) already subtracts them, so
    // without this clamp the stream path double counts reasoning and breaks
    // prompt + candidates + thoughts === total.
    metadata.candidatesTokenCount = Math.max(0,
      metadata.candidatesTokenCount - metadata.thoughtsTokenCount);
  }

  if (usage.prompt_tokens_details?.cached_tokens) {
    metadata.cachedContentTokenCount = usage.prompt_tokens_details.cached_tokens;
  }

  return metadata;
}
