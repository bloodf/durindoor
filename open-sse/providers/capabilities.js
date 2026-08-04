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
  // enum: openai|claude-adaptive|claude-budget|gemini-level|gemini-budget|zai|qwen|deepseek|kimi|minimax|hunyuan|step|kiro
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

/**
 * Canonical exact-id overrides — used for exceptions that patterns would
 * otherwise mis-match. Only declare deltas vs DEFAULT.
 */
export const MODEL_CAPABILITIES = {
  // Kimi K3: 1M context, always reasons, reasoning_effort "max" only (cannot disable), vision + tools.
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
  "claude-sonnet-4.6": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-4-6": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-thinking-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },

  // Gemini image-gen / OpenAI image / xai image variants
  "gpt-image-1":       { imageOutput: true, tools: false },

  // GLM vision variant (text GLM has no vision)
  "glm-4.6v":          { vision: true, reasoning: true, thinkingFormat: "zai", contextWindow: 128000 },
  // GLM-5.2 has a 1M window; GLM-5.1/5/5-turbo are 200K (official z.ai / models.dev).
  "glm-5.2":           { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 131072 },
  "glm-5.1":           { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 131072 },
  "glm-5":             { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 131072 },
  "glm-5-turbo":       { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 131072 },
  // GLM-4.7 has 200K context, 128K max output
  "glm-4.7":           { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 131072 },
  // GLM-4.7-flashx has 128K context (maxOutput not recorded in source)
  "glm-4.7-flashx":    { reasoning: true, thinkingFormat: "zai", contextWindow: 131072 },
  // GLM-4.6 has 200K context, 128K max output
  "glm-4.6":           { reasoning: true, thinkingFormat: "zai", contextWindow: 200000, maxOutput: 131072 },
  // GLM-4.5 and 4-32b-0414-128k have 128K context (maxOutput not recorded in source)
  "glm-4.5":           { reasoning: true, thinkingFormat: "zai", contextWindow: 131072 },
  "glm-4.5-air":       { reasoning: true, thinkingFormat: "zai", contextWindow: 131072 },
  "glm-4-32b-0414-128k": { reasoning: true, thinkingFormat: "zai", contextWindow: 131072 },

  // Qwen plain coder/text (no vision) — registry "vision-model" / "coder-model" aliases
  "vision-model":      { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000 },
  "coder-model":       { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000 },

  // Grok CLI non-reasoning coding models (cli-chat-proxy rejects reasoningEffort). Upstream decolua/9router#2534.
  "grok-composer-2.5-fast": { vision: true, reasoning: false, search: false, thinkingFormat: null, contextWindow: 200000, maxOutput: 30000 },
  "grok-build":            { vision: true, reasoning: false, search: false, thinkingFormat: null, contextWindow: 512000, maxOutput: 30000 },
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

// Direct OpenAI GPT-5.5/5.6 surfaces override the generic *gpt-5* 400K pattern
// (1.05M context / 128K max output). Codex and its CX alias get the same
// base values, plus Codex-specific review and ultra ids.
const DIRECT_GPT_5_5_6_CAPS = {
  "gpt-5.5":              { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6":              { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-sol":          { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-terra":        { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-luna":         { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
};

const CODEX_GPT_5_6_CAPS = {
  ...DIRECT_GPT_5_5_6_CAPS,
  "gpt-5.5-review":       { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-sol-review":   { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-sol-ultra":    { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-terra-review": { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
  "gpt-5.6-luna-review":  { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 },
};

export const PROVIDER_CAPABILITIES = {
  // Direct OpenAI GPT-5.5/5.6 family and Codex/CX aliases expose 1.05M context
  // window and 128K max output, overriding the generic *gpt-5* 400K fallback pattern.
  openai: DIRECT_GPT_5_5_6_CAPS,
  codex: CODEX_GPT_5_6_CAPS,
  cx: CODEX_GPT_5_6_CAPS,
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
    "minimaxai/minimax-m2.7": { reasoning: false, contextWindow: 200000, maxOutput: 131072 }, // #2323: NIM rejects thinking for this model
    "minimaxai/minimax-m3": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 512000, maxOutput: 131072 },
    "z-ai/glm-5.2": { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 128000 },
    "deepseek-ai/deepseek-v4-pro": { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 65536 },
    "deepseek-ai/deepseek-v4-flash": { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 65536 },
    "moonshotai/kimi-k2.6": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: 262144 },
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
  // The generic *step-* pattern is reasoning-only, so override vision while
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
  // ── Claude (4.6+ = adaptive thinking; 5 = 1M context; older/haiku = budget) ──────
  { pattern: "*claude*opus-5*",     caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*sonnet-5*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*opus-4.6*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*opus-4.7*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*opus-4.8*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*sonnet-4.6*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*sonnet-4.7*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
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
  // Grok Composer / Build (Grok CLI): no client-controlled reasoningEffort (xAI 400 if sent). Upstream decolua/9router#2534.
  { pattern: "*grok-composer*", caps: { vision: true, reasoning: false, search: false, thinkingFormat: null, contextWindow: 200000, maxOutput: 30000 } },
  { pattern: "*grok-build*",    caps: { vision: true, reasoning: false, search: false, thinkingFormat: null, contextWindow: 512000, maxOutput: 30000 } },
  { pattern: "*grok-code*",     caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 256000 } },
  // Grok 4.5 (Grok CLI / Grok Build): 500k context per cli-chat-proxy /v1/models.
  { pattern: "*grok-4.5*",      caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 500000, maxOutput: 64000 } },
  { pattern: "*grok-4*",        caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 256000 } },
  { pattern: "*grok-3*",        caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 131072 } },
  { pattern: "*grok*",          caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 256000 } },

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
  { pattern: "*kimi*k3*",       caps: { reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 262144 } },
  // K3 routes through the bare upstream id `k3` (no "kimi" prefix); match it to
  // the K3 window so it does not fall to the generic 200K default (#2697).
  { pattern: "k3",              caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 262144 } },
  { pattern: "*kimi*k2.7*code*", caps: { vision: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 262144, maxOutput: 262144 } },
  { pattern: "*kimi*k2*",       caps: { vision: true, reasoning: true, thinkingFormat: "kimi", contextWindow: 262144, maxOutput: 262144 } },
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
  return {
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
    contextWindow: Math.min(...allCaps.map((c) => c.contextWindow)),
    maxOutput:     Math.max(...allCaps.map((c) => c.maxOutput)),
  };
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
  const finalize = (caps) => provider === "huggingchat" ? { ...caps, vision: false } : caps;

  if (!model) return finalize({ ...DEFAULT_CAPABILITIES });

  // Vendor-prefixed ids ("openai/gpt-5.6-sol") resolve against the bare id.
  const baseModel = model.includes("/") ? model.split("/").pop() : model;

  // 1. Provider-specific override
  if (provider) {
    const providerCaps = PROVIDER_CAPABILITIES[provider];
    if (providerCaps?.[model]) return finalize({ ...DEFAULT_CAPABILITIES, ...providerCaps[model] });
    if (providerCaps?.[baseModel]) return finalize({ ...DEFAULT_CAPABILITIES, ...providerCaps[baseModel] });
    // Kiro accepts dash-form version ids ("gpt-5-6-sol") at the wire, but the
    // caps map is keyed by the dotted catalog ids. Normalize digit-dash-digit
    // ("5-6" → "5.6", synthetic -thinking/-agentic suffixes untouched) so the
    // dash form hits the same 1.05M GPT-5.6 row instead of the generic 400k
    // *gpt-5* pattern. Scoped to kiro/kr so other providers are unaffected.
    if (provider === "kiro" || provider === "kr") {
      const normalized = normalizeModelId(model);
      const normalizedBase = normalizeModelId(baseModel);
      if (providerCaps?.[normalized]) return finalize({ ...DEFAULT_CAPABILITIES, ...providerCaps[normalized] });
      if (providerCaps?.[normalizedBase]) return finalize({ ...DEFAULT_CAPABILITIES, ...providerCaps[normalizedBase] });
    }
  }

  // 2. Canonical exact
  if (MODEL_CAPABILITIES[baseModel]) return finalize({ ...DEFAULT_CAPABILITIES, ...MODEL_CAPABILITIES[baseModel] });
  if (MODEL_CAPABILITIES[model]) return finalize({ ...DEFAULT_CAPABILITIES, ...MODEL_CAPABILITIES[model] });

  // 3. Pattern match (first match wins)
  for (const { pattern, caps } of PATTERN_CAPABILITIES) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, model)) {
      return finalize({ ...DEFAULT_CAPABILITIES, ...caps });
    }
  }

  // 4. Floor
  return finalize({ ...DEFAULT_CAPABILITIES });
}
