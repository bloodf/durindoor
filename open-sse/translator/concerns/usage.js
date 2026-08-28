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

/**
 * Convert usage to the cache-inclusive Responses contract.
 *
 * Provider-flat `cache_read_input_tokens` is cache-exclusive, so it and cache
 * creation are folded into `input_tokens` once, then the exclusive field is
 * dropped. When either flat field selects exclusive normalization, both flat
 * values are authoritative and stale nested cache values are removed.
 */
export function toResponsesUsage(raw) {
  if (!raw || !isObject(raw) || Array.isArray(raw)) return null;

  const baseInputTokens = n(raw.input_tokens) || n(raw.prompt_tokens);
  const outputTokens = n(raw.output_tokens) || n(raw.completion_tokens);
  const rawInputDetails = raw.input_tokens_details || raw.prompt_tokens_details;
  const inputDetails = rawInputDetails && isObject(rawInputDetails) && !Array.isArray(rawInputDetails) ?
  { ...rawInputDetails } : {};
  const hasExclusiveCache = raw.cache_read_input_tokens !== undefined || (
  raw.cache_creation_input_tokens !== undefined &&
  raw.cached_tokens === undefined &&
  inputDetails.cache_creation_tokens === undefined);
  const cachedTokens = hasExclusiveCache ?
  n(raw.cache_read_input_tokens) :
  isNumber(raw.cached_tokens) ? raw.cached_tokens : n(inputDetails.cached_tokens);
  const cacheCreationTokens = hasExclusiveCache ?
  n(raw.cache_creation_input_tokens) :
  isNumber(raw.cache_creation_input_tokens) ? raw.cache_creation_input_tokens : n(inputDetails.cache_creation_tokens);
  const inputTokens = hasExclusiveCache ? baseInputTokens + cachedTokens + cacheCreationTokens : baseInputTokens;
  if (hasExclusiveCache) {
    delete inputDetails.cached_tokens;
    delete inputDetails.cache_creation_tokens;
  }

  const usage = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: hasExclusiveCache ? inputTokens + outputTokens : n(raw.total_tokens) || inputTokens + outputTokens
  };

  if (cachedTokens > 0) {
    usage.cached_tokens = cachedTokens;
    inputDetails.cached_tokens = cachedTokens;
  }
  if (cacheCreationTokens > 0) {
    usage.cache_creation_input_tokens = cacheCreationTokens;
    inputDetails.cache_creation_tokens = cacheCreationTokens;
  }
  if (Object.keys(inputDetails).length > 0) usage.input_tokens_details = inputDetails;

  const rawOutputDetails = raw.output_tokens_details || raw.completion_tokens_details;
  const outputDetails = rawOutputDetails && isObject(rawOutputDetails) && !Array.isArray(rawOutputDetails) ?
  { ...rawOutputDetails } : {};
  const reasoningTokens = n(raw.reasoning_tokens);
  if (reasoningTokens > 0 && !isNumber(outputDetails.reasoning_tokens)) outputDetails.reasoning_tokens = reasoningTokens;
  if (Object.keys(outputDetails).length > 0) usage.output_tokens_details = outputDetails;

  return usage;
}