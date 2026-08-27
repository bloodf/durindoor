// Resolve valid thinking levels per model — drives UI level picker (suffix "model(level)").
// Reuses capabilities.js (thinkingFormat/canDisable) so this file only maps format→levels (DRY).
import { getCapabilitiesForModel } from "./capabilities.js";
import { matchPattern } from "./pricing.js";
import { PROVIDERS } from "./index.js";

// Shared level sets (deduped) — verified against provider docs + wire in thinkingUnified.applyFormat.
const L = {
  base: ["none", "low", "medium", "high"],                          // qwen, step, hunyuan, gemini-budget
  onOff: ["none", "thinking"],                                      // zai (binary), minimax (adaptive)
  openai: ["none", "minimal", "low", "medium", "high", "xhigh"],    // GPT-5.x / o-series (no "max")
  levelMax: ["none", "low", "medium", "high", "max"],               // claude-adaptive, kimi
  budgetX: ["none", "low", "medium", "high", "xhigh", "max"],       // claude-budget
  gemini: ["minimal", "low", "medium", "high"],                     // gemini-3 thinkingLevel (no disable)
  hi: ["none", "high"],                                              // DeepSeek legacy models
  hiMax: ["none", "high", "max"],                                   // native DeepSeek V4
  opencode: ["none", "low", "medium", "high", "max"],
};

// thinkingFormat → valid selectable levels (source of truth for UI options).
const FORMAT_LEVELS = {
  openai: L.openai,
  ollama: L.levelMax,
  commandcode: ["low", "medium", "high", "xhigh", "max"],
  "claude-adaptive": L.levelMax,
  "claude-budget": L.budgetX,
  "gemini-level": L.gemini,
  "gemini-budget": L.base,
  zai: L.onOff,
  qwen: L.base,
  kimi: L.levelMax,
  deepseek: L.hi,
  minimax: L.onOff,
  hunyuan: L.base,
  step: L.base,
  opencode: L.opencode,
};

// Model-name pattern overrides (glob, first match wins) — more precise than format default.
// GPT-5.6 patterns must precede broad *codex* so Sol/Terra/Luna keep their matrix.
const PATTERN_THINKING = [
  // Sol/Terra accept max + ultra on the wire.
  { pattern: "*gpt-5.6-sol*", levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] },
  { pattern: "*gpt-5.6-terra*", levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] },
  // Luna accepts max; ultra falls back to max in applyThinking.
  { pattern: "*gpt-5.6-luna*", levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] },
  // K3 only accepts max reasoning effort.
  { pattern: "*kimi-k3*", levels: ["max"] },
  { pattern: "*codex*", levels: ["low", "medium", "high", "xhigh"] }, // codex cannot disable thinking
  // Ollama GPT-OSS accepts low/medium/high only; max must clamp to high.
  { provider: "ollama", pattern: "*gpt-oss*", levels: ["none", "low", "medium", "high"] },
  { provider: "ollama-local", pattern: "*gpt-oss*", levels: ["none", "low", "medium", "high"] },
];

const NATIVE_DEEPSEEK_V4_MODELS = new Set([
  "deepseek-v4-pro",
  "deepseek-v4-pro-max",
  "deepseek-v4-pro-none",
  "deepseek-v4-flash",
]);

export function isNativeDeepSeekV4(provider, model) {
  return (provider === "deepseek" || provider === "ds") && NATIVE_DEEPSEEK_V4_MODELS.has(model);
}

// Returns valid thinking levels for a model, or null when the model has no reasoning.
export function getThinkingLevels(provider, model) {
  const caps = getCapabilitiesForModel(provider, model);
  return getThinkingLevelsFromCapabilities(caps, provider, model);
}

/**
 * Derive selectable thinking levels from an already-resolved capability object.
 * @param {object} caps
 * @param {string} [provider] - provider id, used for provider-specific filtering
 * @param {string} [model] - model id, used for pattern overrides
 */
export function getThinkingLevelsFromCapabilities(caps, provider = null, model = null) {
  if (!caps || !caps.reasoning) return null;
  const modelId = model || "";
  const hit = PATTERN_THINKING.find((p) =>
    (!p.provider || p.provider === provider) && matchPattern(p.pattern, modelId));
  // Provider gateway formats override native family formats (Ollama/OpenCode).
  const format = (provider ? PROVIDERS[provider]?.thinkingFormat : null) || caps.thinkingFormat;
  let levels = hit?.levels || (format === "deepseek" && isNativeDeepSeekV4(provider, modelId)
    ? L.hiMax
    : FORMAT_LEVELS[format] || L.base);
  if (caps.thinkingCanDisable === false) levels = levels.filter((l) => l !== "none");
  if (provider === "kiro" || provider === "kr") levels = levels.filter((l) => l !== "ultra" && l !== "max");
  return levels;
}
