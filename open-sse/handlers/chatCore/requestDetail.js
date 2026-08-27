import { saveRequestUsage, appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { COLORS } from "../../utils/stream.js";
import { canonicalizeUsage } from "../../utils/usageTracking.js";
import { toOpenAIUsage } from "../../translator/concerns/usage.js";
import { isObject } from "../../../src/shared/utils/typeChecks.js";

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

  // Claude format
  if (responseBody.usage?.input_tokens !== undefined) {
    return {
      prompt_tokens: responseBody.usage.input_tokens || 0,
      completion_tokens: responseBody.usage.output_tokens || 0,
      cache_read_input_tokens: responseBody.usage.cache_read_input_tokens,
      cache_creation_input_tokens: responseBody.usage.cache_creation_input_tokens,
      cost_usd: responseBody.usage.cost_usd,
      cost_in_usd: responseBody.usage.cost_in_usd,
      cost_in_usd_ticks: responseBody.usage.cost_in_usd_ticks
    };
  }

  // OpenAI format
  if (responseBody.usage?.prompt_tokens !== undefined) {
    return {
      prompt_tokens: responseBody.usage.prompt_tokens || 0,
      completion_tokens: responseBody.usage.completion_tokens || 0,
      cached_tokens: responseBody.usage.prompt_tokens_details?.cached_tokens,
      reasoning_tokens: responseBody.usage.completion_tokens_details?.reasoning_tokens,
      cost_usd: responseBody.usage.cost_usd,
      cost_in_usd: responseBody.usage.cost_in_usd,
      cost_in_usd_ticks: responseBody.usage.cost_in_usd_ticks
    };
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
  let line = `DONE ${latency?.total ?? 0}ms${ttftStr} · ${inStr} · OUT ${outTok}`;
  if (model) line += ` · ${provider ? `${provider}/${model}` : model}`;
  if (Number.isFinite(u.kiro_credits) && u.kiro_credits >= 0) line += ` · ${Number(u.kiro_credits.toFixed(4))}cr`;
  if (sessionId) line += ` · sid:${String(sessionId).replace(/[^\x20-\x7e]/g, "").replace(/^(?:claude|antigravity):/, "").slice(0, 8)}`;
  return line;
}

/**
 * Persist normalized usage. A non-success status keeps billable accounting
 * without allowing persistence to complete an errored live session.
 */
export function saveUsageStats({ provider, model, tokens, connectionId, apiKey, endpoint, usageEventId, status, label = "USAGE", silent = false }) {
  if (!tokens || !isObject(tokens)) return;

  const providerNormalized = tokens.promptTokenCount !== undefined || tokens.totalTokenCount !== undefined ?
  toOpenAIUsage(tokens, "gemini") :
  tokens;

  // Canonicalize before deciding what to persist. Cache-only, reasoning-only,
  // total-only, cost-only, and zero-token successful requests are all valid
  // committed events even when their visible input/output counters are zero.
  const normalized = canonicalizeUsage(providerNormalized) || {
    prompt_tokens: tokens.prompt_tokens ?? tokens.input_tokens ?? 0,
    completion_tokens: tokens.completion_tokens ?? tokens.output_tokens ?? 0
  };
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
    tokens: normalized,
    timestamp: new Date().toISOString(),
    connectionId: connectionId || undefined,
    apiKey: apiKey || undefined,
    endpoint: endpoint || null,
    status: status || undefined,
    usageEventId: usageEventId || undefined
  }).catch(() => {});
}