// Unified thinking normalization: extract client intent → apply provider-native format.
// Config-driven: thinking format/limits come from capabilities.js + registry transport,
// never hardcoded per-model here. See .docs/thinking/plan.md MATRIX VI-A.

import { getCapabilitiesForModel } from "../../providers/capabilities.js";
import { getThinkingLevels, getThinkingLevelsFromCapabilities, isNativeDeepSeekV4 } from "../../providers/thinkingLevels.js";
import { PROVIDERS } from "../../providers/index.js";
import { FORMATS } from "../formats.js";
import { LEVEL_TO_BUDGET, budgetToLevel, effortToBudget, effortToThinkingLevel } from "./thinking.js";
import { parseSuffix, stripThinkingSuffix } from "./thinkingSuffix.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

export { parseSuffix, stripThinkingSuffix } from "./thinkingSuffix.js";

// Map a target wire-format to its native thinking format (when capability has none).
const FORMAT_TO_NATIVE = {
  openai: "openai",
  "openai-responses": "openai",
  "openai-response": "openai",
  codex: "openai",
  claude: "claude-budget",
  gemini: "gemini-budget",
  "gemini-cli": "gemini-budget",
  vertex: "gemini-budget",
  antigravity: "gemini-budget",
  kiro: "kiro"
};

// Extract unified thinking intent from a request body (post-translation, mixed shapes).
// Returns { mode, budget?, level? } or null when no thinking intent present.
export function extractThinking(body) {
  if (!body || !isObject(body)) return null;

  // Claude output_config.effort (explicit) — priority over adaptive thinking
  const oc = body.output_config?.effort;
  if (isString(oc) && oc) {
    const e = oc.toLowerCase();
    if (e === "none" || e === "off") return { mode: "none" };
    if (e === "auto") return { mode: "auto" };
    return { mode: "level", level: e };
  }

  // Claude shape
  const t = body.thinking;
  if (t && isObject(t)) {
    if (t.type === "disabled") return { mode: "none" };
    if (t.type === "adaptive" || t.type === "enabled") {
      const budget = Number(t.budget_tokens);
      if (Number.isFinite(budget) && budget > 0) return { mode: "budget", budget };
      return { mode: "auto" };
    }
  }

  // OpenAI chat / Responses shape
  const effort = body.reasoning_effort ?? (isObject(body.reasoning) ? body.reasoning?.effort : null);
  if (isString(effort) && effort) {
    const e = effort.toLowerCase();
    if (e === "none" || e === "off") return { mode: "none" };
    if (e === "auto") return { mode: "auto" };
    return { mode: "level", level: e };
  }

  // Gemini shape (top-level, generationConfig, or request envelope)
  const tc = body.thinkingConfig || body.generationConfig?.thinkingConfig || body.request?.generationConfig?.thinkingConfig;
  if (tc && isObject(tc)) {
    if (isString(tc.thinkingLevel)) return { mode: "level", level: tc.thinkingLevel.toLowerCase() };
    const tb = Number(tc.thinkingBudget);
    if (Number.isFinite(tb)) {
      if (tb === 0) return { mode: "none" };
      if (tb < 0) return { mode: "auto" };
      return { mode: "budget", budget: tb };
    }
  }

  // Qwen shape
  if (body.enable_thinking === false) return { mode: "none" };
  if (body.enable_thinking === true) {
    const tb = Number(body.thinking_budget);
    if (Number.isFinite(tb) && tb > 0) return { mode: "budget", budget: tb };
    return { mode: "auto" };
  }

  return null;
}

// Capture thinking intent from a body. Alias of extractThinking, named for clarity
// at the call-site where intent is snapshotted before format translation.
export const captureThinking = extractThinking;

// Resolve thinking format: provider override > capability > derive(targetFormat).
function resolveFormat(targetFormat, model, provider, caps = null) {
  const resolvedCaps = caps || getCapabilitiesForModel(provider, model);
  // An explicitly persisted custom-model thinkingFormat (customKeys marker)
  // outranks the registry-level provider default (e.g. a custom model behind
  // OpenRouter that speaks claude-style thinking, not "openai").
  if (
  resolvedCaps?.thinkingFormat &&
  resolvedCaps.customKeys instanceof Set &&
  resolvedCaps.customKeys.has("thinkingFormat"))
  {
    return resolvedCaps.thinkingFormat;
  }
  // Dynamic OpenAI-compatible gateways speak the OpenAI wire format regardless
  // of the underlying model family. A Qwen model served through such a gateway
  // must emit reasoning_effort, not native enable_thinking/thinking_budget,
  // which strict compatible upstreams reject with HTTP 400 (port of
  // decolua/9router #2800). An explicit persisted thinkingFormat (handled above)
  // still wins for operators who know their upstream speaks a native format.
  if (isString(provider) && provider.startsWith("openai-compatible-")) {
    return "openai";
  }
  const providerFmt = provider ? PROVIDERS[provider]?.thinkingFormat : null;
  if (providerFmt) return providerFmt;
  if (resolvedCaps.thinkingFormat) return resolvedCaps.thinkingFormat;
  return FORMAT_TO_NATIVE[targetFormat] || "openai";
}

// Convert unified config to a budget number (for budget-based formats).
function toBudget(cfg, range) {
  let budget;
  if (cfg.mode === "budget") budget = cfg.budget;else
  if (cfg.mode === "level") budget = effortToBudget(cfg.level);else
  if (cfg.mode === "auto") return -1;
  if (!Number.isFinite(budget)) return undefined;
  if (range) {
    if (range.min != null && budget < range.min) budget = range.min;
    if (range.max != null && budget > range.max) budget = range.max;
  }
  return budget;
}

// Convert unified config to a discrete level string.
function toLevel(cfg) {
  if (cfg.mode === "level") return cfg.level;
  if (cfg.mode === "budget") return budgetToLevel(cfg.budget) || "medium";
  if (cfg.mode === "auto") return "auto";
  return null;
}

function toGeminiThinkingLevel(cfg) {
  const raw = cfg.mode === "auto" ? "high" : toLevel(cfg) || "high";
  return effortToThinkingLevel(raw);
}

/**
 * Resolve unified intent to a value accepted by Claude adaptive thinking.
 * Unsupported levels fall back to high; minimal uses the nearest lower level.
 */
function toClaudeAdaptiveEffort(cfg, caps, provider) {
  const level = toLevel(cfg);
  const allowed = getThinkingLevelsFromCapabilities(caps, provider);
  if (allowed?.includes(level)) return level;
  if (level === "minimal" && allowed?.includes("low")) return "low";
  return "high";
}

function toKimiReasoningEffort(cfg) {
  const level = toLevel(cfg);
  if (level === "auto") return "high";
  if (level === "minimal") return "low";
  if (level === "xhigh") return "max";
  if (["low", "medium", "high", "max"].includes(level)) return level;
  return null;
}

/** Minimum maxOutputTokens by Gemini thinkingLevel. */
const GEMINI_LEVEL_OUTPUT_FLOOR = {
  minimal: 4096,
  low: 8192,
  medium: 16384,
  high: 65535
};

/**
 * Minimum maxOutputTokens for a numeric thinkingBudget (gemini-2.5 style).
 * `budget === -1` (dynamic) and non-finite inputs map to a safe default.
 */
function geminiBudgetOutputFloor(budget) {
  if (budget === -1) return 32768;
  if (!Number.isFinite(budget)) return 32768;
  if (budget <= 1024) return 8192;
  if (budget <= 8192) return 16384;
  if (budget <= 24576) return 32768;
  return 65535;
}

/** Output floor for a named thinkingLevel (defaults to `high` when unknown). */
function geminiLevelOutputFloor(level) {
  return GEMINI_LEVEL_OUTPUT_FLOOR[level] || GEMINI_LEVEL_OUTPUT_FLOOR.high;
}

/**
 * Resolve the generationConfig object thinking fields live on. gemini-cli /
 * antigravity wrap the request in `{ request: { generationConfig } }`; target
 * that envelope's generationConfig when present, else the top-level one,
 * creating whichever is missing.
 */
function getGeminiGenerationConfig(body) {
  if (body.request && isObject(body.request)) {
    if (!body.request.generationConfig || !isObject(body.request.generationConfig)) {
      body.request.generationConfig = {};
    }
    return body.request.generationConfig;
  }
  if (!body.generationConfig || !isObject(body.generationConfig)) {
    body.generationConfig = {};
  }
  return body.generationConfig;
}

function setGeminiThinking(body, tc) {
  const gc = getGeminiGenerationConfig(body);
  gc.thinkingConfig = tc;
}

/**
 * Raise maxOutputTokens to at least `floor` (clamped to caps.maxOutput when
 * known). Never lowers an existing, larger value; never exceeds the provider cap.
 */
function ensureGeminiOutputFloor(body, floor, caps) {
  const cap = Number.isFinite(caps?.maxOutput) ? caps.maxOutput : floor;
  const target = Math.min(floor, cap);
  const gc = getGeminiGenerationConfig(body);
  const current = Number(gc.maxOutputTokens);
  if (!Number.isFinite(current) || current < target) {
    gc.maxOutputTokens = target;
  }
}

// Strip every known thinking field from a body (used before re-applying / when unsupported).
function stripAll(body) {
  const targets = [body];
  if (body.params && isObject(body.params) && Array.isArray(body.params.messages)) {
    targets.push(body.params);
  }
  for (const target of targets) {
    delete target.thinking;
    delete target.reasoning_effort;
    delete target.reasoning;
    delete target.thinkingConfig;
    delete target.enable_thinking;
    delete target.thinking_budget;
    delete target.output_config;
    if (target.generationConfig) delete target.generationConfig.thinkingConfig;
    if (target.request?.generationConfig) delete target.request.generationConfig.thinkingConfig;
  }
}

// Map requested OpenAI effort to a level the model accepts.
// Preserve when listed in getThinkingLevels; else nearest high-end sibling.
// Unknown/empty metadata keeps legacy safe max/ultra → xhigh clamp.
export function resolveOpenAiEffort(level, provider, model) {
  if (!level) return level;
  const allowed = getThinkingLevels(provider, model);
  if (Array.isArray(allowed) && allowed.includes(level)) return level;
  if (level === "ultra") {
    if (Array.isArray(allowed) && allowed.includes("max")) return "max";
    return "xhigh";
  }
  if (level === "max") return "xhigh";
  return level;
}

// Apply unified thinking config to body in the resolved provider-native format.
function applyFormat(fmt, body, cfg, caps, model = null, provider = null) {
  const none = cfg.mode === "none";
  const canDisable = caps.thinkingCanDisable !== false;
  // Model cannot disable thinking → clamp "none" to minimal effort instead.
  const eff = none && !canDisable ? { mode: "level", level: "minimal" } : cfg;

  switch (fmt) {
    case "openai":{
        if (none && canDisable) {body.reasoning_effort = "none";break;}
        const level = toLevel(eff);
        // Config-driven: preserve supported effort; nearest sibling otherwise.
        if (level) body.reasoning_effort = resolveOpenAiEffort(level, provider, model);
        break;
      }
    case "ollama":{
        if (none && canDisable) {body.reasoning_effort = "none";break;}
        const level = toLevel(eff);
        if (level) body.reasoning_effort = level === "xhigh" ? "max" : level;
        break;
      }
    case "commandcode":{
        const level = toLevel(eff);
        const levels = getThinkingLevels(provider, model);
        if (level && levels?.includes(level)) {
          const params = body.params && isObject(body.params) ? body.params : body;
          params.reasoning_effort = level;
        }
        break;
      }
    case "claude-adaptive":{
        // disabled must NOT carry display (Anthropic rejects display on type:"disabled").
        if (none && canDisable) {body.thinking = { type: "disabled" };break;}
        body.output_config = { effort: toClaudeAdaptiveEffort(eff, caps, provider) };
        // Opus 4.7/4.8/Sonnet5/Fable5/Mythos5 default thinking.display to "omitted",
        // so explicitly request summarized to keep reasoning summary flowing to clients.
        // Harmless on 4.6/Sonnet4.6 where "summarized" is already the default.
        body.thinking = { type: "adaptive", display: "summarized" };
        break;
      }
    case "claude-budget":{
        if (none && canDisable) {body.thinking = { type: "disabled" };break;}
        const budget = toBudget(eff, caps.thinkingRange);
        body.thinking = budget === -1 ? { type: "enabled" } : { type: "enabled", budget_tokens: budget || 8192 };
        break;
      }
    case "gemini-level":{
        const level = none ? "minimal" : toGeminiThinkingLevel(eff);
        setGeminiThinking(body, { thinkingLevel: level, includeThoughts: level !== "minimal" });
        ensureGeminiOutputFloor(body, geminiLevelOutputFloor(level), caps);
        break;
      }
    case "gemini-budget":{
        if (none && canDisable) {setGeminiThinking(body, { thinkingBudget: 0, includeThoughts: false });break;}
        const budget = toBudget(eff, caps.thinkingRange);
        setGeminiThinking(body, { thinkingBudget: budget ?? -1, includeThoughts: true });
        ensureGeminiOutputFloor(body, geminiBudgetOutputFloor(budget ?? -1), caps);
        break;
      }
    case "zai":{
        // Z.ai ignores thinking.disabled → must use enable_thinking:false to turn off.
        if (none && canDisable) {body.enable_thinking = false;delete body.thinking;break;}
        body.thinking = { type: "enabled" };
        // Z.ai GLM supports high/max reasoning_effort when thinking is enabled.
        const level = toLevel(eff);
        if (level) body.reasoning_effort = level === "xhigh" || level === "max" ? "max" : "high";
        break;
      }
    case "qwen":{
        if (none && canDisable) {body.enable_thinking = false;break;}
        body.enable_thinking = true;
        const budget = toBudget(eff, caps.thinkingRange);
        if (Number.isFinite(budget) && budget > 0) body.thinking_budget = budget;
        break;
      }
    case "deepseek":{
        if (none && canDisable) {body.thinking = { type: "disabled" };break;}
        body.thinking = { type: "enabled" };
        // Native DeepSeek V4 accepts reasoning_effort "max"; legacy V3.2 models
        // (deepseek-chat/deepseek-reasoner) only accept low/high on the wire.
        const level = toLevel(eff);
        const wantsMax = level === "xhigh" || level === "max";
        body.reasoning_effort = wantsMax && isNativeDeepSeekV4(provider, model) ? "max" : "high";
        break;
      }
    case "kimi":{
        if (none && canDisable) {body.thinking = { type: "disabled" };break;}
        const levels = getThinkingLevels(provider, model);
        const effort = levels?.length === 1 && levels[0] === "max" ? "max" : toKimiReasoningEffort(eff);
        if (effort) body.reasoning_effort = effort;
        break;
      }
    case "minimax":{
        // M3 adaptive; M2.x cannot disable (handled via canDisable clamp).
        body.thinking = { type: none && canDisable ? "disabled" : "adaptive" };
        break;
      }
    case "hunyuan":{
        if (none && canDisable) {body.thinking = { type: "disabled" };break;}
        const budget = toBudget(eff, caps.thinkingRange);
        body.thinking = budget === -1 ? { type: "enabled" } : { type: "enabled", budget_tokens: budget || 8192 };
        break;
      }
    case "step":{
        if (none && canDisable) break;
        const level = toLevel(eff);
        if (level) body.reasoning_effort = level === "xhigh" || level === "max" ? "high" : level;
        break;
      }
    case "kiro":
      // Kiro thinking handled via system-tag injection in openai-to-kiro.js; no body field here.
      break;
    default:
      break;
  }
}

// Public entry: normalize thinking for the resolved target format.
// Mutates and returns body. No-op when model has no reasoning capability.
// `intent` is a pre-captured config (from captureThinking on the original body);
// falls back to extracting from the current body when omitted.
export function applyThinking(targetFormat, model, body, provider = null, intent = undefined, modelCapabilities = null) {
  if (!body || !isObject(body)) return body;

  // ponytail: ceiling = ollama under claude transport. Lift into PROVIDERS[ollama].quirks
  // or a capability flag if a second native-claude provider lands.
  // Explicit custom thinking-related overrides (customKeys marker) must not be
  // bypassed by the native-Claude compatibility shortcut below.
  const hasExplicitThinkingOverride =
  modelCapabilities?.customKeys instanceof Set &&
  ["reasoning", "thinkingCanDisable", "thinkingRange", "thinkingFormat"].
  some((k) => modelCapabilities.customKeys.has(k));
  const preservesNativeClaudeThinking = (PROVIDERS[provider]?.quirks?.preserveNativeClaudeThinking ||
  provider === "ollama" ||
  provider === "ollama-local") &&
  !hasExplicitThinkingOverride;
  if (preservesNativeClaudeThinking && targetFormat === FORMATS.CLAUDE) {
    // WR-01: chatCore.js:66-68 injects `reasoning_effort` (OpenAI field) for level-mode
    // providerThinking configs. On the Claude wire it is not a valid Messages field.
    // Normalize to Claude shape: fold into output_config.effort unless a Claude-native
    // thinking field is already present (let the client's Claude field win). Keep the
    // early-return so stripAll does not undo Claude-native fields.
    if (body.reasoning_effort) {
      if (body.thinking) {
        delete body.reasoning_effort;
      } else {
        body.output_config = body.output_config || {};
        if (!body.output_config.effort) body.output_config.effort = body.reasoning_effort;
        delete body.reasoning_effort;
      }
    }
    return body;
  }

  const { cleanModel, override } = parseSuffix(model);

  // Grok Build (grok-cli) rejects reasoning.effort but still accepts summary/
  // encrypted-content continuity. Let the executor own the wire normalization so
  // a caller-supplied summary is not stripped by the reasoning:false capability.
  // Upstream decolua/9router#2590.
  if (provider === "grok-cli" && cleanModel === "grok-build") {
    return body;
  }

  const cfg = override || intent || extractThinking(body);
  const caps = modelCapabilities || getCapabilitiesForModel(provider, cleanModel);

  // Model cannot reason → strip any stray thinking fields.
  if (!caps.reasoning) {
    stripAll(body);
    return body;
  }
  if (!cfg) return body;

  const fmt = resolveFormat(targetFormat, cleanModel, provider, caps);
  stripAll(body);
  applyFormat(fmt, body, cfg, caps, cleanModel, provider);
  return body;
}

// Apply per-transport requestDefaults from the provider registry when the client
// did not set a field. Multi-endpoint providers can scope defaults to a format
// (e.g. MiniMax openai transport → reasoning_split).
// Ported from upstream decolua/9router PR #2525 (head 72385571c6).
export function applyTransportRequestDefaults(targetFormat, body, provider = null) {
  if (!body || !isObject(body) || !provider) return body;
  const config = PROVIDERS[provider];
  if (!config) return body;

  let defaults = null;
  const transports = config.transports;
  if (Array.isArray(transports) && transports.length) {
    defaults = transports.find((t) => t.format === targetFormat)?.requestDefaults;
  } else {
    defaults = config.requestDefaults ?? config.transport?.requestDefaults;
  }

  if (!defaults || !isObject(defaults)) return body;
  for (const [key, value] of Object.entries(defaults)) {
    if (body[key] === undefined) body[key] = value;
  }
  return body;
}