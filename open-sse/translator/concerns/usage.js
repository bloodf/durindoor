// Build OpenAI usage object. Caller computes prompt/completion/total (provider math).
import { isNumber, isObject } from "../../../src/shared/utils/typeChecks.js";
// Optional details added only when > 0 (matches existing claude/gemini/codex behavior).
export function buildUsage({ promptTokens, completionTokens, totalTokens, cachedTokens = 0, cacheCreationTokens = 0, reasoningTokens = 0, outputTokensDetails }) {
  const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens };
  if (cachedTokens > 0 || cacheCreationTokens > 0) {
    usage.prompt_tokens_details = {};
    if (cachedTokens > 0) usage.prompt_tokens_details.cached_tokens = cachedTokens;
    if (cacheCreationTokens > 0) usage.prompt_tokens_details.cache_creation_tokens = cacheCreationTokens;
  }
  if (reasoningTokens > 0) {
    usage.completion_tokens_details = { reasoning_tokens: reasoningTokens };
  }
  if (outputTokensDetails && isObject(outputTokensDetails)) {
    usage.output_tokens_details = outputTokensDetails;
  }
  return usage;
}

const n = (v) => isNumber(v) ? v : 0;

// Per-provider raw token field-map + math. Returns buildUsage() args (NOT the usage object).
// Keeps each provider's exact semantics: claude/gemini fold cache+reasoning, others don't.
const USAGE_EXTRACTORS = {
  /**
   * Anthropic counts thinking inside output_tokens; expose its detail without
   * adding it to completion_tokens or changing billing inputs.
   */
  claude(raw) {
    const input = n(raw.input_tokens),output = n(raw.output_tokens);
    const cacheRead = n(raw.cache_read_input_tokens),cacheCreate = n(raw.cache_creation_input_tokens);
    const prompt = input + cacheRead + cacheCreate;
    const outputTokensDetails = raw.output_tokens_details;
    return {
      promptTokens: prompt,
      completionTokens: output,
      totalTokens: prompt + output,
      cachedTokens: cacheRead,
      cacheCreationTokens: cacheCreate,
      reasoningTokens: n(outputTokensDetails?.thinking_tokens),
      outputTokensDetails
    };
  },
  gemini(raw) {
    const cached = n(raw.cachedContentTokenCount);
    const prompt = n(raw.promptTokenCount);
    const thoughts = n(raw.thoughtsTokenCount);
    const total = n(raw.totalTokenCount);
    let candidates = n(raw.candidatesTokenCount);
    // Fallback: derive candidates from total when upstream omits it
    if (candidates === 0 && total > 0) {
      candidates = total - prompt - thoughts;
      if (candidates < 0) candidates = 0;
    }
    // Some Gemini surfaces report candidates excluding thoughts while others
    // include them. When total is present it is authoritative, so derive the
    // canonical completion from total-input and keep thoughts as a subset.
    const canonicalCompletion = total > 0 ?
    Math.max(0, total - prompt) :
    candidates + thoughts;
    return {
      promptTokens: prompt,
      completionTokens: canonicalCompletion,
      totalTokens: total > 0 ? total : prompt + canonicalCompletion,
      cachedTokens: cached,
      reasoningTokens: thoughts
    };
  },
  kiro(raw) {
    const input = n(raw.inputTokens),output = n(raw.outputTokens);
    // ponytail: Amazon Q (Kiro upstream) does not expose cache fields today,
    // but pass through any cache_read/cache_creation/cached_tokens if the
    // event shape grows them later so cost tracking keeps working without
    // a second pass.
    const cached = n(raw.cache_read_input_tokens) || n(raw.cachedTokens) || n(raw.cached_tokens);
    const cacheCreation = n(raw.cache_creation_input_tokens);
    const out = { promptTokens: input, completionTokens: output, totalTokens: input + output };
    if (cached > 0) out.cachedTokens = cached;
    if (cacheCreation > 0) out.cacheCreationTokens = cacheCreation;
    return out;
  },
  ollama(raw) {
    const input = n(raw.prompt_eval_count),output = n(raw.eval_count);
    return { promptTokens: input, completionTokens: output, totalTokens: input + output };
  },
  commandcode(raw) {
    const input = n(raw.inputTokens),output = n(raw.outputTokens);
    const total = isNumber(raw.totalTokens) ? raw.totalTokens : input + output;
    return { promptTokens: input, completionTokens: output, totalTokens: total };
  }
};

// Convert provider-native usage object → OpenAI usage. Returns null if no extractor/raw.
export function toOpenAIUsage(raw, kind) {
  const extract = USAGE_EXTRACTORS[kind];
  if (!extract || !raw || !isObject(raw)) return null;
  return buildUsage(extract(raw));
}

// OpenAI chat-completions usage → Responses API usage (Codex requires input_tokens).
export function toResponsesUsage(raw) {
  if (!raw || !isObject(raw) || Array.isArray(raw)) return null;

  const inputTokens = n(raw.input_tokens) || n(raw.prompt_tokens);
  const outputTokens = n(raw.output_tokens) || n(raw.completion_tokens);

  const usage = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: n(raw.total_tokens) || inputTokens + outputTokens
  };

  const cachedTokens = n(raw.input_tokens_details?.cached_tokens) || n(raw.prompt_tokens_details?.cached_tokens);
  if (cachedTokens > 0) usage.input_tokens_details = { cached_tokens: cachedTokens };

  const reasoningTokens = n(raw.output_tokens_details?.reasoning_tokens) || n(raw.completion_tokens_details?.reasoning_tokens);
  if (reasoningTokens > 0) usage.output_tokens_details = { reasoning_tokens: reasoningTokens };

  return usage;
}