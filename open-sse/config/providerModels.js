import { stripRecognizedContextSuffix } from "../services/contextSuffix.js";
import REGISTRY from "../providers/registry/index.js";
// PROVIDER_MODELS now built from providers/registry (transport + models co-located)
import { PROVIDER_MODELS } from "../providers/index.js";
import { modelQuotaFamily, modelStrip, modelTargetFormat, modelSupportedFormats, modelForceStream, modelForceNonStreaming, normalizeModelId } from "../providers/models/schema.js";
import { CODEX_REVIEW_SUFFIX } from "../providers/models/helpers.js";
import { dothooshFamilyFormats } from "../providers/dothooshCatalog.js";
import { KIRO_FAMILY_PROVIDERS } from "../providers/models/kiroVariants.js";
import { parseSuffix } from "../translator/concerns/thinkingSuffix.js";
import { extractThinking } from "../translator/concerns/thinkingUnified.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

export { PROVIDER_MODELS };


// Helper functions
export function getProviderModels(aliasOrId) {
  return PROVIDER_MODELS[aliasOrId] || PROVIDER_MODELS[PROVIDER_ID_TO_ALIAS[aliasOrId]] || [];
}

export function getDefaultModel(aliasOrId) {
  return getProviderModels(aliasOrId)[0]?.id || null;
}

// Providers whose registry uses dots in version numbers (e.g. "claude-sonnet-4.5").
// For these, we tolerate clients sending dashes ("claude-sonnet-4-5") by normalizing
// digit-hyphen-digit to digit-dot-digit before lookup. Other providers are left untouched.
const DOT_VERSION_PROVIDERS = KIRO_FAMILY_PROVIDERS;

/**
 * Find a registry entry by id. For Kiro models, tolerates dash/dot version
 * separators ("claude-sonnet-4-5" ~= "claude-sonnet-4.5"); other providers use
 * exact match only.
 *
 * Match catalog metadata after removing only recognized request-only thinking controls.
 * Unknown parenthesized values remain part of opaque model IDs (decolua/9router#3332).
 * Service-tier suffixes are provider-scoped: only OpenAI and Codex read
 * `fast`/`standard` as a tier control, so on every other provider the suffix
 * stays part of the opaque model ID and the catalog row is looked up by it.
 */
function findModel(models, modelId, aliasOrId) {
  if (!models) return undefined;
  const { cleanModel } = parseSuffix(modelId, aliasOrId);
  const found = models.find((m) => m.id === cleanModel || m.aliases?.includes(cleanModel));
  if (found) return found;
  if (!DOT_VERSION_PROVIDERS.has(aliasOrId)) return undefined;
  const normalized = normalizeModelId(cleanModel);
  if (normalized === cleanModel) return undefined;
  return models.find((m) => m.id === normalized || m.aliases?.includes(normalized));
}

export function isValidModel(aliasOrId, modelId, passthroughProviders = new Set()) {
  if (passthroughProviders.has(aliasOrId)) return true;
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return false;
  const baseId = parseSuffix(modelId, aliasOrId).cleanModel;
  return !!(findModel(models, modelId, aliasOrId) || findModelAlias(models, baseId));
}

export function findModelName(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return modelId;
  const found = findModel(models, modelId, aliasOrId);
  return found?.name || modelId;
}

function getOpenCodeZenPassthroughTargetFormat(modelId) {
  if (!isString(modelId)) return null;
  if (modelId.startsWith("claude-")) return "claude";
  if (/^gpt-5(?:[.-]|$)/.test(modelId)) return "openai-responses";
  return null;
}

// MiniMax M3 and M3.1 Flash Preview tool/vision calls use native OpenAI Chat
// Completions even for Claude-source clients.
const OPENAI_FORMAT_MINIMAX_PROVIDERS = new Set(["minimax", "minimax-cn"]);
const MINIMAX_OPENAI_TOOL_MODELS = new Set(["MiniMax-M3", "MiniMax-M3.1-Flash", "MiniMax-M3.1-Flash-Preview"]);

// DotHoosh has no static model list (its catalog is live), so the lanes come
// from the model family. The provider id and its alias both resolve.
const DOTHOOSH_PROVIDERS = new Set(["dothoosh", "dh"]);

// OpenCode Go serves these only on /responses; they are passthrough ids here (9router #3975).
const OPENCODE_GO_ALIASES = new Set(["opencode-go", "ocg"]);
const OPENCODE_GO_UNLISTED_RESPONSES_MODELS = new Set(["gpt-5.6-luna", "grok-4.6"]);

// OpenAI rejects function tools with reasoning_effort on Chat Completions for the
// GPT-6 and GPT-5.6+ families, so ids newer than the catalog use Responses (OmniRoute #21279).
const OPENAI_RESPONSES_FAMILY = /^gpt-(?:[6-9]|5\.[6-9])/i;

export function getModelTargetFormat(aliasOrId, modelId) {
  if (DOTHOOSH_PROVIDERS.has(aliasOrId)) return dothooshFamilyFormats(modelId)?.targetFormat || null;
  const models = PROVIDER_MODELS[aliasOrId];
  const configuredTargetFormat = models ? modelTargetFormat(findModel(models, modelId, aliasOrId)) : null;
  if (configuredTargetFormat) return configuredTargetFormat;
  if (aliasOrId === "openai" && OPENAI_RESPONSES_FAMILY.test(parseSuffix(modelId, aliasOrId).cleanModel)) return "openai-responses";
  if (OPENCODE_GO_ALIASES.has(aliasOrId) && OPENCODE_GO_UNLISTED_RESPONSES_MODELS.has(parseSuffix(modelId, aliasOrId).cleanModel)) return "openai-responses";
  if (OPENAI_FORMAT_MINIMAX_PROVIDERS.has(aliasOrId) && MINIMAX_OPENAI_TOOL_MODELS.has(parseSuffix(modelId, aliasOrId).cleanModel)) return "openai";
  // OpenCode Zen allows passthrough model IDs, but API-family prefixes still need
  // their native translators instead of the provider default Chat Completions route.
  if (aliasOrId === "opencode-zen") return getOpenCodeZenPassthroughTargetFormat(modelId);
  return null;
}

// Declared upstream formats for a model. Null keeps providers with no per-model
// endpoint restriction on their existing transport-selection path.
export function getModelSupportedFormats(aliasOrId, modelId) {
  // ParalonCloud's live GPU catalog is not in the seed. Chat and native
  // Responses both accept those ids; embeddings stay off the chat transports.
  if (aliasOrId === "paraloncloud" || aliasOrId === "paralon") {
    const models = PROVIDER_MODELS[aliasOrId] || PROVIDER_MODELS.paraloncloud;
    const model = findModel(models, modelId, aliasOrId);
    if (!model || !model.kind || model.kind === "llm") return ["openai", "openai-responses"];
  }
  if (DOTHOOSH_PROVIDERS.has(aliasOrId)) return dothooshFamilyFormats(modelId)?.supportedFormats || null;
  // The Kimi Platform exposes all three APIs for platform model IDs, including
  // IDs discovered after the bundled catalog was published.
  if (aliasOrId === "kimi") return ["openai", "claude", "openai-responses"];
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  const model = findModel(models, modelId, aliasOrId);
  const declared = modelSupportedFormats(model);
  if (declared) return declared;
  if (!model) {
    // Y-API seeds no static catalog: its model ids are `vendor/model` and come from
    // authenticated discovery (GET /v1/models), so the model is never found here.
    // The provider documents one catalog served over both protocols —
    // "the Anthropic-compatible endpoint, serving the same catalog as
    // /chat/completions" (https://y-api.bestvirtualgoods.com/openapi.json) — so a
    // discovered id is routable over both transports.
    if (aliasOrId === "y-api") return ["openai", "claude"];
    return null;
  }
  if ((aliasOrId === "minimax" || aliasOrId === "minimax-cn") && /^MiniMax-M[23]/.test(model.id)) {
    return ["openai", "claude", "openai-responses"];
  }
  if (model.kind && model.kind !== "llm") return null;
  if (aliasOrId === "xai") return ["openai", "openai-responses"];
  if (aliasOrId === "openai") {
    return /^(?:gpt-3\.5|gpt-4(?:-|$))/.test(model.id) ? ["openai"] : ["openai", "openai-responses"];
  }
  return null;
}

// Per-model streaming requirement. False keeps the provider-level
// `forceStream` (or client-negotiated) behavior.
export function getModelForceStream(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return false;
  return modelForceStream(findModel(models, modelId, aliasOrId));
}

export function getModelForceNonStreaming(aliasOrId, modelId) {
  return modelForceNonStreaming(findModel(PROVIDER_MODELS[aliasOrId], modelId, aliasOrId));
}

/** Raw registry row for a model (suffix-aware), for per-model executor hints such as defaultLocation. */
export function getModelMeta(aliasOrId, modelId) {
  return findModel(PROVIDER_MODELS[aliasOrId], modelId, aliasOrId) || null;
}

export function getModelType(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  const found = findModel(models, modelId, aliasOrId);
  return found?.kind || found?.type || null;
}


/** Resolve a saved-config alias without adding it to the advertised model list. */
function findModelAlias(models, modelId) {
  return models?.find((model) => model.aliases?.includes(modelId));
}
const TIER_ALIASES = { xhigh: "high", max: "high", auto: "high", minimal: "low", none: "low", disabled: "low", off: "low" };

function normalizeTier(level) {
  if (!isString(level) || !level.trim()) return null;
  const value = level.trim().toLowerCase();
  return TIER_ALIASES[value] || value;
}

function budgetTier(budget) {
  const value = Number(budget);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value > 16384 ? "high" : value <= 4096 ? "low" : "medium";
}

/**
 * Requested catalog tier for `<model>-<tier>` rows (upstream 9router 82aeb907).
 * Adaptive/auto select high; disabled/none/zero budget select low. Other precedence:
 * request suffix intent, then body effort, then thinking budget.
 * Returns null when nothing names a tier.
 */
export function resolveRequestedModelTier(thinkingIntent, body = null, provider = null) {
  // Hydrogen has a registered Antigravity xhigh row; keep other providers unchanged.
  const tier = (value) => ["xhigh", "max"].includes(value?.toLowerCase?.().trim()) && ["ag", "agy", "antigravity"].includes(provider) ? value.toLowerCase().trim() : normalizeTier(value);
  if (thinkingIntent?.mode === "level") return tier(thinkingIntent.level);
  if (thinkingIntent?.mode === "budget") return budgetTier(thinkingIntent.budget);
  if (thinkingIntent) return null;
  if (body?.thinking?.type === "adaptive") return "high";
  if (body?.thinking?.type === "disabled" || body?.thinking?.type === "none") return "low";
  const effort = body?.reasoning_effort || body?.output_config?.effort || body?.reasoning?.effort;
  if (isString(effort) && effort.trim()) return tier(effort);
  const budget = Number(body?.thinking?.budget_tokens);
  if (body?.thinking && Number.isFinite(budget) && budget === 0) return "low";
  return budgetTier(body?.thinking?.budget_tokens);
}

/**
 * Provider-level thinking override from dashboard settings, applied only when
 * the client did not set the matching field. Returns a new body.
 * on/off -> body.thinking; none strips thinking fields; levels -> reasoning_effort.
 * A level also replaces a client intent that names none (bare adaptive, `auto`),
 * except on native passthrough, which forwards the client's thinking fields as-is.
 */
export function applyProviderThinkingOverride(body, providerThinking, { passthrough = false } = {}) {
  const mode = providerThinking?.mode;
  if (!mode || mode === "auto") return body;
  if (mode === "none") {
    // Upstream decolua/9router#2534: explicit "none" means strip thinking params entirely
    // (some upstreams, e.g. xAI grok-composer, 400 if reasoning fields are sent at all).
    const { thinking: _thinking, reasoning_effort: _effort, reasoning: _reasoning, ...rest } = body;
    return rest;
  }
  if (mode === "on") return body.thinking ? body : { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
  if (mode === "off") return body.thinking ? body : { ...body, thinking: { type: "disabled" } };
  if (!passthrough && isUnlevelledThinking(body)) return replaceUnlevelledThinking(body, mode);
  return body.reasoning_effort ? body : { ...body, reasoning_effort: mode };
}

/** "Think, level unspecified". `between_tools` is excluded: it names a thinking mode. */
function isUnlevelledThinking(body) {
  const intent = extractThinking(body);
  return intent?.mode === "auto" && !intent.thinkingType;
}

// Each of these outranks reasoning_effort in extractThinking, so they have to go.
function replaceUnlevelledThinking(body, level) {
  const { thinking: _thinking, reasoningEffort: _camelEffort, output_config: outputConfig, ...rest } = body;
  const { effort: _outputEffort, ...otherOutputConfig } = outputConfig || {};
  return {
    ...rest,
    ...(Object.keys(otherOutputConfig).length && { output_config: otherOutputConfig }),
    reasoning_effort: level
  };
}

/** Upstream id chatCore will dispatch for this request (quota/cooldown keys). */
export function getDispatchUpstreamModelId(aliasOrId, modelId, body = null, providerThinking = null) {
  const effectiveBody = body ? applyProviderThinkingOverride(body, providerThinking) : null;
  return getModelUpstreamId(aliasOrId, modelId, resolveRequestedModelTier(parseSuffix(modelId, aliasOrId).override, effectiveBody, aliasOrId));
}

function findUpstreamModel(aliasOrId, modelId, tier) {
  const parsed = parseSuffix(modelId, aliasOrId);
  const baseId = parsed.cleanModel;
  const models = PROVIDER_MODELS[aliasOrId] || PROVIDER_MODELS[PROVIDER_ID_TO_ALIAS[aliasOrId]];
  const requestedTier = tier || resolveRequestedModelTier(parsed.override, null, aliasOrId);
  // `<model>-<tier>` rows are tier variants only in catalogs that use thinking
  // presets (Antigravity today), including rows there without a preset; in
  // other catalogs (codex, grok) `<model>-<level>` ids are distinct models.
  const tieredRow = requestedTier && isString(baseId) ?
    findModel(models, `${baseId}-${requestedTier}`, aliasOrId) ||
      (["xhigh", "max"].includes(requestedTier) && ["ag", "agy", "antigravity"].includes(aliasOrId) ? findModel(models, `${baseId}-high`, aliasOrId) : null) : null;
  const tiered = tieredRow && models.some((row) => parseSuffix(row.upstreamModelId).override) ? tieredRow : null;
  return { baseId, found: tiered || findModel(models, modelId, aliasOrId) || findModelAlias(models, baseId) };
}

export function getModelUpstreamId(aliasOrId, modelId, tier = null) {
  // Only recognized request-only thinking controls participate in catalog
  // lookup. Unknown parentheses may be part of a real passthrough/custom model
  // ID and must remain opaque instead of being rewritten through a base alias.
  // The control is never re-appended: provider-facing model IDs are always clean,
  // while thinking intent travels in request-scoped translation context.
  // Catalog upstreamModelId presets such as "gemini-3.8-flash-high(high)" are
  // stripped here too; getModelUpstreamThinkingIntent exposes the preset level.
  const exact = findUpstreamModel(aliasOrId, modelId, tier);
  const { baseId, found } = exact.found ? exact : findUpstreamModel(aliasOrId, stripRecognizedContextSuffix(modelId), tier);
  if (found?.upstreamModelId) return parseSuffix(found.upstreamModelId).cleanModel;
  if (found?.id) return found.id;
  // Every ClinePass wire id is `cline-pass/*`; the live catalog exposes short ids
  // that the static list may not carry yet (decolua/9router#4674).
  if (aliasOrId === "clinepass" && isString(baseId) && !baseId.includes("/")) return `cline-pass/${baseId}`;
  if (aliasOrId === "cx" && isString(baseId) && baseId.endsWith(CODEX_REVIEW_SUFFIX)) {
    return baseId.slice(0, -CODEX_REVIEW_SUFFIX.length);
  }
  return baseId;
}

/** Thinking preset carried by a catalog upstreamModelId suffix, or null. */
export function getModelUpstreamThinkingIntent(aliasOrId, modelId, tier = null) {
  const upstreamModelId = findUpstreamModel(aliasOrId, modelId, tier).found?.upstreamModelId;
  return parseSuffix(upstreamModelId).override;
}

export function getCanonicalModelId(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  const baseId = parseSuffix(modelId, aliasOrId).cleanModel;
  return (findModel(models, modelId, aliasOrId) || findModelAlias(models, baseId))?.id || null;
}

export function getModelQuotaFamily(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return modelQuotaFamily(findModel(models, modelId, aliasOrId));
}

// Short aliases are derived from the full registry, including transportless media
// providers, so provider-id lookups can still reach PROVIDER_MODELS alias keys.
export const OAUTH_ALIASES = Object.fromEntries(
  REGISTRY.filter((r) => r.alias && r.alias !== r.id).map((r) => [r.id, r.alias])
);

export const PROVIDER_ID_TO_ALIAS = Object.fromEntries(
  REGISTRY.map((r) => [r.id, r.alias || r.id])
);

export function getModelsByProviderId(providerId) {
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  return PROVIDER_MODELS[alias] || [];
}

// Get strip list for a model entry (explicit opt-in only)
// Returns array of content types to strip, e.g. ["image", "audio"]
export function getModelStrip(alias, modelId) {
  return modelStrip(findModel(PROVIDER_MODELS[alias], modelId, alias));
}
