/**
 * Token Usage Tracking - Extract, normalize, estimate and log token usage
 */

import { GEMINI_INTERACTIONS_ID } from "../providers/registry/gemini-interactions.js";
import { FORMATS } from "../translator/formats.js";
import { getPricingForModel, calculateCostFromTokens } from "../providers/pricing.js";

// Legacy per-chunk usage console line; off by default (superseded by "📊 done")
import { isBoolean, isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";
const DEBUG_USAGE = process.env.LOG_USAGE_VERBOSE === "1";
// USD receipts are JSON numbers. Missing/malformed values may use estimated
// pricing later, but must never be coerced into authoritative zero-dollar usage.
const isUsdReceipt = (value) => isNumber(value) && Number.isFinite(value) && value >= 0;

// ANSI color codes
export const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m"
};

// Default buffer tokens reported to clients to prevent context-window overflows
export const DEFAULT_BUFFER_TOKENS = 2000;

const warnedInvalidUsageBuffers = new Set();

/**
 * Resolve the client-facing usage buffer from USAGE_BUFFER_TOKENS.
 * Accepts non-negative decimal integers (including 0 to disable).
 * Unset/blank or invalid values fall back to DEFAULT_BUFFER_TOKENS.
 */
export function getBufferTokens() {
  const raw = process.env.USAGE_BUFFER_TOKENS;
  if (raw === undefined || raw === null) return DEFAULT_BUFFER_TOKENS;
  const trimmed = String(raw).trim();
  if (trimmed === "") return DEFAULT_BUFFER_TOKENS;
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isSafeInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  if (!warnedInvalidUsageBuffers.has(trimmed)) {
    warnedInvalidUsageBuffers.add(trimmed);
    console.warn(
      `[usage] Invalid USAGE_BUFFER_TOKENS="${trimmed}"; expected a non-negative integer, falling back to ${DEFAULT_BUFFER_TOKENS}`,
    );
  }
  return DEFAULT_BUFFER_TOKENS;
}

// Get HH:MM:SS timestamp
function getTimeString() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Add buffer tokens to usage to prevent context errors
 * @param {object} usage - Usage object (any format)
 * @param {string} [provider] - Upstream provider id
 * @returns {object} Usage with buffer added
 */
export function addBufferToUsage(usage, provider) {
  // Interactions exposes its provider receipt directly through the Gemini API.
  if (provider === GEMINI_INTERACTIONS_ID) return usage;
  if (!usage || !isObject(usage)) return usage;

  const buffer = getBufferTokens();
  const result = { ...usage };

  // Claude / OpenAI Responses format
  if (buffer > 0 && result.input_tokens !== undefined) {
    result.input_tokens += buffer;
  }

  // OpenAI Chat Completions format
  if (buffer > 0 && result.prompt_tokens !== undefined) {
    result.prompt_tokens += buffer;
  }

  // Calculate or update total_tokens
  if (result.total_tokens !== undefined) {
    if (buffer > 0) result.total_tokens += buffer;
  } else if (result.prompt_tokens !== undefined && result.completion_tokens !== undefined) {
    // Calculate total_tokens if not exists
    result.total_tokens = result.prompt_tokens + result.completion_tokens;
  }

  return result;
}

export function filterUsageForFormat(usage, targetFormat) {
  if (!usage || !isObject(usage)) return usage;

  // Helper to pick only defined fields from usage
  const pickFields = (fields) => {
    const filtered = {};
    for (const field of fields) {
      if (usage[field] !== undefined) {
        filtered[field] = usage[field];
      }
    }
    return filtered;
  };

  // Define allowed fields for each format
  const formatFields = {
    [FORMATS.CLAUDE]: [
    'input_tokens', 'output_tokens',
    'cache_read_input_tokens', 'cache_creation_input_tokens', 'server_tool_use',
    'estimated', 'cost_usd', 'cost_in_usd', 'cost_in_usd_ticks', 'cost_details', 'tokens_per_second'],

    [FORMATS.GEMINI]: [
    'promptTokenCount', 'candidatesTokenCount', 'totalTokenCount',
    'cachedContentTokenCount', 'thoughtsTokenCount',
    'estimated', 'cost_usd', 'cost_in_usd', 'cost_in_usd_ticks', 'cost_details', 'tokens_per_second'],

    [FORMATS.OPENAI_RESPONSES]: [
    'input_tokens', 'output_tokens', 'total_tokens',
    'input_tokens_details', 'output_tokens_details',
    'estimated', 'cost_usd', 'cost_in_usd', 'cost_in_usd_ticks', 'cost_details', 'tokens_per_second'],

    // OpenAI format (default for OPENAI, CODEX, KIRO, etc.)
    default: [
    'prompt_tokens', 'completion_tokens', 'total_tokens',
    'cached_tokens', 'reasoning_tokens',
    'prompt_tokens_details', 'completion_tokens_details', 'output_tokens_details',
    'estimated', 'cost_usd', 'cost_in_usd', 'cost_in_usd_ticks', 'cost_details', 'tokens_per_second']

  };

  // Get fields for target format
  let fields = formatFields[targetFormat];

  // Use same fields for similar formats
  if (targetFormat === FORMATS.GEMINI_CLI || targetFormat === FORMATS.ANTIGRAVITY) {
    fields = formatFields[FORMATS.GEMINI];
  } else if (targetFormat === FORMATS.OPENAI_RESPONSE) {
    fields = formatFields[FORMATS.OPENAI_RESPONSES];
  } else if (!fields) {
    fields = formatFields.default;
  }

  const filtered = pickFields(fields);
  // Client-only projection: expose Anthropic thinking without adding a
  // canonical reasoning_tokens field that would alter downstream billing.
  const thinkingTokens = usage.output_tokens_details?.thinking_tokens;
  if (!formatFields[targetFormat] && isNumber(thinkingTokens)) {
    filtered.completion_tokens_details = {
      ...filtered.completion_tokens_details,
      reasoning_tokens: thinkingTokens
    };
  }
  // Claude stream state carries the cache split in flat fields; OpenAI clients
  // expect that split under prompt_tokens_details, not as top-level fields.
  if (fields === formatFields.default && (usage.cache_read_input_tokens > 0 || usage.cache_creation_input_tokens > 0)) {
    const details = { ...filtered.prompt_tokens_details };
    if (usage.cache_read_input_tokens > 0 && details.cached_tokens === undefined) details.cached_tokens = usage.cache_read_input_tokens;
    if (usage.cache_creation_input_tokens > 0 && details.cache_creation_tokens === undefined) details.cache_creation_tokens = usage.cache_creation_input_tokens;
    filtered.prompt_tokens_details = details;
  }
  return filtered;
}

/**
 * Normalize usage object - ensure all values are valid numbers
 */
export function normalizeUsage(usage) {
  if (!usage || !isObject(usage) || Array.isArray(usage)) return null;

  const normalized = {};
  const assignNumber = (key, value) => {
    if (value === undefined || value === null) return;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) normalized[key] = numeric;
  };

  assignNumber("prompt_tokens", usage?.prompt_tokens);
  assignNumber("completion_tokens", usage?.completion_tokens);
  assignNumber("total_tokens", usage?.total_tokens);
  assignNumber("cache_read_input_tokens", usage?.cache_read_input_tokens);
  const details = usage.prompt_tokens_details ?? usage.input_tokens_details;
  const cacheWrite = usage.cache_creation_input_tokens ?? usage.cache_write_tokens ??
    details?.cache_creation_tokens ?? details?.cache_write_tokens;
  assignNumber("cache_creation_input_tokens", cacheWrite);
  // Alias reports are inclusive subsets, like OpenAI token details.
  if (usage.cache_creation_input_tokens == null && cacheWrite != null) {
    normalized.prompt_tokens_details = { ...details, cache_creation_tokens: cacheWrite };
  }
  assignNumber("cached_tokens", usage?.cached_tokens);
  assignNumber("reasoning_tokens", usage?.reasoning_tokens);
  for (const field of ["cost_usd", "cost_in_usd", "cost_in_usd_ticks"]) {
    if (isUsdReceipt(usage[field])) normalized[field] = usage[field];
  }
  // Kiro meters in credits, not tokens — preserve through normalization
  // (consumption is never negative; drop malformed null/negative values)
  const kiroCredits = usage?.kiro_credits !== null && usage?.kiro_credits !== undefined ?
  Number(usage.kiro_credits) : NaN;
  if (Number.isFinite(kiroCredits) && kiroCredits >= 0) {
    normalized.kiro_credits = kiroCredits;
    if (isString(usage?.kiro_credit_unit)) {
      normalized.kiro_credit_unit = usage.kiro_credit_unit;
    }
  }

  // Estimation marker must survive normalization so fallback token counts
  // are never persisted as authoritative numbers.
  if (usage?.estimated === true) normalized.estimated = true;

  // Preserve nested details objects for OpenAI format forwarding
  if (usage?.prompt_tokens_details && isObject(usage.prompt_tokens_details)) {
    normalized.prompt_tokens_details = { ...usage.prompt_tokens_details, ...normalized.prompt_tokens_details };
  }
  if (usage?.completion_tokens_details && isObject(usage.completion_tokens_details)) {
    normalized.completion_tokens_details = usage.completion_tokens_details;
  }
  if (usage?.output_tokens_details && isObject(usage.output_tokens_details)) {
    normalized.output_tokens_details = usage.output_tokens_details;
  }

  if (Object.keys(normalized).length === 0) return null;
  return normalized;
}

/**
 * Is the reasoning slice counted INSIDE the output count?
 *
 * OpenAI chat completions and the Responses API report reasoning_tokens as a
 * SUBSET of completion/output tokens. A few OpenAI-compatible upstreams (xAI)
 * report it on top instead, and Gemini's thoughtsTokenCount is separate from
 * candidatesTokenCount. The reported total tells the two apart: an additive
 * report has total_tokens === prompt + completion + reasoning.
 *
 * @param {object} usage raw upstream usage object
 * @returns {boolean} true when reasoning is a subset of the output count
 */
export function reasoningIsSubsetOfOutput(usage) {
  const reasoning = Number(
    usage?.completion_tokens_details?.reasoning_tokens ?? usage?.output_tokens_details?.reasoning_tokens
  ) || 0;
  const total = Number(usage?.total_tokens);
  if (reasoning <= 0 || !Number.isFinite(total)) return true;
  const prompt = Number(usage?.prompt_tokens ?? usage?.input_tokens) || 0;
  const completion = Number(usage?.completion_tokens ?? usage?.output_tokens) || 0;
  return total !== prompt + completion + reasoning;
}

// Mark a usage object whose reasoning slice is counted ON TOP of the output
// count. DurinDoor bills reasoning as a subset of the output count by default
// (calculateCostBreakdown), so only the additive families carry this marker —
// 1 means "reasoning is inside the output count", 0 means "counted on top".
function markReasoningAdditive(usage) {
  if (usage && isObject(usage) && usage.reasoning_tokens > 0) {
    usage.reasoning_included_in_output = 0;
  }
  return usage;
}

/**
 * Canonicalize usage into ONE storage/cost convention so token counts and cost
 * are consistent across providers:
 *   prompt_tokens               = total input INCLUDING cache read + cache creation
 *   cached_tokens               = cache-read portion (subset of prompt_tokens)
 *   cache_creation_input_tokens = cache-write portion (subset of prompt_tokens)
 *   completion_tokens, reasoning_tokens, total_tokens
 *
 * Discriminator: provider-flat cache fields report cache amounts excluded from
 * prompt, so we fold both flat amounts into prompt. Once folded, Responses and
 * OpenAI/Gemini usage carry inclusive cached fields instead. Idempotent: the
 * inclusive output has no cache_read_input_tokens, and nested cache creation
 * identifies cache_creation_input_tokens as an inclusive subset.
 *
 * @param {object} usage - a normalizeUsage()-shaped object
 * @returns {object|null} canonical token object, or null for invalid input
 */
export function canonicalizeUsage(usage) {
  if (!usage || !isObject(usage) || Array.isArray(usage)) return null;

  const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const inputDetails = usage.prompt_tokens_details ?? usage.input_tokens_details;
  const outputDetails = usage.completion_tokens_details ?? usage.output_tokens_details;
  const reasoning = num(usage.reasoning_tokens ?? outputDetails?.reasoning_tokens);
  const reportedCompletion = num(usage.completion_tokens ?? usage.output_tokens);
  // 9router #3945: when reasoning sits inside the output count, an upstream
  // that reports completion 0 (or below its own reasoning slice) undercounts.
  // Additive families (reasoning_included_in_output === 0) bill it on top.
  const foldReasoning = usage.reasoning_included_in_output !== 0 && reasoning > reportedCompletion &&
    reasoningIsSubsetOfOutput(usage);
  const completion = foldReasoning ? reasoning : reportedCompletion;
  const cacheWrite = usage.cache_creation_input_tokens ?? usage.cache_write_tokens ?? inputDetails?.cache_creation_tokens ?? inputDetails?.cache_write_tokens;
  const hasExclusiveCache = usage.cache_read_input_tokens !== undefined || (
  usage.cache_creation_input_tokens !== undefined &&
  usage.cached_tokens === undefined &&
  inputDetails?.cache_creation_tokens === undefined);
  const cacheCreation = hasExclusiveCache ?
  num(usage.cache_creation_input_tokens) :
  num(cacheWrite);

  let prompt = num(usage.prompt_tokens ?? usage.input_tokens);
  let cached;

  if (hasExclusiveCache) {
    cached = num(usage.cache_read_input_tokens);
    // Claude-to-OpenAI translation can preserve cache fields while already
    // folding them into prompt_tokens. Prefer Claude's exclusive input_tokens
    // base when present so repeated normalization does not count cache twice.
    const basePrompt = usage.input_tokens !== undefined ? num(usage.input_tokens) : prompt;
    prompt = basePrompt + cached + cacheCreation;
  } else {
    // OpenAI/Gemini/Responses path: cache fields are subsets of inclusive input.
    cached = num(usage.cached_tokens ?? inputDetails?.cached_tokens);
  }

  const componentTotal = prompt + completion;
  const explicitTotal = num(usage.total_tokens);

  const result = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    // Exclusive cache normalization changes the component sum, so its incoming
    // total becomes stale. Inclusive providers' explicit totals stay authoritative.
    total_tokens: hasExclusiveCache ? componentTotal : explicitTotal > 0 ? Math.max(explicitTotal, foldReasoning ? componentTotal : 0) : componentTotal,
    cached_tokens: cached,
    cache_creation_input_tokens: cacheCreation
  };
  if (isUsdReceipt(usage.cost_usd)) result.cost_usd = usage.cost_usd;
  if (isUsdReceipt(usage.cost_in_usd)) result.cost_in_usd = usage.cost_in_usd;
  if (isUsdReceipt(usage.cost_in_usd_ticks)) result.cost_in_usd_ticks = usage.cost_in_usd_ticks;
  if (reasoning > 0) result.reasoning_tokens = reasoning;
  // Carry the additive-reasoning marker through canonicalization so cost
  // pricing knows the reasoning slice is NOT already inside completion_tokens.
  if (usage.reasoning_included_in_output === 0) result.reasoning_included_in_output = 0;
  const kiroCredits = usage.kiro_credits !== null && usage.kiro_credits !== undefined ?
  Number(usage.kiro_credits) : NaN;
  if (Number.isFinite(kiroCredits) && kiroCredits >= 0) {
    result.kiro_credits = kiroCredits;
    if (isString(usage.kiro_credit_unit)) result.kiro_credit_unit = usage.kiro_credit_unit;
  }
  if (usage.estimated === true) result.estimated = true;
  return result;
}

/**
 * Ensure usage.cost_usd is set before a response reaches the client. Prefers
 * a provider-reported cost (already normalized into cost_usd by normalizeUsage/
 * extractUsage, e.g. OpenRouter's bare `usage.cost`); falls back to estimating
 * from MODEL_PRICING via the token counts already on `usage`. No-op when cost
 * is already present or no pricing entry matches the model.
 *
 * @param {object} usage
 * @param {string} provider
 * @param {string} model
 * @returns {object} usage, with cost_usd added when it could be determined
 */
export function enrichUsageCost(usage, provider, model) {
  if (!usage || !isObject(usage)) return usage;
  if ([usage.cost_usd, usage.cost_in_usd, usage.cost_in_usd_ticks].some(isUsdReceipt)) return usage;

  const pricing = getPricingForModel(provider, model);
  if (!pricing) return usage;

  const cost = calculateCostFromTokens(canonicalizeUsage(usage) || usage, pricing);
  if (!Number.isFinite(cost) || cost < 0) return usage;

  // Client-format token counts may include a buffer. This public builtin
  // estimate is not the ledger's operator-configured/raw-token valuation.
  return { ...usage, cost_usd: cost, cost_details: {
    status: "estimated", source: "builtin", basis: "response_token_counts",
    unit: "USD_per_million_tokens", rates: { ...pricing },
  } };
}

/**
 * Convert Claude's cache-exclusive input accounting to OpenAI's convention,
 * where prompt_tokens INCLUDES cached and newly-cached input tokens (#2658).
 * Anthropic thinking is already included in output_tokens; expose its count as
 * reasoning detail without adding it again or changing billing inputs.
 */
export function claudeUsageToOpenAI(usage) {
  const outputTokensDetails = usage?.output_tokens_details;
  const canonical = canonicalizeUsage({
    prompt_tokens: usage?.input_tokens,
    completion_tokens: usage?.output_tokens,
    cache_read_input_tokens: usage?.cache_read_input_tokens,
    cache_creation_input_tokens: usage?.cache_creation_input_tokens
  });
  if (!canonical) return null;

  const result = {
    prompt_tokens: canonical.prompt_tokens,
    completion_tokens: canonical.completion_tokens,
    total_tokens: canonical.total_tokens
  };
  if (canonical.cached_tokens > 0 || canonical.cache_creation_input_tokens > 0) {
    result.prompt_tokens_details = {};
    if (canonical.cached_tokens > 0) {
      result.prompt_tokens_details.cached_tokens = canonical.cached_tokens;
    }
    if (canonical.cache_creation_input_tokens > 0) {
      result.prompt_tokens_details.cache_creation_tokens = canonical.cache_creation_input_tokens;
    }
  }
  const thinkingTokens = outputTokensDetails?.thinking_tokens;
  if (isNumber(thinkingTokens)) {
    result.completion_tokens_details = { reasoning_tokens: thinkingTokens };
  }
  if (outputTokensDetails && isObject(outputTokensDetails)) {
    result.output_tokens_details = outputTokensDetails;
  }
  return result;
}

/**
 * Check if usage has valid token data
 * Valid = has at least one token field with value > 0
 * Invalid = empty object {}, null, undefined, no token fields, or all zeros
 */
export function hasValidUsage(usage) {
  if (!usage || !isObject(usage)) return false;

  // Check for any known token field with value > 0
  const tokenFields = [
  "prompt_tokens", "completion_tokens", "total_tokens", // OpenAI
  "input_tokens", "output_tokens", // Claude
  "promptTokenCount", "candidatesTokenCount" // Gemini
  ];

  for (const field of tokenFields) {
    if (isNumber(usage[field]) && usage[field] > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Extract usage from any format (Claude, OpenAI, Gemini, Responses API)
 */
// Claude message_start can carry a positive output count before any output is
// produced. It is provisional until a message_delta receipt reports the final
// cumulative count. Markers live outside the usage object so they never reach
// clients or persisted logs.
const provisionalOutputUsage = new WeakSet();
const finalOutputReceipts = new WeakSet();
const mark = (set, usage) => {
  if (usage) set.add(usage);
  return usage;
};

/** True while the output count is still the Claude message_start placeholder. */
export function isProvisionalOutput(usage) {
  return Boolean(usage) && isObject(usage) && provisionalOutputUsage.has(usage);
}

/**
 * Raise a provisional output count to the estimate of the output already
 * received, so an interrupted stream is not billed at the placeholder.
 */
export function refreshProvisionalOutput(usage, outputChars) {
  if (!isProvisionalOutput(usage)) return usage;
  const estimate = estimateOutputTokens(outputChars);
  if (estimate <= (Number(usage.completion_tokens) || 0)) return usage;
  return mark(provisionalOutputUsage, { ...usage, completion_tokens: estimate });
}

export function extractUsage(chunk) {
  if (!chunk || !isObject(chunk)) return null;

  // Claude format (message_start event): carries input_tokens + cache_read +
  // cache_creation. message_delta later carries only the final output_tokens,
  // so callers must MERGE (mergeUsage), not overwrite, to keep cache counts.
  if (chunk.type === "message_start" && chunk.message?.usage && isObject(chunk.message.usage)) {
    const u = chunk.message.usage;
    const provisional = Number(u.output_tokens) > 0;
    const extracted = normalizeUsage({
      prompt_tokens: u.input_tokens || 0,
      completion_tokens: u.output_tokens || 0,
      cache_read_input_tokens: u.cache_read_input_tokens,
      cache_creation_input_tokens: u.cache_creation_input_tokens
    });
    return provisional ? mark(provisionalOutputUsage, extracted) : extracted;
  }
  // Claude format (message_delta event). Anthropic reports thinking as a
  // subset of output_tokens, so preserve the detail without inflating output.
  if (chunk.type === "message_delta" && chunk.usage && isObject(chunk.usage)) {
    const hasFinalOutput = chunk.usage.output_tokens != null && Number.isFinite(Number(chunk.usage.output_tokens));
    const extracted = normalizeUsage({
      prompt_tokens: chunk.usage.input_tokens || 0,
      completion_tokens: chunk.usage.output_tokens || 0,
      cache_read_input_tokens: chunk.usage.cache_read_input_tokens,
      cache_creation_input_tokens: chunk.usage.cache_creation_input_tokens,
      output_tokens_details: chunk.usage.output_tokens_details
    });
    return hasFinalOutput ? mark(finalOutputReceipts, extracted) : extracted;
  }

  // OpenAI Responses API terminal usage, including reported incomplete responses.
  // Cache fields already follow the inclusive Responses contract here.
  // A bare Responses-shaped `usage` (input_tokens/output_tokens, no prompt_tokens) can also
  // arrive directly on a translated stream chunk; read it the same way.
  const isTerminalResponsesEvent = chunk.type === "response.completed" || chunk.type === "response.done" || chunk.type === "response.incomplete";
  const responsesUsage = isTerminalResponsesEvent ? chunk.response?.usage :
    chunk.usage?.input_tokens !== undefined && chunk.usage?.prompt_tokens === undefined ? chunk.usage : null;
  if (responsesUsage && isObject(responsesUsage)) {
    const usage = responsesUsage;
    const inputDetails = usage.input_tokens_details;
    const cachedTokens = usage.cached_tokens ?? inputDetails?.cached_tokens;
    const cacheCreationTokens = usage.cache_creation_input_tokens ?? usage.cache_write_tokens ?? inputDetails?.cache_creation_tokens ?? inputDetails?.cache_write_tokens;
    return normalizeUsage({
      prompt_tokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
      completion_tokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens,
      cached_tokens: cachedTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      reasoning_tokens: usage.output_tokens_details?.reasoning_tokens,
      cost_in_usd: usage.cost_in_usd,
      cost_in_usd_ticks: usage.cost_in_usd_ticks,
      prompt_tokens_details: cacheCreationTokens == null ? inputDetails : { ...inputDetails, cache_creation_tokens: cacheCreationTokens }
    });
  }

  // OpenAI format (also covers DeepSeek which uses prompt_cache_hit_tokens).
  // Kiro can attach credit-only metering without token counts.
  if (chunk.usage && isObject(chunk.usage) && (
  chunk.usage.prompt_tokens !== undefined || chunk.usage.completion_tokens !== undefined ||
  chunk.usage.total_tokens !== undefined || chunk.usage.kiro_credits !== undefined)) {
    const hasPromptTokens = chunk.usage.prompt_tokens !== undefined;
    const reasoningTokens = Number(chunk.usage.completion_tokens_details?.reasoning_tokens) || 0;
    // 9router #3945: fold reasoning into a zero/undercounted completion only when
    // it is a subset of the output count; additive upstreams are marked below.
    const foldReasoning = reasoningTokens > (Number(chunk.usage.completion_tokens) || 0) &&
      reasoningIsSubsetOfOutput(chunk.usage);
    const normalized = normalizeUsage({
      prompt_tokens: chunk.usage.prompt_tokens,
      completion_tokens: foldReasoning ? reasoningTokens :
        hasPromptTokens ? chunk.usage.completion_tokens || 0 : chunk.usage.completion_tokens,
      total_tokens: chunk.usage.total_tokens,
      cached_tokens: [chunk.usage.prompt_tokens_details?.cached_tokens, chunk.usage.input_tokens_details?.cached_tokens,
        chunk.usage.cache_read_input_tokens, chunk.usage.prompt_cache_hit_tokens, chunk.usage.cached_tokens]
        .find((value) => value != null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0),
      reasoning_tokens: chunk.usage.completion_tokens_details?.reasoning_tokens,
      // OpenRouter reports cost as a bare USD number on usage; same unit as cost_usd.
      cost_usd: isUsdReceipt(chunk.usage.cost) ? chunk.usage.cost : chunk.usage.cost_usd,
      cost_in_usd: chunk.usage.cost_in_usd,
      cost_in_usd_ticks: chunk.usage.cost_in_usd_ticks,
      cache_creation_input_tokens: chunk.usage.cache_creation_input_tokens,
      cache_write_tokens: chunk.usage.cache_write_tokens,
      input_tokens_details: chunk.usage.input_tokens_details,
      prompt_tokens_details: chunk.usage.prompt_tokens_details,
      completion_tokens_details: chunk.usage.completion_tokens_details,
      kiro_credits: chunk.usage.kiro_credits,
      kiro_credit_unit: chunk.usage.kiro_credit_unit,
      estimated: chunk.usage.estimated
    });
    // OpenAI chat reports reasoning_tokens INSIDE completion_tokens, but a few
    // OpenAI-compatible upstreams (xAI) report it on top instead. Charge each
    // token once either way.
    if (!reasoningIsSubsetOfOutput(chunk.usage)) {
      return markReasoningAdditive(normalized);
    }
    return normalized;
  }

  // Gemini format (Antigravity)
  // Antigravity wraps usageMetadata inside response: { response: { usageMetadata: {...} } }
  const usageMeta = chunk.usageMetadata || chunk.response?.usageMetadata;
  if (usageMeta && isObject(usageMeta)) {
    // thoughtsTokenCount is NOT part of candidatesTokenCount: the reasoning is
    // counted on top of the output count, so it is billed separately.
    return markReasoningAdditive(normalizeUsage({
      prompt_tokens: usageMeta.promptTokenCount || 0,
      completion_tokens: usageMeta.candidatesTokenCount || 0,
      total_tokens: usageMeta.totalTokenCount,
      cached_tokens: [usageMeta.cachedContentTokenCount, usageMeta.cached_content_token_count]
        .find((value) => value != null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0),
      reasoning_tokens: usageMeta.thoughtsTokenCount
    }));
  }

  // Ollama NDJSON format (raw from provider, before translation).
  // Final chunk: {"model":"...","done":true,"prompt_eval_count":N,"eval_count":M,
  // "prompt_eval_cached_count":C}. prompt_eval_cached_count is a cache-read subset
  // of prompt_eval_count (cache-INCLUSIVE; https://docs.ollama.com/api/usage).
  // Clamp C to prompt so non-cached input/cost cannot go negative.
  // Absent/null/non-finite/negative C → omit cached_tokens (same as main).
  if (chunk.done === true && isNumber(chunk.prompt_eval_count)) {
    const usage = {
      prompt_tokens: chunk.prompt_eval_count || 0,
      completion_tokens: chunk.eval_count || 0,
      total_tokens: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0)
    };
    const cachedRaw = chunk.prompt_eval_cached_count;
    if (isNumber(cachedRaw) && Number.isFinite(cachedRaw) && cachedRaw >= 0) {
      const prompt = usage.prompt_tokens;
      usage.cached_tokens = Number.isFinite(prompt) ? Math.min(cachedRaw, prompt) : cachedRaw;
    }
    return normalizeUsage(usage);
  }

  return null;
}

// Token-count fields an estimate can stand in for. A report that carries none
// of them (Kiro meters in credits only) says nothing about token counts, so an
// estimate still supplies them.
const TOKEN_COUNT_FIELDS = [
  "prompt_tokens", "completion_tokens", "total_tokens",
  "input_tokens", "output_tokens",
  "cached_tokens", "cache_read_input_tokens", "cache_creation_input_tokens",
  "reasoning_tokens"
];

function hasTokenCounts(usage) {
  if (!usage || !isObject(usage)) return false;
  return TOKEN_COUNT_FIELDS.some((field) => isNumber(usage[field]) && Number.isFinite(usage[field]));
}

// Copy the token counts of `donor` onto `base`, keeping every other field of
// `base` (provider credits, unit label, cost receipts) untouched.
function mergeTokenCounts(base, donor) {
  const merged = { ...base };
  for (const field of TOKEN_COUNT_FIELDS) {
    if (isNumber(donor?.[field]) && Number.isFinite(donor[field])) merged[field] = donor[field];
  }
  if (merged.total_tokens === undefined) {
    const prompt = merged.prompt_tokens ?? merged.input_tokens;
    const completion = merged.completion_tokens ?? merged.output_tokens;
    if (Number.isFinite(prompt) && Number.isFinite(completion)) merged.total_tokens = prompt + completion;
  }
  // The counts came from an estimate, so they stay marked as estimates.
  if (donor?.estimated === true) merged.estimated = true;
  return merged;
}

// A real report replaces the token counts of the estimate it follows. The
// estimate's other fields (credits, unit) survive; its inflated total does not.
function replaceEstimatedTokens(prev, next) {
  const merged = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (k === "estimated") continue; // the marker is sticky, handled below
    if (isNumber(v) && Number.isFinite(v)) {
      merged[k] = v;
    } else if (v && isObject(v)) {
      merged[k] = v; // nested details objects: take latest
    } else if (isString(v) && k === "kiro_credit_unit") {
      merged[k] = v; // Kiro credit unit label: take latest
    }
  }
  // The real report may omit total_tokens; recompute from the real counts
  // instead of keeping the estimate's inflated total.
  if (next.total_tokens === undefined) {
    const prompt = merged.prompt_tokens ?? merged.input_tokens;
    const completion = merged.completion_tokens ?? merged.output_tokens;
    if (Number.isFinite(prompt) && Number.isFinite(completion)) merged.total_tokens = prompt + completion;
  }
  // Estimation marker: once estimated, stays estimated (a real value never
  // downgrades an estimate to authoritative).
  if (prev.estimated === true) merged.estimated = true;
  return merged;
}

// Field-wise max-merge of two usage objects. Anthropic splits usage across
// events: message_start has real input+cache (output is a placeholder 1),
// message_delta has the real cumulative output (input/cache absent). Max keeps
// the meaningful value from each without clobbering. Idempotent for other
// providers that emit a single complete usage object.
//
// An estimate (estimateUsage(), flagged `estimated:true`) is a placeholder,
// never a floor: a real upstream report replaces it outright, and a late
// estimate never overwrites real usage. Max-merge only applies between partial
// REAL reports — otherwise the persisted prompt_tokens became
// max(estimate, real), inflated whenever the estimate exceeded reality.
export function mergeUsage(prev, next) {
  if (!prev) return next || null;
  if (!next) return prev;

  const prevEstimated = prev.estimated === true;
  const nextEstimated = next.estimated === true;

  if (prevEstimated !== nextEstimated) {
    if (nextEstimated) {
      // A late estimate never overwrites real usage. It still supplies the
      // token counts when the real report carries none (Kiro meters in credits
      // only), because then the estimate is the only count there is.
      if (!hasTokenCounts(prev)) return mergeTokenCounts(prev, next);
      return prev;
    }
    // prev was the estimate; the real report replaces its token counts — unless
    // it carries none, in which case the estimate still supplies them.
    if (!hasTokenCounts(next)) return mergeTokenCounts(next, prev);
    return replaceEstimatedTokens(prev, next);
  }

  const merged = { ...prev };
  const prevProvisional = isProvisionalOutput(prev);
  // Some Anthropic-compatible streams replace the initial total with uncached input when cache counts arrive.
  const preferNextInput = (next.cache_read_input_tokens != null || next.cache_creation_input_tokens != null)
    && prev.cache_read_input_tokens == null && prev.cache_creation_input_tokens == null && next.prompt_tokens != null;
  for (const [k, v] of Object.entries(next)) {
    // typeof NaN === "number" — guard with Number.isFinite so one malformed
    // chunk can't poison the whole accumulation (Math.max(x, NaN) is NaN).
    if (isNumber(v) && Number.isFinite(v)) {
      merged[k] = k === "prompt_tokens" && preferNextInput ? v : Math.max(isNumber(merged[k]) ? merged[k] : 0, v);
    } else if (k === "estimated" && isBoolean(v)) {
      // Estimation marker: once estimated, stays estimated (a real value never
      // downgrades an estimate to authoritative).
      merged[k] = merged[k] === true || v === true;
    } else if (v && isObject(v)) {
      merged[k] = v; // nested details objects: take latest
    } else if (isString(v) && k === "kiro_credit_unit") {
      merged[k] = v; // Kiro credit unit label: take latest
    }
  }
  if (prevProvisional && finalOutputReceipts.has(next)) {
    // The final receipt replaces the placeholder, even when it is lower.
    merged.completion_tokens = next.completion_tokens;
    return merged;
  }
  return prevProvisional || isProvisionalOutput(next) ? mark(provisionalOutputUsage, merged) : merged;
}

/**
 * Estimate input tokens from request body
 * Calculate total body size for more accurate estimation
 */
export function estimateInputTokens(body) {
  if (!body || !isObject(body)) return 0;

  try {
    // Calculate total body size (includes messages, tools, system, thinking config, etc.)
    const bodyStr = JSON.stringify(body);
    const totalChars = bodyStr.length;

    // Estimate: ~4 chars per token (rough average across all tokenizers)
    return Math.ceil(totalChars / 4);
  } catch (err) {
    // Fallback if stringify fails
    return 0;
  }
}

/**
 * Estimate output tokens from content length
 */
export function estimateOutputTokens(contentLength) {
  if (!contentLength || contentLength <= 0) return 0;
  return Math.max(1, Math.floor(contentLength / 4));
}

/**
 * Format usage object based on target format
 * @param {number} inputTokens - Input/prompt tokens
 * @param {number} outputTokens - Output/completion tokens
 * @param {string} targetFormat - Target format from FORMATS
 */
export function formatUsage(inputTokens, outputTokens, targetFormat) {
  // Claude format uses input_tokens/output_tokens
  if (targetFormat === FORMATS.CLAUDE) {
    return addBufferToUsage({
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated: true
    });
  }

  // Default: OpenAI format (works for openai, gemini, responses, etc.)
  return addBufferToUsage({
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    estimated: true
  });
}

/**
 * Estimate full usage when provider doesn't return it
 * @param {object} body - Request body for input token estimation
 * @param {number} contentLength - Content length for output token estimation
 * @param {string} targetFormat - Target format from FORMATS constant
 */
export function estimateUsage(body, contentLength, targetFormat = FORMATS.OPENAI) {
  return formatUsage(
    estimateInputTokens(body),
    estimateOutputTokens(contentLength),
    targetFormat
  );
}

/**
 * Character length of a string value. Non-strings contribute nothing.
 * @param {unknown} value
 * @returns {number}
 */
function textLength(value) {
  return isString(value) ? value.length : 0;
}

/**
 * Character length of a tool payload. A string is counted as written; any
 * other value is measured from its JSON form.
 * @param {unknown} value
 * @returns {number}
 */
function payloadLength(value) {
  if (isString(value)) return value.length;
  try { return JSON.stringify(value ?? "").length; } catch { return 0; }
}

/**
 * Sum text lengths of a string or an array of content blocks.
 * @param {unknown} content
 * @returns {number}
 */
function contentLength(content) {
  if (isString(content)) return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, block) => sum + (isString(block) ? block.length : textLength(block?.text)), 0);
}

/**
 * Measure the generated output of a completed non-streaming response in
 * characters so a missing usage object can be estimated. Counts assistant
 * text, reasoning and tool-call payloads across the response dialects the
 * non-streaming handler emits (OpenAI Chat, Claude Messages, Responses,
 * Gemini candidates, Ollama).
 * @param {object} response - Client-shaped or provider response body.
 * @returns {number} Output length in characters, 0 when nothing measurable.
 */
export function measureResponseOutputLength(response) {
  if (!response || !isObject(response) || Array.isArray(response)) return 0;
  let total = 0;

  if (Array.isArray(response.choices)) {
    for (const choice of response.choices) {
      const message = choice?.message;
      if (!message || !isObject(message)) continue;
      total += contentLength(message.content) + textLength(message.reasoning_content) + textLength(message.reasoning);
      for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        total += textLength(call?.function?.name) + payloadLength(call?.function?.arguments);
      }
      if (message.function_call) {
        total += textLength(message.function_call.name) + payloadLength(message.function_call.arguments);
      }
    }
    return total;
  }
  if (response.type === "message" && Array.isArray(response.content)) {
    for (const block of response.content) {
      if (block?.type === "text") total += textLength(block.text);
      else if (block?.type === "thinking") total += textLength(block.thinking);
      else if (block?.type === "tool_use") total += textLength(block.name) + payloadLength(block.input);
    }
    return total;
  }
  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      if (item?.type === "message") total += contentLength(item.content);
      else if (item?.type === "reasoning") total += contentLength(item.summary);
      else if (item?.type === "function_call") total += textLength(item.name) + payloadLength(item.arguments);
    }
    return total;
  }
  const candidates = response.candidates ?? response.response?.candidates;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      const parts = candidate?.content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        total += textLength(part?.text);
        if (part?.functionCall) total += textLength(part.functionCall.name) + payloadLength(part.functionCall.args);
      }
    }
    return total;
  }
  if (response.message && isObject(response.message)) {
    const calls = response.message.tool_calls;
    return textLength(response.message.content) + (Array.isArray(calls) ? payloadLength(calls) : 0);
  }
  return textLength(response.response);
}

/**
 * Estimate usage for a successful non-streaming response whose provider sent
 * no usage object. The result is flagged `estimated: true`; reported usage
 * must always be preferred by the caller.
 * @param {object} requestBody - Request sent to the provider.
 * @param {object} response - Completed response body.
 * @returns {object} Estimated OpenAI-shaped usage.
 */
export function estimateNonStreamingUsage(requestBody, response) {
  return estimateUsage(requestBody, measureResponseOutputLength(response), FORMATS.OPENAI);
}

/**
 * Log verbose usage in green, including cache and reasoning fields; estimates are yellow.
 */
export function logUsage(provider, usage, model = null, connectionId = null, apiKey = null) {
  if (!usage || !isObject(usage)) return;

  // Console output moved to the unified "📊 done" line (streamingHandler). Kept as
  // a no-op hook so callers stay unchanged; usage persistence happens via saveUsageStats.
  if (!DEBUG_USAGE) return;

  const p = provider?.toUpperCase() || "UNKNOWN";

  // Support both formats:
  // - OpenAI: prompt_tokens, completion_tokens
  // - Claude: input_tokens, output_tokens
  const inTokens = usage?.prompt_tokens || usage?.input_tokens || 0;
  const outTokens = usage?.completion_tokens || usage?.output_tokens || 0;
  const accountPrefix = connectionId ? connectionId.slice(0, 8) + "..." : "unknown";

  let msg = `[${getTimeString()}] 📊 ${COLORS.green}[USAGE] ${p} | in=${inTokens} | out=${outTokens} | account=${accountPrefix}`;

  // Add estimated flag if present
  if (usage.estimated) {
    msg += ` ${COLORS.yellow}(estimated)${COLORS.green}`;
  }

  // Add cache info if present (unified from different formats)
  const cacheRead = usage.cache_read_input_tokens || usage.cached_tokens || usage.prompt_tokens_details?.cached_tokens;
  if (cacheRead) msg += ` | cache_read=${cacheRead}`;

  const cacheCreation = usage.cache_creation_input_tokens;
  if (cacheCreation) msg += ` | cache_create=${cacheCreation}`;

  const reasoning = usage.reasoning_tokens;
  if (reasoning) msg += ` | reasoning=${reasoning}`;

  console.log(msg + COLORS.reset);
}
