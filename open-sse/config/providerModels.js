import REGISTRY from "../providers/registry/index.js";
// PROVIDER_MODELS now built from providers/registry (transport + models co-located)
import { PROVIDER_MODELS } from "../providers/index.js";
import { modelQuotaFamily, modelStrip, modelTargetFormat, modelSupportedFormats, normalizeModelId } from "../providers/models/schema.js";
import { CODEX_REVIEW_SUFFIX } from "../providers/models/helpers.js";
import { parseSuffix } from "../translator/concerns/thinkingSuffix.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

export { PROVIDER_MODELS };


// Helper functions
export function getProviderModels(aliasOrId) {
  return PROVIDER_MODELS[aliasOrId] || [];
}

export function getDefaultModel(aliasOrId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return models?.[0]?.id || null;
}

// Providers whose registry uses dots in version numbers (e.g. "claude-sonnet-4.5").
// For these, we tolerate clients sending dashes ("claude-sonnet-4-5") by normalizing
// digit-hyphen-digit to digit-dot-digit before lookup. Other providers are left untouched.
const DOT_VERSION_PROVIDERS = new Set(["kr", "kiro"]);

/**
 * Find a registry entry by id. For Kiro models, tolerates dash/dot version
 * separators ("claude-sonnet-4-5" ~= "claude-sonnet-4.5"); other providers use
 * exact match only.
 *
 * Match catalog metadata after removing only recognized request-only thinking controls.
 * Unknown parenthesized values remain part of opaque model IDs (decolua/9router#3332).
 */
function findModel(models, modelId, aliasOrId) {
  if (!models) return undefined;
  const { cleanModel } = parseSuffix(modelId);
  const found = models.find((m) => m.id === cleanModel);
  if (found) return found;
  if (!DOT_VERSION_PROVIDERS.has(aliasOrId)) return undefined;
  const normalized = normalizeModelId(cleanModel);
  if (normalized === cleanModel) return undefined;
  return models.find((m) => m.id === normalized);
}

export function isValidModel(aliasOrId, modelId, passthroughProviders = new Set()) {
  if (passthroughProviders.has(aliasOrId)) return true;
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return false;
  return !!findModel(models, modelId, aliasOrId);
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

// Upstream decolua/9router#2533: MiniMax documents MiniMax-M3 tool calling on the
// standard OpenAI API surface, so M3 is routed through the OpenAI wire format +
// chatcompletion_v2 endpoint even for Claude-source clients.
const OPENAI_FORMAT_MINIMAX_PROVIDERS = new Set(["minimax", "minimax-cn"]);

export function getModelTargetFormat(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  const configuredTargetFormat = models ? modelTargetFormat(findModel(models, modelId, aliasOrId)) : null;
  if (configuredTargetFormat) return configuredTargetFormat;
  if (OPENAI_FORMAT_MINIMAX_PROVIDERS.has(aliasOrId) && modelId === "MiniMax-M3") return "openai";
  // OpenCode Zen allows passthrough model IDs, but API-family prefixes still need
  // their native translators instead of the provider default Chat Completions route.
  if (aliasOrId === "opencode-zen") return getOpenCodeZenPassthroughTargetFormat(modelId);
  return null;
}

// Declared upstream formats for a model. Null keeps providers with no per-model
// endpoint restriction on their existing transport-selection path.
export function getModelSupportedFormats(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  return modelSupportedFormats(findModel(models, modelId, aliasOrId));
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
export function getModelUpstreamId(aliasOrId, modelId) {
  // Only recognized request-only thinking controls participate in catalog
  // lookup. Unknown parentheses may be part of a real passthrough/custom model
  // ID and must remain opaque instead of being rewritten through a base alias.
  // The control is never re-appended: provider-facing model IDs are always clean,
  // while thinking intent travels in request-scoped translation context.
  const parsed = parseSuffix(modelId);
  const baseId = parsed.cleanModel;
  const models = PROVIDER_MODELS[aliasOrId] || PROVIDER_MODELS[PROVIDER_ID_TO_ALIAS[aliasOrId]];
  const found = findModel(models, modelId, aliasOrId) || findModelAlias(models, baseId);
  if (found?.upstreamModelId) return found.upstreamModelId;
  if (found?.id) return found.id;
  if (aliasOrId === "cx" && isString(baseId) && baseId.endsWith(CODEX_REVIEW_SUFFIX)) {
    return baseId.slice(0, -CODEX_REVIEW_SUFFIX.length);
  }
  return baseId;
}

/** Return the configured catalog id for a request model, or null for passthrough input. */
export function getCanonicalModelId(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return findModel(models, modelId, aliasOrId)?.id || null;
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