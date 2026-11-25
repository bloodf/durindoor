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
// Responses names (input_tokens, output_tokens, *_tokens_details) are read when the
// Chat names are absent (OmniRoute #20224). A Chat total is never recomputed here;
// a Responses report without total_tokens gets input + output. Detail fields stay
// absent when the upstream reports none. Reasoning that the upstream total counts on
// top of the output count (see reasoningIsSubsetOfOutput) is not subtracted again.
import { reasoningIsSubsetOfOutput } from "../../utils/usageTracking.js";

export function buildGeminiUsageMetadata(usage) {
  if (!usage) return null;

  const prompt = usage.prompt_tokens || usage.input_tokens || 0;
  const completion = usage.completion_tokens || usage.output_tokens || 0;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens;
  const responsesTotal = (usage.input_tokens || 0) + (usage.output_tokens || 0);

  return {
    promptTokenCount: prompt,
    // Gemini counts thoughts separately from candidates.
    candidatesTokenCount: reasoning && reasoningIsSubsetOfOutput(usage) ?
    Math.max(0, completion - reasoning) :
    completion,
    totalTokenCount: usage.total_tokens || responsesTotal,
    ...(reasoning ? { thoughtsTokenCount: reasoning } : null),
    ...(cached ? { cachedContentTokenCount: cached } : null)
  };
}
