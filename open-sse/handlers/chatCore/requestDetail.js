import { saveRequestUsage, appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { COLORS } from "../../utils/stream.js";
import { canonicalizeUsage, reasoningIsSubsetOfOutput } from "../../utils/usageTracking.js";
import { toOpenAIUsage } from "../../translator/concerns/usage.js";
import { isNumber, isObject } from "../../../src/shared/utils/typeChecks.js";

const OPTIONAL_PARAMS = [
"temperature", "top_p", "top_k",
"max_tokens", "max_completion_tokens",
"thinking", "reasoning", "enable_thinking",
"presence_penalty", "frequency_penalty",
"seed", "stop", "tools", "tool_choice",
"response_format", "prediction", "store", "metadata",
"n", "logprobs", "top_logprobs", "logit_bias",
"user", "parallel_tool_calls"];


export function extractRequestConfig(body, stream) {
  const config = { messages: body.messages || [], model: body.model, stream };
  for (const param of OPTIONAL_PARAMS) {
    if (body[param] !== undefined) config[param] = body[param];
  }
  return config;
}

export function extractUsageFromResponse(responseBody) {
  if (!responseBody || !isObject(responseBody)) return null;

  const responseUsage = responseBody.usage;
  if (responseUsage?.input_tokens !== undefined || responseUsage?.prompt_tokens !== undefined) {
    // DeepSeek's OpenAI-shaped JSON reports cache hits as an inclusive flat
    // count. Existing cache fields take precedence, including a reported zero.
    const flatCache = responseUsage.prompt_cache_hit_tokens;
    const details = responseUsage.prompt_tokens_details ?? responseUsage.input_tokens_details;
    const useFlatCache = responseUsage.prompt_tokens !== undefined &&
      responseUsage.cached_tokens == null && details?.cached_tokens == null &&
      responseUsage.cache_read_input_tokens === undefined &&
      (responseUsage.cache_creation_input_tokens === undefined || details?.cache_creation_tokens !== undefined) &&
      isNumber(flatCache) && Number.isFinite(flatCache) && flatCache >= 0;
    const canonical = canonicalizeUsage(useFlatCache ? { ...responseUsage, cached_tokens: flatCache } : responseUsage);
    // OpenAI-shaped usage counts reasoning inside the output count, but a few
    // OpenAI-compatible upstreams (xAI) report it on top instead.
    if (canonical && !reasoningIsSubsetOfOutput(responseUsage)) {
      canonical.reasoning_included_in_output = 0;
    }
    return canonical;
  }

  // Ollama non-stream bodies put prompt_eval_count / eval_count /
  // prompt_eval_cached_count at the top level (not under `usage`).
  // toOpenAIUsage("ollama") keeps prompt cache-INCLUSIVE, clamps cached to
  // prompt, and surfaces prompt_tokens_details.cached_tokens when valid
  // (https://docs.ollama.com/api/usage).
  if (responseBody.prompt_eval_count !== undefined || responseBody.eval_count !== undefined) {
    return toOpenAIUsage(responseBody, "ollama");
  }

  // Gemini / Antigravity format. Antigravity wraps the native Gemini response
  // under `response`, so usage can be either top-level or nested.
  const usageMetadata = responseBody.usageMetadata || responseBody.response?.usageMetadata;
  if (usageMetadata) {
    return toOpenAIUsage(usageMetadata, "gemini");
  }

  return null;
}

export function buildRequestDetail(base, overrides = {}) {
  return {
    provider: base.provider || "unknown",
    model: base.model || "unknown",
    connectionId: base.connectionId || undefined,
    timestamp: new Date().toISOString(),
    latency: base.latency || { ttft: 0, total: 0 },
    tokens: base.tokens || { prompt_tokens: 0, completion_tokens: 0 },
    request: base.request,
    providerRequest: base.providerRequest || null,
    providerResponse: base.providerResponse || null,
    response: base.response || {},
    pxpipe: base.pxpipe || undefined,
    status: base.status || "success",
    ...overrides
  };
}

/**
 * Build the unified "done" summary line: total latency, optional TTFT, input
 * tokens (with cache read/creation breakdown when present), and output tokens.
 * Upstream PR #3111 appends optional route, finite Kiro-credit, and session
 * telemetry after the legacy text without changing that text when absent.
 * Accepted usage fields: `prompt_tokens`/`input_tokens`, `completion_tokens`/
 * `output_tokens`, `cache_read_input_tokens`/`cached_tokens` /
 * `prompt_tokens_details.cached_tokens`, and `cache_creation_input_tokens`.
 * @param {object} params
 * @param {object} [params.usage] - Usage object using the field names above.
 * @param {{ttft?: number, total?: number}} [params.latency] - Latency in ms.
 * @param {string} [params.provider] - Resolved provider id.
 * @param {string} [params.model] - Resolved model id.
 * @param {string} [params.sessionId] - Resolved provider conversation id; known scope removed and printable prefix logged.
 * @returns {string} `DONE <total>ms[ · TTFT <ms>] · IN <n>[(CACHE …)] · OUT <n>` plus optional telemetry.
 */
export function formatDoneLine({ usage, latency, provider, model, sessionId }) {
  const u = usage || {};
  const inTok = u.prompt_tokens ?? u.input_tokens ?? 0;
  const outTok = u.completion_tokens ?? u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? u.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
  const cacheCreate = u.cache_creation_input_tokens ?? 0;
  let inStr = `IN ${inTok}`;
  if (cacheRead || cacheCreate) {
    const parts = [];
    if (cacheRead) parts.push(`↻${cacheRead}`);
    if (cacheCreate) parts.push(`+${cacheCreate}`);
    inStr += ` (CACHE ${parts.join(" ")})`;
  }
  const ttftStr = latency?.ttft ? ` · TTFT ${latency.ttft}ms` : "";
  // Same marker as logUsage(): a count we guessed must not read like a measured one.
  const estimatedStr = u.estimated === true ? " (estimated)" : "";
  let line = `DONE ${latency?.total ?? 0}ms${ttftStr} · ${inStr} · OUT ${outTok}${estimatedStr}`;
  if (model) line += ` · ${provider ? `${provider}/${model}` : model}`;
  if (Number.isFinite(u.kiro_credits) && u.kiro_credits >= 0) line += ` · ${Number(u.kiro_credits.toFixed(4))}cr`;
  if (sessionId) line += ` · sid:${String(sessionId).replace(/[^\x20-\x7e]/g, "").replace(/^(?:claude|antigravity):/, "").slice(0, 8)}`;
  return line;
}

/**
 * The ledger rejects a total other than input + output, and chat writes are not
 * strict, so a disagreeing provider would lose the whole row. A larger total is
 * output missing from completion_tokens and joins it once, priced at the output
 * rate. Gemini is the known case: totalTokenCount includes thoughtsTokenCount while
 * candidatesTokenCount excludes it, and the thoughts stay reasoning_tokens, so that
 * subset keeps the reasoning rate. Excess from other fields (for example tool-use
 * prompt tokens) is also priced as output. A smaller total is ignored with a warning.
 * The reported value stays in meta.
 */
function reconcileReportedTotal(usage) {
  const expected = Math.ceil(usage.prompt_tokens ?? 0) + Math.ceil(usage.completion_tokens ?? 0);
  const reported = usage.total_tokens === undefined ? expected : Math.ceil(usage.total_tokens);
  if (reported === expected) return { tokens: usage };
  if (reported < expected) console.warn(`[USAGE] reported total_tokens ${reported} is below input + output ${expected}; using the components`);
  const total = Math.max(reported, expected);
  const completion = Math.ceil(usage.completion_tokens ?? 0) + total - expected;
  const folded = { ...usage, completion_tokens: completion, total_tokens: total };
  // Folding the excess into completion_tokens puts the reasoning slice back
  // INSIDE the output count, so the additive marker no longer applies.
  if (folded.reasoning_included_in_output === 0) {
    const reasoning = Number(folded.reasoning_tokens) || 0;
    if (reasoning > 0 && reasoning <= completion) delete folded.reasoning_included_in_output;
  }
  return {
    tokens: folded,
    reportedTotalTokens: usage.total_tokens,
  };
}

/**
 * Persist normalized usage. A non-success status keeps billable accounting
 * without allowing persistence to complete an errored live session.
 * billingEpoch is the original admission stamp, including pre-cutover null.
 * Never read the current epoch here: the ledger rejects stale in-flight usage.
 */
export function saveUsageStats({ provider, model, tokens, connectionId, apiKey, apiKeyId = null, endpoint, usageEventId, billingEpoch, status, latency, label = "USAGE", silent = false, comboId = null, comboName = null, usageAttribution = null }) {
  if (!tokens || !isObject(tokens)) return;

  const providerNormalized = tokens.promptTokenCount !== undefined || tokens.totalTokenCount !== undefined ?
  toOpenAIUsage(tokens, "gemini") :
  tokens;

  // Canonicalize before deciding what to persist. Cache-only, reasoning-only,
  // total-only, cost-only, and zero-token successful requests are all valid
  // committed events even when their visible input/output counters are zero.
  const { tokens: normalized, reportedTotalTokens } = reconcileReportedTotal(canonicalizeUsage(providerNormalized) || {
    prompt_tokens: tokens.prompt_tokens ?? tokens.input_tokens ?? 0,
    completion_tokens: tokens.completion_tokens ?? tokens.output_tokens ?? 0
  });
  const inTokens = normalized.prompt_tokens ?? 0;
  const outTokens = normalized.completion_tokens ?? 0;

  if (!silent) {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const accountSuffix = connectionId ? ` | account=${connectionId.slice(0, 8)}...` : "";
    console.log(`${COLORS.green}[${time}] 📊 [${label}] ${provider.toUpperCase()} | in=${inTokens} | out=${outTokens}${accountSuffix}${COLORS.reset}`);
  }

  saveRequestUsage({
    provider: provider || "unknown",
    model: model || "unknown",
    modality: "chat",
    tokens: normalized,
    ...(reportedTotalTokens === undefined ? null : { meta: { reportedTotalTokens } }),
    timestamp: new Date().toISOString(),
    connectionId: connectionId || undefined,
    apiKey: apiKey || undefined,
    // The stable key id of the admitted key. It travels with the row so the
    // request stays attached to the key's budgets when its secret changes.
    apiKeyId: apiKeyId || undefined,
    usageAttribution,
    endpoint: endpoint || null,
    // Timing rides along with the usage row so the dashboard can report
    // duration and throughput per model/account/key without a second lookup.
    // A handler with no measurement leaves these 0, which reads as "not timed".
    latencyMs: latency?.total || 0,
    ttftMs: latency?.ttft || 0,
    status: status || undefined,
    usageEventId: usageEventId || undefined,
    billingEpoch,
    // #747: set only for requests dispatched through a combo. Historic rows
    // (and requests with no combo) stay NULL; never inferred/backfilled.
    comboId: comboId || undefined,
    comboName: comboName || undefined
  }).catch(() => {});
}
