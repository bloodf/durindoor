// Model capabilities — what each model can read/do beyond plain text.
//
// Fallback order (first match wins), result merged over DEFAULT_CAPABILITIES:
//   1. PROVIDER_CAPABILITIES[provider][model]  — provider-specific override
//   2. MODEL_CAPABILITIES[model]               — canonical exact id (handles exceptions)
//   3. PATTERN_CAPABILITIES                     — glob match, ordered specific -> generic
//   4. DEFAULT_CAPABILITIES                     — safe floor (always returned)
//
// ── HOW TO ADD / UPDATE A MODEL ──────────────────────────────────────
// Authoritative data source: https://models.dev/api.json (145 providers, 4000+
// models, MIT). Each model exposes the exact fields we map below:
//   modalities.input  ["text","image","pdf","audio","video"] -> vision / pdf / audioInput / videoInput
//   modalities.output ["text","image","audio"]               -> imageOutput / audioOutput
//   reasoning   -> reasoning      tool_call    -> tools
//   limit.context -> contextWindow   limit.output -> maxOutput
// Look up the model id, then:
//   • If a PATTERN below already covers it correctly -> nothing to do.
//   • If it is an exception (pattern would mis-match) -> add an exact entry to
//     MODEL_CAPABILITIES (only the fields that differ from DEFAULT).
//   • If a whole new family -> add an ordered PATTERN (specific before generic).
// NOTE: models.dev has NO "search" flag (web search is a runtime tool, not a
// model spec); set `search` from vendor docs (Claude 4.x+, GPT-5.x/4o, Gemini
// 2.0+, Grok, Perplexity). Verify with: curl -s https://models.dev/api.json

import { matchPattern } from "./pricing.js";
import {
  KIRO_GPT_5_6_FAMILY,
  buildKiroGpt56Variants,
} from "./models/kiroVariants.js";
import { normalizeModelId } from "./models/schema.js";
import REGISTRY from "./registry/index.js";


/**
 * Safe floor — every resolved result is merged over this so consumers
 * never need null-checks. Most modern LLMs meet these limits.
 */
export const DEFAULT_CAPABILITIES = {
  // input modalities
  vision: false,        // read images
  pdf: false,           // read PDF / documents
  audioInput: false,    // read audio
  videoInput: false,    // read video
  // output modalities
  imageOutput: false,   // generate images
  audioOutput: false,   // generate audio
  // features
  search: false,        // built-in web search tool / grounding
  tools: true,          // function / tool calling
  reasoning: false,     // thinking / reasoning
  // thinking wire format (only meaningful when reasoning:true). null → derive from transport.format.
  // enum: openai|commandcode|claude-adaptive|claude-budget|gemini-level|gemini-budget|zai|qwen|deepseek|kimi|minimax|hunyuan|step|kiro
  thinkingFormat: null,
  thinkingCanDisable: true,  // false → model cannot turn thinking off (clamp to min instead of disable)
  thinkingRange: null,       // { min, max } for budget formats; null = no clamp
  // limits (tokens)
  contextWindow: 200000,
  maxOutput: 64000,
};

// User-added model metadata can carry dashboard service kinds instead of the
// runtime capability names used here. Map those typed model kinds into input /
// output capabilities so custom vision models are not treated as text-only.
const SERVICE_KIND_CAPABILITIES = {
  imageToText: { vision: true },
  image: { imageOutput: true },
  stt: { audioInput: true },
  tts: { audioOutput: true },
  embedding: { tools: false },
};

export function capabilitiesFromServiceKind(kind) {
  return SERVICE_KIND_CAPABILITIES[kind] || null;
}


/** Providers that publish an output default, but no enforceable ceiling. */
function hasUnpublishedOutput(provider, model) {
  if (typeof model !== "string") return false;
  const id = model.toLowerCase();
  if ((provider === "xai" && id.includes("grok"))
    || (provider === "grok-cli" && (id.includes("grok-build") || id.includes("grok-composer")))) return true;
  if ((provider === "kimi" || provider === "kimi-coding" || provider === "kimi-coding-apikey" || provider === "kmc" || provider === "kmca")
    && id.includes("kimi-k2")) return true;
  if ((provider === "cloudflare-ai" || provider === "cf") && id.startsWith("@cf/")) return true;
  if (provider === "ollama-local" && id === "llama3.2:1b") return true;
  return provider === "nvidia" && id === "moonshotai/kimi-k2.6";
}

/**
 * Canonical exact-id overrides — used for exceptions that patterns would
 * otherwise mis-match. Only declare deltas vs DEFAULT.
 */
export const MODEL_CAPABILITIES = {
  /**
   * Live probe 2026-08-13: GET https://api.kimi.com/coding/v1/models returned
   * `{"id":"k3",...,"context_length":1048576,...}`. Keep the exact integer;
   * this is not an inferred expansion of Moonshot's "1M" documentation label.
   */
  "kimi-k3": { vision: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 262144 },
  // Claude Opus 5: native 1M context window + adaptive thinking.
  "claude-opus-5":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  // Claude 4.6/4.7/4.8 and Kiro Sonnet 5 have 1M context + adaptive thinking (override generic claude pattern)
  "claude-opus-4.6":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.7":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-7":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.8":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-6":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-8":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.8-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-8-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  // 4.6/4.7 thinking variants keep the 1M window; without these exact rows the
  // dash forms fall to the generic *claude*opus* budget pattern (200K default).
  "claude-opus-4.6-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-6-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.7-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-7-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  // Kiro exposes -agentic / -thinking-agentic variants of Opus 4.7/4.8 (registry
  // kiro.js). Without exact rows the dot forms hit *claude*opus-4.7|4.8* (which
  // carry no limits → 200K/64K floor) and the dash forms fall further to the
  // generic *claude*opus* budget pattern. Both keep the 1M adaptive contract.
  "claude-opus-4.7-agentic":          { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-7-agentic":          { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.7-thinking-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-7-thinking-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.8-agentic":          { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-8-agentic":          { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.8-thinking-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-8-thinking-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-4.6": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-4-6": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-thinking-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  /** Anthropic Models API 2026-08-13 publishes exact per-ID input and output limits. */
  "claude-opus-4-5-20251101": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget", contextWindow: 200000, maxOutput: 64000 },
  "claude-sonnet-4-5-20250929": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget", contextWindow: 1000000, maxOutput: 64000 },

  // Gemini image-gen / OpenAI image / xai image variants
  "gpt-image-1":       { imageOutput: true, tools: false },

  /** Z.ai documents GLM-4.6V's 128K-token context and 32,768-token output limit. */
  "glm-4.6v":          { vision: true, reasoning: true, thinkingFormat: "zai", contextWindow: 128000, maxOutput: 32768 },
  /**
   * Z.ai's primary model pages document these limits. The 2026-08-13 Models
   * APIs confirmed all text IDs below except the separately-routed vision ID.
   * https://docs.z.ai/guides/llm/glm-5.3
   * https://docs.z.ai/guides/llm/glm-5.2
   * https://docs.z.ai/guides/llm/glm-5.1
   * https://docs.z.ai/guides/llm/glm-5
   * https://docs.z.ai/guides/llm/glm-5-turbo
   * https://docs.z.ai/guides/llm/glm-4.7
   * https://docs.z.ai/guides/llm/glm-4.6
   * https://docs.z.ai/guides/llm/glm-4.5
   */
  "glm-5.3":           { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 131072 },
  "glm-5.2":           { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 131072 },
  "glm-5.1":           { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 131072 },
  "glm-5":             { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 131072 },
  "glm-5-turbo":       { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 131072 },
  "glm-4.7":           { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 131072 },
  "glm-4.7-flashx":    { reasoning: true, thinkingFormat: "zai", contextWindow: 131072 },
  "glm-4.6":           { reasoning: true, thinkingFormat: "zai", contextWindow: 200000, maxOutput: 131072 },
  // GLM-4.5 family publishes a 128K context; keep output unset because its 96K label is not an exact integer.
  "glm-4.5":           { reasoning: true, thinkingFormat: "zai", contextWindow: 131072, maxOutput: undefined },
  "glm-4.5-air":       { reasoning: true, thinkingFormat: "zai", contextWindow: 131072, maxOutput: undefined },
  "glm-4-32b-0414-128k": { reasoning: true, thinkingFormat: "zai", contextWindow: 131072 },

  // Qwen plain coder/text (no vision) — registry "vision-model" / "coder-model" aliases
  "vision-model":      { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000 },
  "coder-model":       { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000 },

  /**
   * Current xAI API catalog. Keep exact ids: Grok windows differ within the
   * same family, and reasoning can be disabled only on grok-4.3. xAI documents
   * 128K as the default generated-token budget but explicitly allows larger
   * values; the ceiling is unpublished, so leave maxOutput unset.
   */
  "grok-4.6": { vision: true, tools: true, reasoning: true, search: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 500000 },
  "grok-4.5": { vision: true, tools: true, reasoning: true, search: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 500000 },
  "grok-4.3": { vision: true, tools: true, reasoning: true, search: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000 },
  "grok-4.20-0309-reasoning": { vision: true, tools: true, reasoning: true, search: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000 },
  "grok-4.20-0309-non-reasoning": { vision: true, tools: true, reasoning: true, search: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000 },
  "grok-4.20-multi-agent-0309": { vision: true, tools: true, reasoning: true, search: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000 },
  "grok-build-0.1": { vision: true, tools: true, reasoning: true, search: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 262144 },
  "grok-code-fast-1": { vision: true, tools: true, reasoning: true, search: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 262144 },

  // Grok CLI windows come from decolua/9router#2502's HAR-captured /v1/models; xAI documents 128K as a default, not an output ceiling.
  "grok-composer-2.5-fast": { vision: true, reasoning: false, search: false, thinkingFormat: null, contextWindow: 200000 },
  "grok-build":            { vision: true, reasoning: false, search: false, thinkingFormat: null, contextWindow: 256000 },
};

/**
 * Provider-specific capability overrides. Keyed by provider alias/id.
 */
const KIRO_GPT_5_6_PROVIDER_CAPS = Object.fromEntries(
  KIRO_GPT_5_6_FAMILY.flatMap(buildKiroGpt56Variants).map((m) => [m.id, {
    vision: true, reasoning: true, search: true,
    thinkingFormat: "kiro", contextWindow: m.contextLength, maxOutput: 32000,
  }])
);

// Direct OpenAI GPT-5.4/5.5/5.6 surfaces override the generic *gpt-5* 400K
// pattern (1.05M context / 128K max output — developers.openai.com model docs
// reprice >272K input prompts for "models with a 1.05M context window"). Codex
// and its CX alias get the same base values, plus Codex-specific review and
// ultra ids. Mini/nano tiers are NOT 1.05M and keep the generic pattern.
const DIRECT_GPT_5_5_6_CAPS = {
  "gpt-5.4":              { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.5":              { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6":              { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-sol":          { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-terra":        { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-luna":         { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
};

/**
 * ChatGPT Codex catalog reports the currently served context_window but no
 * output ceiling. Exact IDs prevent the generic GPT-5 patterns from advertising
 * direct-API limits on the OAuth Codex surface.
 */
const CODEX_GPT_CAPS = {
  ...DIRECT_GPT_5_5_6_CAPS,
  "gpt-5.5":                    { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: undefined },
  "gpt-5.5-review":             { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: undefined },
  "gpt-5.5-medium":             { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: undefined },
  "gpt-5.5-high":               { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: undefined },
  "gpt-5.5-xhigh":              { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: undefined },
  "gpt-5.4":                    { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: undefined },
  "gpt-5.4-review":             { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: undefined },
  "gpt-5.4-mini":               { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: undefined },
  "gpt-5.4-mini-review":        { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: undefined },
  "gpt-5.3-codex-spark":        { reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 128000, maxOutput: undefined },
  "gpt-5.3-codex-spark-review": { reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 128000, maxOutput: undefined },
  "codex-auto-review":          { reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: undefined },
  "gpt-5.6-sol-review":         { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-sol-ultra":          { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-terra-review":       { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-luna-review":        { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
};

// Native MiniMax hosts (platform.minimax.io / minimaxi.com) serve M3 at the
// full 1M-token context with a 131,072 recommended output cap. Third-party
// hosts (Fireworks, NIM, OpenRouter-style resellers) only guarantee the 512K
// minimum, which is what the generic *minimax-m3* pattern carries — so the
// native providers need an explicit override rather than the conservative row.
const MINIMAX_M3_NATIVE_CAPS = {
  "MiniMax-M3": { vision: true, videoInput: true, reasoning: true, thinkingFormat: "minimax", contextWindow: 1000000, maxOutput: 131072 },
};

/**
 * Provider-served limits override trained-model limits. Cloudflare publishes
 * these context windows but no generated-token ceilings (its 256 value is a
 * default), so maxOutput stays explicitly unset.
 */
const CLOUDFLARE_CAPS = {
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 80000, maxOutput: undefined },
  "@cf/moonshotai/kimi-k2.5": { vision: true, reasoning: true, thinkingFormat: "kimi", contextWindow: 256000, maxOutput: undefined },
  "@cf/moonshotai/kimi-k2.6": { vision: true, reasoning: true, thinkingFormat: "kimi", contextWindow: 262144, maxOutput: undefined },
  "@cf/zai-org/glm-4.7-flash": { reasoning: true, thinkingFormat: "zai", contextWindow: 131072, maxOutput: undefined },
  "@cf/qwen/qwq-32b": { reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 24000, maxOutput: undefined },
  "@cf/meta/llama-3.2-1b-instruct": { contextWindow: 60000, maxOutput: undefined },
  "@cf/meta/llama-3.2-3b-instruct": { contextWindow: 80000, maxOutput: undefined },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { contextWindow: 24000, maxOutput: undefined },
  "@cf/openai/gpt-oss-120b": { reasoning: true, thinkingFormat: "openai", contextWindow: 128000, maxOutput: undefined },
  "@cf/openai/gpt-oss-20b": { reasoning: true, thinkingFormat: "openai", contextWindow: 128000, maxOutput: undefined },
  "@cf/google/gemma-2b-it-lora": { contextWindow: 8192, maxOutput: undefined },
  "@cf/google/gemma-7b-it-lora": { contextWindow: 3500, maxOutput: undefined },
  "@cf/google/gemma-4-26b-a4b-it": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 256000, maxOutput: undefined },
  "@cf/meta/llama-guard-3-8b": { contextWindow: 131072, maxOutput: undefined },
  "@cf/meta/llama-3.1-8b-instruct-fp8": { contextWindow: 32000, maxOutput: undefined },
  "@cf/meta/llama-3.2-11b-vision-instruct": { vision: true, contextWindow: 128000, maxOutput: undefined },
  "@cf/meta/llama-4-scout-17b-16e-instruct": { vision: true, contextWindow: 131000, maxOutput: undefined },
  "@cf/meta-llama/llama-2-7b-chat-hf-lora": { contextWindow: 8192, maxOutput: undefined },
  "@cf/mistral/mistral-7b-instruct-v0.2-lora": { contextWindow: 15000, maxOutput: undefined },
  "@cf/moonshotai/kimi-k2.7-code": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: undefined },
  "@cf/ibm-granite/granite-4.0-h-micro": { contextWindow: 131000, maxOutput: undefined },
  "@cf/zai-org/glm-5.2": { reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: undefined },
  "@cf/nvidia/nemotron-3-120b-a12b": { reasoning: true, thinkingFormat: "openai", contextWindow: 256000, maxOutput: undefined },
  "@cf/aisingapore/gemma-sea-lion-v4-27b-it": { contextWindow: 128000, maxOutput: undefined },
  "@cf/qwen/qwen3-30b-a3b-fp8": { reasoning: true, thinkingFormat: "openai", contextWindow: 32768, maxOutput: undefined },
  /** Embedding models have input windows only; null means Cloudflare publishes no usable integer. */
  "@cf/baai/bge-m3": { tools: false, contextWindow: 60000, maxOutput: null },
  "@cf/qwen/qwen3-embedding-0.6b": { tools: false, contextWindow: 8192, maxOutput: null },
  "@cf/pfnet/plamo-embedding-1b": { tools: false, contextWindow: null, maxOutput: null },
  "@cf/baai/bge-small-en-v1.5": { tools: false, contextWindow: null, maxOutput: null },
  "@cf/baai/bge-base-en-v1.5": { tools: false, contextWindow: 153600, maxOutput: null },
  "@cf/google/embeddinggemma-300m": { tools: false, contextWindow: null, maxOutput: null },
  "@cf/baai/bge-large-en-v1.5": { tools: false, contextWindow: null, maxOutput: null },
};

/** Auto-routing aliases have no fixed limits; their selected target owns them. */
const VARIABLE_TARGET_CAPS = { contextWindow: null, maxOutput: null };
/**
 * Token Plan's V2.5 routes are text-only; each row stays independent because
 * the Claude alias uses Anthropic thinking fields and the others use DeepSeek.
 */
const XIAOMI_TOKENPLAN_CAPABILITIES = {
  "mimo-v2.5-pro": { vision: false, audioInput: false, videoInput: false, reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 131072 },
  "mimo-v2.5-pro-claude": { vision: false, audioInput: false, videoInput: false, reasoning: true, thinkingFormat: "claude-budget", thinkingCanDisable: true, contextWindow: 200000, maxOutput: 64000 },
  "mimo-v2.5": { vision: false, audioInput: false, videoInput: false, reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 131072 },
};

export const PROVIDER_CAPABILITIES = {
  // Direct OpenAI GPT-5.5/5.6 family and Codex/CX aliases expose 1.05M context
  // window and 128K max output, overriding the generic *gpt-5* 400K fallback pattern.
  openai: DIRECT_GPT_5_5_6_CAPS,
  codex: CODEX_GPT_CAPS,
  cx: CODEX_GPT_CAPS,
  "cloudflare-ai": CLOUDFLARE_CAPS,
  cf: CLOUDFLARE_CAPS,
  "xiaomi-tokenplan": XIAOMI_TOKENPLAN_CAPABILITIES,
  xmtp: XIAOMI_TOKENPLAN_CAPABILITIES,
  // Ollama's trained 131,072-token window is not its served window. The local
  // daemon's /api/ps reports 4,096 for llama3.2:1b; /api/tags exposes no num_ctx.
  "ollama-local": {
    "llama3.2:1b": { contextWindow: 4096, maxOutput: undefined },
  },
  cursor: { default: VARIABLE_TARGET_CAPS },
  cu: { default: VARIABLE_TARGET_CAPS },
  "9router": { auto: VARIABLE_TARGET_CAPS },
  nr: { auto: VARIABLE_TARGET_CAPS },
  commandcode: {
    "meta/muse-spark-1.2-contributor": {
      reasoning: true,
      thinkingFormat: "commandcode",
      thinkingCanDisable: false,
      maxOutput: 32768,
    },
  },
  // Native MiniMax endpoints serve the full 1M M3 window (see MINIMAX_M3_NATIVE_CAPS).
  minimax: MINIMAX_M3_NATIVE_CAPS,
  "minimax-cn": MINIMAX_M3_NATIVE_CAPS,
  // Poolside Laguna — OpenAI-compatible, all reasoning-capable (262K context, 32K max output).
  poolside: {
    "laguna-s-2.1":  { reasoning: true, thinkingFormat: "openai", contextWindow: 262000, maxOutput: 32000 },
    "laguna-xs-2.1": { reasoning: true, thinkingFormat: "openai", contextWindow: 262000, maxOutput: 32000 },
    "laguna-m.1":    { reasoning: true, thinkingFormat: "openai", contextWindow: 262000, maxOutput: 32000 },
  },
  // Kiro GPT-5.6 family (decolua/9router#2596): 1.05M context, Kiro-native
  // thinking (<thinking_mode> prefix), vision + search. thinkingFormat "kiro"
  // keeps applyThinking from adding a stray top-level reasoning_effort to the
  // CodeWhisperer payload. One shared descriptor spread over every
  // generated synthetic variant id (base/-thinking/-agentic/-thinking-agentic)
  // so the 12 keys can never drift from the catalog in providerModels.js.
  // Exposed under both the provider id ("kiro") and its short alias ("kr") —
  // callers pass either.
  kiro: KIRO_GPT_5_6_PROVIDER_CAPS,
  kr: KIRO_GPT_5_6_PROVIDER_CAPS,
  // Devin cloud-agent (OmniRoute #6894): single placeholder model, not chat-capable.
  devin: { devin: { tools: false } },
  // ClinePass proxies through Vercel's OpenAI Chat Completions API, which only
  // accepts reasoning.effort in {none,minimal,low,medium,high,xhigh}. Force
  // "openai" so thinkingUnified.js emits valid Vercel enum values. Keys are the
  // WIRE ids (`cline-pass/...`) because transformRequest → ensureThinkingBudget
  // receives getModelUpstreamId()'s cleanUpstreamModel, not the short registry id.
  // Source: decolua/9router#2332 @ 005d970f49.
  clinepass: {
    "cline-pass/deepseek-v4-pro":   { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 50000 },
    "cline-pass/deepseek-v4-flash": { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 50000 },
  },
  // Kimi Web (www.kimi.com) consumer chat — OpenAI-shaped transport. The
  // `k2d6-thinking` tier supports reasoning via the OpenAI `reasoning_effort`
  // wire format and can be disabled (`reasoning_effort: "none"`); the plain
  // `k2d6` tier has no reasoning. Both tiers are toolless until tool mapping
  // exists — the executor folds only system/user/assistant text and never
  // forwards tools/tool_choice or emits tool_calls, so combo or
  // `tool_choice:"required"` routing must not pick Kimi expecting a tool call.
  "kimi-web": {
    "k2d6": { tools: false },
    "k2d6-thinking": { tools: false, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true },
  },
  // ZenMux Free exposes text streaming through its Anthropic-compatible web
  // endpoint but does not return structured tool_use blocks.
  "zenmux-free": {
    "deepseek/deepseek-chat": { tools: false },
    "deepseek/deepseek-reasoner": { tools: false, reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 128000 },
    "deepseek/deepseek-v4-pro": { tools: false, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },
    "kuaishou/kat-coder-pro-v1-free": { tools: false },
    "z-ai/glm-4.7-flash-free": { tools: false },
    "stepfun/step-3.5-flash-free": { tools: false },
    "inclusionai/ling-1t": { tools: false },
    "inclusionai/ling-mini-2.0": { tools: false },
    "inclusionai/ring-1t": { tools: false },
    "sapiens-ai/agnes-1.5-lite": { tools: false },
    "sapiens-ai/agnes-1.5-pro": { tools: false },
  },
  zmf: {
    "deepseek/deepseek-chat": { tools: false },
    "deepseek/deepseek-reasoner": { tools: false, reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 128000 },
    "deepseek/deepseek-v4-pro": { tools: false, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },
    "kuaishou/kat-coder-pro-v1-free": { tools: false },
    "z-ai/glm-4.7-flash-free": { tools: false },
    "stepfun/step-3.5-flash-free": { tools: false },
    "inclusionai/ling-1t": { tools: false },
    "inclusionai/ling-mini-2.0": { tools: false },
    "inclusionai/ring-1t": { tools: false },
    "sapiens-ai/agnes-1.5-lite": { tools: false },
    "sapiens-ai/agnes-1.5-pro": { tools: false },
  },

  // Fireworks AI — all models served via OpenAI-compatible API, so
  // thinkingFormat must be "openai" (overrides family-native patterns like
  // zai/deepseek/kimi/minimax/qwen that would produce wrong wire shapes).
  // vision derived from modalities.input, not attachment field.
  fireworks: {
    "accounts/fireworks/models/glm-5p2":                { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true,  contextWindow: 1048575, maxOutput: 131072 },
    "accounts/fireworks/routers/glm-5p2-fast":          { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true,  contextWindow: 1048575, maxOutput: 131072 },
    "accounts/fireworks/models/glm-5p1":                { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true,  contextWindow: 202800,  maxOutput: 131072 },
    "accounts/fireworks/routers/glm-5p1-fast":          { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true,  contextWindow: 202800,  maxOutput: 131072 },
    "accounts/fireworks/models/qwen3p7-plus":           { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true,  contextWindow: 262143, maxOutput: 65536 },
    "accounts/fireworks/models/minimax-m3":             { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 524287,  maxOutput: 512000 },
    "accounts/fireworks/models/minimax-m2p7":           { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 196607,  maxOutput: 196608 },
    "accounts/fireworks/models/kimi-k2p7-code":         { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true,  contextWindow: 262143, maxOutput: 262000 },
    "accounts/fireworks/routers/kimi-k2p7-code-fast":   { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true,  contextWindow: 262143, maxOutput: 262000 },
    "accounts/fireworks/models/kimi-k2p6":              { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true,  contextWindow: 262143, maxOutput: 262000 },
    "accounts/fireworks/routers/kimi-k2p6-turbo":       { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true,  contextWindow: 262143, maxOutput: 262000 },
    "accounts/fireworks/routers/kimi-k2p6-fast":        { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true,  contextWindow: 262143, maxOutput: 262000 },
    "accounts/fireworks/models/gpt-oss-120b":           { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 131071,  maxOutput: 32768 },
    "accounts/fireworks/models/gpt-oss-20b":            { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 131071,  maxOutput: 32768 },
    "accounts/fireworks/models/deepseek-v4-pro":        { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true,  contextWindow: 1048575, maxOutput: 384000 },
    "accounts/fireworks/models/deepseek-v4-flash":      { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true,  contextWindow: 1048575, maxOutput: 384000 },
  },

  // NVIDIA NIM is OpenAI-compatible → rejects MiniMax/GLM native `thinking` field.
  // Force openai reasoning_effort format for its reasoning models. #issue
  "nvidia": {
    /** Retired saved IDs stay OpenAI-shaped until the lifecycle gate returns 410. */
    "minimaxai/minimax-m2.7": { reasoning: false, contextWindow: 200000, maxOutput: 131072 },
    "deepseek-ai/deepseek-v4-pro": { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 65536 },
    "deepseek-ai/deepseek-v4-flash": { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 65536 },
    "minimaxai/minimax-m3": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 512000, maxOutput: 131072 },
    "z-ai/glm-5.2": { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 128000 },
    /** Upstream #3397: retain Flash limits under NVIDIA's replacement live ID. */
    "deepseek-ai/deepseek-v4-flash-0731": { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 65536 },
    // Moonshot publishes a 32,768 default, not a ceiling; do not clamp NVIDIA's route to an invented maximum.
    "moonshotai/kimi-k2.6": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: undefined },
    "meta/llama-3.2-11b-vision-instruct": { vision: true },
    "meta/llama-3.2-90b-vision-instruct": { vision: true },
    "mistralai/mistral-medium-3.5-128b": { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 },
    "nvidia/ising-calibration-1-35b-a3b": { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 },
    "nvidia/nemotron-3-nano-30b-a3b": { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 },
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": { vision: true, audioInput: true, reasoning: true, thinkingFormat: "openai", contextWindow: 128000 },
    "nvidia/nemotron-3-ultra-550b-a55b": { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 },
    "nvidia/nemotron-nano-12b-v2-vl": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 128000 },
    "nvidia/nvidia-nemotron-nano-9b-v2": { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 },
    "qwen/qwen3-next-80b-a3b-instruct": { reasoning: false, contextWindow: 262144 },
    "qwen/qwen3.5-122b-a10b": { vision: true, videoInput: true, reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: 65536 },
    "stepfun-ai/step-3.5-flash": { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 },
    "stepfun-ai/step-3.7-flash": { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 },
  },
  // CodeBuddy.cn — authoritative per-model metadata from the gateway's model
  // config (contextWindow=maxInputTokens, maxOutput=maxOutputTokens, vision=
  // supportsImages). Every model reasons via OpenAI-style reasoning_effort
  // (see registry thinkingFormat). `onlyReasoning` models can't turn thinking
  // off → thinkingCanDisable:false (clamped to minimal instead of disabled).
  "codebuddy-cn": {
    "glm-5.2":            { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 48000 },
    "glm-5.1":            { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "glm-5.0":            { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 48000 },
    "glm-5.0-turbo":      { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "glm-5v-turbo":       { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 38000 },
    "glm-4.7":            { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 48000 },
    "minimax-m3":         { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 512000, maxOutput: 48000 },
    "minimax-m2.7":       { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "kimi-k2.7":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 256000, maxOutput: 32000 },
    "kimi-k2.6":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 256000, maxOutput: 32000 },
    "kimi-k2.5":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 164000, maxOutput: 32000 },
    "hy3-preview":        { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 192000, maxOutput: 64000 },
    "deepseek-v4-pro":    { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 50000 },
    "deepseek-v4-flash":  { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 50000 },
    "deepseek-v3-2-volc": { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 96000, maxOutput: 32000 },
  },

  // OpenCode Zen — Big Pickle advertises reasoning in the registry but the
  // generic fallback did not read model-level supportsReasoning flags.
  "opencode-zen": {
    "big-pickle": { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true },
  },

  // Qianfan ERNIE multimodal models exposed as vision-capable chat models.
  qianfan: {
    "ernie-5.1": { vision: true },
    "ernie-5.0-thinking-latest": { vision: true, reasoning: true },
    "ernie-x1.1": { vision: true, contextWindow: 64000 },
  },

  // Reka Edge 2603 is a vision-capable model on an OpenAI-compatible surface.
  reka: {
    "reka-edge-2603": { vision: true },
  },

  // v0 models support image inputs through the Vercel Chat Completions API.
  "v0-vercel": {
    "v0-1.5-md": { vision: true },
    "v0-1.5-lg": { vision: true },
  },

  // SenseNova — SenseChat-Vision is advertised as a vision model; without an
  // override the provider/model id falls through to the default text-only floor
  // and images are stripped before the request reaches the provider.
  // SenseNova Token Plan (validated 2026-07-06): max output tokens are CLAMPED
  // to 65536 via the registry clampRequestBody hook (explicit over-ceiling values
  // only — omitted token fields are left untouched). Only the three supported chat
  // models are exposed; sensenova-u1-fast advertises on /models but 404s on
  // chat completions, so it is omitted from the registry.
  sensenova: {
    "sensenova-6.7-flash-lite": {
      vision: true,
      tools: true,
      // Flash-Lite streams reasoning on the Token Plan endpoint and accepts
      // OpenAI-style reasoning_effort (incl. "none" to disable), so mark it
      // reasoning-capable — otherwise applyThinking strips the client's
      // reasoning_effort/thinking controls for a model that can honour them.
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: true,
      contextWindow: 262144,
      maxOutput: 65536,
    },
    "deepseek-v4-flash": {
      reasoning: true,
      contextWindow: 1048576,
      maxOutput: 65536,
      // SenseNova's DeepSeek speaks OpenAI-style reasoning_effort (incl. "none"
      // to disable), NOT the native-deepseek thinking wire format — using
      // "deepseek" here would strip a client reasoning_effort. Override to
      // "openai" so it passes through.
      thinkingFormat: "openai",
      thinkingCanDisable: true,
    },
    "glm-5.2": {
      reasoning: true,
      contextWindow: 1048576,
      maxOutput: 65536,
      thinkingFormat: "openai",
    },
  },

  // StepFun — step-3.7-flash is documented as a vision-capable reasoning model.
  // preserving the StepFun reasoning wire format.
  stepfun: {
    "step-3.7-flash": { vision: true, reasoning: true, thinkingFormat: "step", contextWindow: 262144 },
    "step-3.5-flash": { reasoning: true, thinkingFormat: "step", contextWindow: 262144 },
    "step-3.5-flash-2603": { reasoning: true, thinkingFormat: "step", contextWindow: 262144 },
    "step-1o-turbo-vision": { vision: true, reasoning: true, thinkingFormat: "step", contextWindow: 32768 },
  },

  // Tencent Hunyuan — hunyuan-vision is advertised as a vision model, but the
  // generic *hunyuan* pattern only marks reasoning; override so image inputs
  // are not replaced with placeholders before the request is sent.
  tencent: {
    "hunyuan-vision": { vision: true, reasoning: true, thinkingFormat: "hunyuan" },
  },

  // Scaleway AI serves models through an OpenAI-compatible endpoint, so any
  // reasoning model that defaults to a native thinking field must be forced to
  // the openai reasoning_effort shape.
  scaleway: {
    "qwen3-235b-a22b-instruct-2507": { thinkingFormat: "openai" },
    "llama-3.1-70b-instruct": { thinkingFormat: "openai" },
    "llama-3.1-8b-instruct": { thinkingFormat: "openai" },
    "mistral-small-3.2-24b-instruct-2506": { thinkingFormat: "openai" },
    "deepseek-v3-0324": { thinkingFormat: "openai" },
    "gpt-oss-120b": { thinkingFormat: "openai" },
  },
  scw: {
    "qwen3-235b-a22b-instruct-2507": { thinkingFormat: "openai" },
    "llama-3.1-70b-instruct": { thinkingFormat: "openai" },
    "llama-3.1-8b-instruct": { thinkingFormat: "openai" },
    "mistral-small-3.2-24b-instruct-2506": { thinkingFormat: "openai" },
    "deepseek-v3-0324": { thinkingFormat: "openai" },
    "gpt-oss-120b": { thinkingFormat: "openai" },
  },

  // Upstage — solar-pro3 contains "pro3" which matches the OpenAI o-series
  // *o3* pattern, incorrectly marking it vision-capable. Override so it uses
  // the text-only default and images fail locally instead of being forwarded.
  upstage: {
    "solar-pro3": { vision: false, reasoning: false },
  },

  // ZenMux — x-ai/grok-4.1-fast is explicitly text-only, so override vision to
  // false while preserving the Grok pattern's reasoning/search/openai defaults.
  // glm-4.6v-flash is advertised as vision-capable, but the generic *glm-4*
  // pattern below is text-only; override here so images survive.
  zenmux: {
    "x-ai/grok-4.1-fast": { vision: false, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 256000 },
    "z-ai/glm-4.6v-flash": { vision: true, contextWindow: 128000 },
  },
};


/**
 * Pattern fallback — glob (* = wildcard), matched case-insensitively and
 * anchored (^...$) so a pattern must match the full model id. ORDER MATTERS:
 * vision/specific variants first, text-only/generic families last, to avoid
 * a broad family pattern swallowing an exception (e.g. glm-4.6v vs glm-5).
 */
export const PATTERN_CAPABILITIES = [
  /** Embedders do not have chat-generation limits; null prevents family globs from inventing them. */
  { pattern: "*embed*", caps: { tools: false, contextWindow: null, maxOutput: null } },

  // ── Claude (4.6+ = adaptive thinking; 5 = 1M context; older/haiku = budget) ──────
  { pattern: "*claude*opus-5*",     caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*sonnet-5*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 } },
  /** Claude 4.6+ variants share the generation's 1M context and 128K output limits. */
  { pattern: "*claude*opus-4.6*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*opus-4.7*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*opus-4.8*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*sonnet-4.6*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*sonnet-4.7*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*haiku*",  caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  { pattern: "*claude*opus*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  { pattern: "*claude*sonnet*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  { pattern: "*claude*fable*",  caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*mythos*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude-3*",      caps: { vision: true } },
  { pattern: "*claude*",        caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },

  // ── Gemini (all 2.0+ multimodal + google_search grounding, 1M ctx) ─
  { pattern: "*gemini*image*",  caps: { vision: true, imageOutput: true, contextWindow: 1048576 } },
  { pattern: "*gemini-3*pro*",  caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65535 } },
  { pattern: "*gemini-3*",      caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-2.5*",    caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-budget", thinkingRange: { min: 0, max: 24576 }, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-2*",      caps: { vision: true, audioInput: true, videoInput: true, search: true, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini*",        caps: { vision: true, search: true, contextWindow: 1048576 } },
  // Gemma 4 on Gemini API accepts thinkingLevel, not Gemini 2.5 thinkingBudget.
  { pattern: "*gemma-4*",       caps: { vision: true, reasoning: true, thinkingFormat: "gemini-level", contextWindow: 128000 } },
  { pattern: "*gemma*",         caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*nanobanana*",    caps: { vision: true, imageOutput: true } },

  // ── OpenAI GPT-5.x (vision + thinking + web search) ──────────────
  { pattern: "*gpt-5*image*",   caps: { imageOutput: true } },
  { pattern: "*gpt-5*codex*",   caps: { reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  { pattern: "*gpt-5*",         caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  { pattern: "*gpt-4o*",        caps: { vision: true, search: true, contextWindow: 128000, maxOutput: 16384 } },
  { pattern: "*gpt-4.1*",       caps: { vision: true, contextWindow: 1000000, maxOutput: 32768 } },
  { pattern: "*gpt-4-turbo*",   caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*gpt-4*",         caps: { contextWindow: 128000 } },
  { pattern: "*gpt-3.5*",       caps: { contextWindow: 16385, maxOutput: 4096 } },
  { pattern: "*gpt-oss*",       caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 } },

  // ── OpenAI o-series (reasoning, vision) ──────────────────────────
  { pattern: "*o1-mini*",       caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 } },
  { pattern: "*o1*",            caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },
  { pattern: "*o3*",            caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },
  { pattern: "*o4*",            caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },

  // ── Grok (vision + Live Search) ──────────────────────────────────
  { pattern: "*grok*image*",    caps: { imageOutput: true } },
  // Composer keeps the 200K window from decolua/9router#2502's HAR-captured Grok CLI /v1/models response.
  { pattern: "*grok-composer*", caps: { vision: true, reasoning: false, search: false, thinkingFormat: null, contextWindow: 200000 } },
  // Public aliases follow xAI's Grok Build 0.1 docs (256 Ki tokens, vision/tools/reasoning); exact CLI `grok-build` above keeps the HAR-reported 256K/non-reasoning caps.
  { pattern: "*grok-build*",    caps: { vision: true, tools: true, reasoning: true, search: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 262144 } },
  { pattern: "*grok-code*",     caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 256000 } },
  // Current 4.x models are 500K or 1M; 500K is the conservative floor that cannot over-promise.
  { pattern: "*grok-4.5*",      caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 500000 } },
  { pattern: "*grok-4*",        caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 500000 } },
  // Keep retired Grok 3 ids usable for stored user configurations.
  { pattern: "*grok-3*",        caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 131072 } },
  { pattern: "*grok*",          caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 256000 } },

  /** Cloudflare publishes 32,768 tokens for @cf/qwen/qwen2.5-coder-32b-instruct. */
  { pattern: "*@cf/qwen/qwen2.5-coder-32b-instruct", caps: { reasoning: false, thinkingFormat: null, contextWindow: 32768 } },

  // ── Qwen (3.5+ = native vision/video; coder & max = text-only; QwQ = thinking-only) ─
  { pattern: "*qwen*vl*",       caps: { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 262144 } },
  { pattern: "*qwen*omni*",     caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 262144, maxOutput: 65536 } },
  { pattern: "*qwen*coder*",    caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000 } },
  { pattern: "*qwen*max*",      caps: { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen3.5*",       caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen3.6*",       caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen3.7*",       caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen*plus*",     caps: { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen*235b*",     caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 262144 } },
  { pattern: "*qwq*",           caps: { reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 131072 } },
  { pattern: "*qwen*",          caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 262144 } },

  // ── Kimi (enabled→reasoning_effort; K2.7-code cannot disable) ─────
  /**
   * Live probes 2026-08-13 confirmed exact integers rather than merely
   * expanding Moonshot's ambiguous labels. `/coding/v1/models` returned
   * context_length=262144 for upstream IDs kimi-for-coding,
   * kimi-for-coding-highspeed, and k3-256k, while k3 returned
   * context_length=1048576. Deliberate overflows for kimi-k2.7-code,
   * kimi-k2.7-code-highspeed, kimi-k2.6, and kimi-k2.5 all returned
   * `Your request exceeded model token limit: 262144`.
   */
  { pattern: "k3-256k",         caps: { vision: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 262144 } },
  // K3 routes through the bare upstream id `k3` (no "kimi" prefix); match it to
  // the K3 window so it does not fall to the generic 200K default (#2697).
  { pattern: "k3",              caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 262144 } },
  // Moonshot documents a 32,768-token default for K2.x, but no maximum. A
  // default is not a safe client-side ceiling, so maxOutput remains unset.
  // Exact K2.7 aliases confirmed by deliberate overflow errors described above.
  { pattern: "*kimi*k2.7*code*", caps: { vision: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 262144, maxOutput: undefined } },
  { pattern: "*kimi*k2*",       caps: { vision: true, reasoning: true, thinkingFormat: "kimi", contextWindow: 262144, maxOutput: undefined } },
  { pattern: "*kimi*",          caps: { reasoning: true, thinkingFormat: "kimi", contextWindow: 262144 } },

  // ── GLM / Z.ai (thinking.enabled; disable via enable_thinking:false) ─
  { pattern: "*glm-5*",         caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000, maxOutput: 128000 } },
  { pattern: "*glm-4.7*",       caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000, maxOutput: 128000 } },
  { pattern: "*glm-4*",         caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000 } },
  { pattern: "*glm*",           caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000 } },

  // ── DeepSeek (thinking.enabled + reasoning_effort; r1 = thinking-only) ─
  { pattern: "*deepseek-v4*",   caps: { reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 } },
  { pattern: "*reasoner*",      caps: { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 128000 } },
  { pattern: "*deepseek-r*",    caps: { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 128000 } },
  { pattern: "*deepseek-chat*", caps: { contextWindow: 128000 } },
  { pattern: "*deepseek*",      caps: { reasoning: true, thinkingFormat: "deepseek", contextWindow: 128000 } },

  // ── MiniMax (M3 = adaptive; M2.x cannot disable) ─────────────────
  { pattern: "*minimax*image*", caps: { imageOutput: true } },
  { pattern: "*minimax-m3*",    caps: { vision: true, reasoning: true, thinkingFormat: "minimax", contextWindow: 512000, maxOutput: 131072 } },
  { pattern: "*minimax-m2.7*",  caps: { vision: true, reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false, contextWindow: 204800, maxOutput: 131072 } },
  { pattern: "*minimax-m2.5*",  caps: { vision: true, reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false, contextWindow: 204800, maxOutput: 131072 } },
  /** MiniMax publishes 204,800 tokens for every M2-family model. */
  { pattern: "*minimax-m2.1*",  caps: { reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false, contextWindow: 204800, maxOutput: 131072 } },
  { pattern: "*minimax-m2",     caps: { reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false, contextWindow: 204800, maxOutput: 131072 } },
  { pattern: "*minimax*",       caps: { reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 131072 } },

  // ── Xiaomi MiMo (vision + <think>-tag reasoning, always-on, can't disable) ──
  { pattern: "*mimo*v2.5*",     caps: { vision: true, reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 131072 } },
  { pattern: "*mimo*omni*",     caps: { vision: true, audioInput: true, reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 262144, maxOutput: 131072 } },
  { pattern: "*mimo*",          caps: { vision: true, reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 262144, maxOutput: 131072 } },

  // ── Llama (4 = vision/1M; 3.x = text-only/128K) ──────────────────
  { pattern: "*llama-4*",       caps: { vision: true, contextWindow: 1000000 } },
  { pattern: "*llama*",         caps: { contextWindow: 128000 } },

  // ── Mistral (Large 3 = vision/256K; codestral text) ──────────────
  { pattern: "*codestral*",     caps: { contextWindow: 256000 } },
  { pattern: "*mistral-large*", caps: { vision: true, contextWindow: 256000 } },
  { pattern: "*mistral*",       caps: { contextWindow: 128000 } },

  // ── Cohere (Command A Vision = vision; others text) ──────────────
  { pattern: "*command-a-vision*", caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*command*",       caps: { contextWindow: 128000 } },

  // ── Perplexity (web search native) ───────────────────────────────
  { pattern: "*sonar*",         caps: { search: true, contextWindow: 128000 } },
  { pattern: "*pplx*",          caps: { search: true, contextWindow: 128000 } },
  { pattern: "*perplexity*",    caps: { search: true, contextWindow: 128000 } },

  // ── Others ───────────────────────────────────────────────────────
  { pattern: "*hunyuan*",       caps: { reasoning: true, thinkingFormat: "hunyuan", contextWindow: 262144, maxOutput: 262144 } },
  { pattern: "hy3*",            caps: { reasoning: true, thinkingFormat: "hunyuan", contextWindow: 262144, maxOutput: 262144 } },
  { pattern: "*step-*",         caps: { reasoning: true, thinkingFormat: "step", contextWindow: 128000 } },
  { pattern: "*nemotron*",      caps: { reasoning: true, contextWindow: 128000 } },
  { pattern: "*ling-*",         caps: { reasoning: true, contextWindow: 128000 } },
];

/** Preserve unknown combo limits instead of coercing them to zero/NaN. */
function minKnownLimit(caps, key) {
  const values = caps.map((item) => item[key]).filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.min(...values) : undefined;
}

function maxKnownLimit(caps, key) {
  const values = caps.map((item) => item[key]).filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : undefined;
}

/**
 * Aggregate capabilities for a combo from its constituent model IDs.
 * Each entry in comboModels is a fully-qualified "provider/model" string.
 *
 * Union:        vision, pdf, audioInput, videoInput, imageOutput, audioOutput, search
 * Intersection: tools
 * Primary:      reasoning fields from the first (primary) model
 * Conservative: contextWindow = min; maxOutput = max
 *
 * @param {string[]} comboModels
 * @param {Object|null} [comboLookup] optional map of combo name → models array for nested resolution
 * @param {Object|null} [aliasToProviderId] optional map of model-list output alias
 *   (incl. custom connection prefixes like `mykr`) → provider id, so combo
 *   member ids keyed by a connection prefix resolve that provider's caps rows
 *   instead of falling through to generic patterns.
 * @param {number} [_depth] internal recursion depth guard
 * @returns {object|null} full capabilities object, or null for empty input
 */
export function aggregateComboCapabilities(comboModels, comboLookup = null, aliasToProviderId = null, _depth = 0, customCapsById = null) {
  if (!comboModels?.length || _depth > 6) return null;
  const allCaps = comboModels.map((fullId) => {
    // Nested combo: bare name (no slash) that exists in the lookup — recurse
    if (!fullId.includes("/") && comboLookup?.[fullId]) {
      return aggregateComboCapabilities(comboLookup[fullId], comboLookup, aliasToProviderId, _depth + 1, customCapsById)
          ?? getCapabilitiesForModel(null, fullId);
    }
    const slash = fullId.indexOf("/");
    const provider = slash === -1 ? null : fullId.slice(0, slash);
    const model = slash === -1 ? fullId : fullId.slice(slash + 1);
    const providerId = aliasToProviderId?.[provider] ?? provider;
    // Persisted custom-model overrides (keyed canonical "providerId/modelId")
    // merge over the static catalog so advertised combo capabilities match
    // routing. Members may use a static alias or a connection's custom output
    // prefix; both normalize through aliasToProviderId above.
    const custom = customCapsById?.get?.(`${providerId}/${model}`);
    const staticCaps = getCapabilitiesForModel(providerId, model);
    return custom ? { ...staticCaps, ...custom } : staticCaps;
  });
  const first = allCaps[0];
  const combined = {
    vision:      allCaps.some((c) => c.vision),
    pdf:         allCaps.some((c) => c.pdf),
    audioInput:  allCaps.some((c) => c.audioInput),
    videoInput:  allCaps.some((c) => c.videoInput),
    imageOutput: allCaps.some((c) => c.imageOutput),
    audioOutput: allCaps.some((c) => c.audioOutput),
    search:      allCaps.some((c) => c.search),
    tools:       allCaps.every((c) => c.tools),
    reasoning:          first.reasoning,
    thinkingFormat:     first.thinkingFormat,
    thinkingCanDisable: first.thinkingCanDisable,
    thinkingRange:      first.thinkingRange,
    contextWindow: minKnownLimit(allCaps, "contextWindow"),
    maxOutput:     maxKnownLimit(allCaps, "maxOutput"),
  };
  return sanitizeModelLimits(combined);
}

/** Omit structurally impossible output ceilings while preserving source metadata. */
function sanitizeModelLimits(caps) {
  if (!Number.isFinite(caps?.contextWindow) || !Number.isFinite(caps?.maxOutput)) return caps;
  return caps.maxOutput < caps.contextWindow ? caps : { ...caps, maxOutput: undefined };
}

/**
 * Resolve capabilities for a model using the 4-step fallback chain,
 * merged over DEFAULT_CAPABILITIES so the result is always complete.
 *
 * @param {string} provider
 * @param {string} model
 * @returns {object} full capabilities object
 */
export function getCapabilitiesForModel(provider, model) {
  const finalize = (caps) => {
    let result = provider === "huggingchat" ? { ...caps, vision: false } : caps;
    // Workers AI pages publish max_tokens defaults, never enforceable ceilings.
    if ((provider === "cloudflare-ai" || provider === "cf") && model?.startsWith("@cf/")) {
      result = { ...result, maxOutput: undefined };
    }
    return sanitizeModelLimits(result);
  };
  if (!model) return finalize({ ...DEFAULT_CAPABILITIES });

  const baseModel = model.includes("/") ? model.split("/").pop() : model;

  // Z.ai's Claude Code catalog spells GLM-5.3's 1M variant `glm-5.3[1m]`.
  // Preserve its wire ID; normalize only static capability lookup.
  const capabilityBaseModel = /^glm-5\.3\[1m\]$/i.test(baseModel) ? "glm-5.3" : baseModel;
  if (provider) {
    const providerCaps = PROVIDER_CAPABILITIES[provider];
    if (providerCaps?.[model]) return finalize({ ...DEFAULT_CAPABILITIES, ...providerCaps[model] });
    if (providerCaps?.[capabilityBaseModel]) return finalize({ ...DEFAULT_CAPABILITIES, ...providerCaps[capabilityBaseModel] });
    if (provider === "kiro" || provider === "kr") {
      const normalized = normalizeModelId(model);
      const normalizedBase = normalizeModelId(baseModel);
      if (providerCaps?.[normalized]) return finalize({ ...DEFAULT_CAPABILITIES, ...providerCaps[normalized] });
      if (providerCaps?.[normalizedBase]) return finalize({ ...DEFAULT_CAPABILITIES, ...providerCaps[normalizedBase] });
    }
  }

  const exactId = MODEL_CAPABILITIES[capabilityBaseModel] ? capabilityBaseModel : model;
  const exactCaps = MODEL_CAPABILITIES[exactId];
  if (exactCaps) {
    const merged = { ...DEFAULT_CAPABILITIES, ...exactCaps };
    if (hasUnpublishedOutput(provider, exactId)) merged.maxOutput = undefined;
    return finalize(merged);
  }

  for (const { pattern, caps } of PATTERN_CAPABILITIES) {
    if (matchPattern(pattern, capabilityBaseModel) || matchPattern(pattern, model)) {
      const merged = { ...DEFAULT_CAPABILITIES, ...caps };
      if (hasUnpublishedOutput(provider, baseModel)) merged.maxOutput = undefined;
      return finalize(merged);
    }
  }
  return finalize({ ...DEFAULT_CAPABILITIES });
}

/**
 * Resolve the input/output limits advertised for a routed model.
 *
 * Explicit request-scoped custom limits win when supplied. Caller-provided
 * live limits are next, then static catalogs; a cold cache preserves the
 * unknown-floor semantics instead of turning the default into an enforceable
 * guarantee. This client-shared module stays synchronous and cache-agnostic.
 *
 * @param {string} provider
 * @param {string} model
 * @param {object|null} customCaps
 * @param {object|null} connection Reserved for request context compatibility.
 * @param {object|null} liveLimits Already-resolved server-side cache value.
 * @returns {{contextWindow: number, maxOutput: number|undefined, known: boolean, source: "custom"|"live"|"provider"|"exact"|"pattern"|"registry"|"default"}}
 */
export function resolveModelLimits(provider, model, customCaps = null, connection = null, liveLimits = null) {
  const baseModel = typeof model === "string" && model.includes("/") ? model.split("/").pop() : model;

  // Keep Z.ai's documented Claude Code suffix on wire; use bare catalog ID for limits.
  const capabilityBaseModel = /^glm-5\.3\[1m\]$/i.test(baseModel) ? "glm-5.3" : baseModel;
  const positive = (value) => Number.isFinite(value) && value > 0;
  const asLimits = (caps, source, unpublishedOutput = false) => {
    if (!positive(caps?.contextWindow)) return null;
    return {
      contextWindow: caps.contextWindow,
      maxOutput: unpublishedOutput ? undefined : positive(caps.maxOutput) ? caps.maxOutput : DEFAULT_CAPABILITIES.maxOutput,
      known: true,
      source,
    };
  };
  const customKeys = customCaps?.customKeys instanceof Set ? customCaps.customKeys : null;
  const customContext = positive(customCaps?.contextWindow) && (!customKeys || customKeys.has("contextWindow"))
    ? customCaps.contextWindow
    : undefined;
  const customOutput = positive(customCaps?.maxOutput) && (!customKeys || customKeys.has("maxOutput"))
    ? customCaps.maxOutput
    : undefined;
  const liveCaps = liveLimits;
  const preferredContext = customContext
    ? { value: customContext, source: "custom" }
    : positive(liveCaps?.contextWindow) ? { value: liveCaps.contextWindow, source: "live" } : null;
  const preferredOutput = customOutput || (positive(liveCaps?.maxOutput) ? liveCaps.maxOutput : undefined);
  const applyPreferred = (fallback) => ({
    ...fallback,
    ...(preferredContext ? {
      contextWindow: preferredContext.value,
      known: true,
      source: preferredContext.source,
    } : {}),
    ...(preferredOutput ? { maxOutput: preferredOutput } : {}),
  });

  if (provider) {
    const providerCaps = PROVIDER_CAPABILITIES[provider];
    const ids = provider === "kiro" || provider === "kr"
      ? [model, baseModel, capabilityBaseModel, normalizeModelId(model), normalizeModelId(baseModel)]
      : [model, baseModel, capabilityBaseModel];
    for (const id of ids) {
      const hit = providerCaps?.[id] && asLimits(providerCaps[id], "provider", hasUnpublishedOutput(provider, id));
      if (hit) return applyPreferred(hit);
    }
  }

  for (const id of [capabilityBaseModel, baseModel, model]) {
    const hit = MODEL_CAPABILITIES[id] && asLimits(MODEL_CAPABILITIES[id], "exact", hasUnpublishedOutput(provider, id));
    if (hit) return applyPreferred(hit);
  }

  const registry = REGISTRY.find((entry) => entry.id === provider || entry.alias === provider || entry.uiAlias === provider);
  const registryModel = registry?.models?.find((entry) => entry.id === model || entry.id === baseModel || entry.id === capabilityBaseModel);
  if (registryModel) {
    const hit = asLimits({
      contextWindow: registryModel.contextLength ?? registry.transport?.defaultContextLength,
      maxOutput: registryModel.maxOutputTokens,
    }, "registry", hasUnpublishedOutput(provider, baseModel));
    if (hit) return applyPreferred(hit);
  }

  for (const { pattern, caps } of PATTERN_CAPABILITIES) {
    if (!matchPattern(pattern, capabilityBaseModel) && !matchPattern(pattern, baseModel) && !matchPattern(pattern, model)) continue;
    const hit = asLimits(caps, "pattern", hasUnpublishedOutput(provider, baseModel));
    if (hit) return applyPreferred(hit);
    if (caps?.contextWindow === null) break;
  }

  return applyPreferred({
    contextWindow: DEFAULT_CAPABILITIES.contextWindow,
    maxOutput: DEFAULT_CAPABILITIES.maxOutput,
    known: false,
    source: "default",
  });
}
