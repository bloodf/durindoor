// Provider definitions
import REGISTRY from "open-sse/providers/registry/index.js";
import { RISK_NOTICE } from "@/shared/constants/providersDisplay";
import { isString } from "../utils/typeChecks.js";

const MEDIA_ENTRY_KEYS = [
"serviceKinds", "ttsConfig", "sttConfig", "embeddingConfig",
"imageConfig", "imageToTextConfig", "videoConfig", "musicConfig",
"searchViaChat", "searchConfig", "fetchConfig",
"modelsFetcher", "mediaPriority", "hiddenKinds"];


// Build provider UI object from registry entry
function buildProviderEntry(r) {
  const mediaFields = {};
  if (r.media) Object.assign(mediaFields, r.media);
  for (const k of MEDIA_ENTRY_KEYS) {
    if (r[k] !== undefined) mediaFields[k] = r[k];
  }
  const display = { ...(r.display || {}) };
  if (display.deprecationNotice === "RISK_NOTICE") display.deprecationNotice = RISK_NOTICE;
  return {
    ...display,
    id: r.id,
    alias: r.uiAlias || r.alias,
    ...(r.hidden ? { hidden: true } : null),
    ...mediaFields,
    ...(r.priority !== undefined ? { priority: r.priority } : null),
    ...(r.hasFree ? { hasFree: true } : null),
    ...(r.thinkingConfig ? { thinkingConfig: r.thinkingConfig } : null),
    ...(r.regions ? { regions: r.regions, defaultRegion: r.defaultRegion } : null),
    ...(r.hasProviderSpecificData ? { hasProviderSpecificData: true } : null),
    ...(r.noAuth ? { noAuth: true } : null),
    ...(r.oauth ? { oauth: true } : null),
    ...(r.transport?.baseUrl ? { defaultBaseUrl: r.transport.baseUrl } : null),
    ...(r.passthroughModels ? { passthroughModels: true } : null),
    ...(r.passthroughConnectionWideErrors ? { passthroughConnectionWideErrors: true } : null),
    ...(r.hasOAuth ? { hasOAuth: true } : null),
    ...(r.authModes ? { authModes: r.authModes } : null),
    ...(r.authType ? { authType: r.authType } : null),
    ...(r.authHint ? { authHint: r.authHint } : null),
    ...(r.aliases ? { aliases: r.aliases } : null),
    ...(r.oauth?.flowType ? { flowType: r.oauth.flowType } : null)
  };
}

const byCategory = (cat) => Object.fromEntries(
  REGISTRY.filter((r) => r.category === cat).map((r) => [r.id, buildProviderEntry(r)])
);

export const FREE_PROVIDERS = byCategory("free");
export const FREE_TIER_PROVIDERS = byCategory("freeTier");

// Thinking config definitions
// options: list of selectable modes ("auto" = no override from server)
// defaultMode: fallback when user hasn't configured
// extended: claude-style thinking (thinking.type + budget_tokens) — used by most providers
// effort: openai-style reasoning_effort — only openai + codex
export const THINKING_CONFIG = {
  extended: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
    defaultBudgetTokens: 10000
  },
  effort: {
    options: ["auto", "none", "low", "medium", "high"],
    defaultMode: "auto"
  }
};

export const OAUTH_PROVIDERS = byCategory("oauth");
export const APIKEY_PROVIDERS = byCategory("apikey");

// Web Cookie Providers (use browser session cookie instead of API key)
export const WEB_COOKIE_PROVIDERS = byCategory("webCookie");

// Media provider kinds — each kind maps to a route and endpoint config
export const MEDIA_PROVIDER_KINDS = [
{ id: "embedding", label: "Embedding", icon: "data_array", endpoint: { method: "POST", path: "/v1/embeddings" } },
{ id: "rerank", label: "Rerank", icon: "sort", endpoint: { method: "POST", path: "/v1/rerank" } },
{ id: "image", label: "Text to Image", icon: "brush", endpoint: { method: "POST", path: "/v1/images/generations" } },
{ id: "imageToText", label: "Image to Text", icon: "image_search", endpoint: { method: "POST", path: "/v1/images/understanding" } },
{ id: "tts", label: "Text To Speech", icon: "record_voice_over", endpoint: { method: "POST", path: "/v1/audio/speech" } },
{ id: "stt", label: "Speech To Text", icon: "mic", endpoint: { method: "POST", path: "/v1/audio/transcriptions" } },
{ id: "webSearch", label: "Web Search", icon: "travel_explore", endpoint: { method: "POST", path: "/v1/search" } },
{ id: "webFetch", label: "Web Fetch", icon: "language", endpoint: { method: "POST", path: "/v1/web/fetch" } },
{ id: "video", label: "Video", icon: "movie", endpoint: { method: "POST", path: "/v1/video/generations" } },
{ id: "music", label: "Music", icon: "music_note", endpoint: { method: "POST", path: "/v1/audio/music" } }];


export const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-";
export const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-";
export const CUSTOM_EMBEDDING_PREFIX = "custom-embedding-";

export function isOpenAICompatibleProvider(providerId) {
  return isString(providerId) && providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
}

export function isAnthropicCompatibleProvider(providerId) {
  return isString(providerId) && providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
}

export function isLocalOllamaProvider(providerId) {
  return providerId === "ollama-local";
}

export function isCustomEmbeddingProvider(providerId) {
  return isString(providerId) && providerId.startsWith(CUSTOM_EMBEDDING_PREFIX);
}

/**
 * Classify a provider by its free-tier status for badge rendering.
 * @param {string} providerId
 * @returns {"free" | "freeTier" | null}
 */
export function classifyFreeProvider(providerId) {
  if (!isString(providerId)) return null;
  if (FREE_PROVIDERS[providerId]) return "free";
  if (FREE_TIER_PROVIDERS[providerId]) return "freeTier";
  return null;
}

// All providers (combined)
export const AI_PROVIDERS = { ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...OAUTH_PROVIDERS, ...APIKEY_PROVIDERS, ...WEB_COOKIE_PROVIDERS };

// Auth methods
export const AUTH_METHODS = {
  oauth: { id: "oauth" },
  apikey: { id: "apikey" },
  cookie: { id: "cookie" }
};

// Helper: Get provider by alias
export function getProviderByAlias(alias) {
  for (const provider of Object.values(AI_PROVIDERS)) {
    if (provider.alias === alias || provider.id === alias || provider.aliases?.includes(alias)) {
      return provider;
    }
  }
  return null;
}

/**
 * Is this something the router could route to at all, as opposed to a name it has
 * never heard of?
 *
 * Two things count. The registry, resolved through aliases so "cc" is as valid as
 * "claude". And the user-defined compatible nodes, whose ids carry a prefix and
 * are deliberately absent from the registry — they reach account selection by
 * exactly the same path, so a registry-only check would report a user's own
 * node as an unknown provider the moment its connection went inactive.
 *
 * Says nothing about whether an account is connected. That is a separate
 * question with a separate answer for the caller.
 *
 * @param {string | null | undefined} aliasOrId
 * @returns {boolean}
 */
export function isRoutableProvider(aliasOrId) {
  if (!aliasOrId) return false;
  if (getProviderByAlias(aliasOrId)) return true;
  return (
    (isOpenAICompatibleProvider(aliasOrId) && aliasOrId.length > OPENAI_COMPATIBLE_PREFIX.length) ||
    (isAnthropicCompatibleProvider(aliasOrId) && aliasOrId.length > ANTHROPIC_COMPATIBLE_PREFIX.length)
  );
}

 // Helper: Get provider ID from alias
 export function resolveProviderId(aliasOrId) {
   const provider = getProviderByAlias(aliasOrId);
   return provider?.id || aliasOrId;
}

/**
 * Per-account requests-per-minute defaults from decolua/9router#3203.
 * Unlisted providers are unlimited; persisted settings may override either case.
 */
export const DEFAULT_PROVIDER_RPM = Object.freeze({ nvidia: 40 });
export const MAX_PROVIDER_RPM = 10_000;

/** Resolve a persisted provider override, where blank uses defaults and zero is unlimited. */
export function resolveProviderRpm(settings, providerId) {
  const configured = settings?.rpmByProvider?.[providerId];
  if (configured === 0 || configured === "0") return 0;
  const rpm = Number(configured);
  if (Number.isSafeInteger(rpm) && rpm > 0) return Math.min(rpm, MAX_PROVIDER_RPM);
  return DEFAULT_PROVIDER_RPM[providerId] || 0;
}

// Helper: Get alias from provider ID
export function getProviderAlias(providerId) {
  const provider = AI_PROVIDERS[providerId];
  return provider?.alias || providerId;
}

// Alias to ID mapping (for quick lookup)
export const ALIAS_TO_ID = Object.values(AI_PROVIDERS).reduce((acc, p) => {
  acc[p.alias] = p.id;
  for (const alias of p.aliases || []) {
    acc[alias] = p.id;
  }
  return acc;
}, {});

// ID to Alias mapping
export const ID_TO_ALIAS = Object.values(AI_PROVIDERS).reduce((acc, p) => {
  acc[p.id] = p.alias;
  return acc;
}, {});

// Hidden registry entries remain routable when already configured elsewhere,
// but they are not selectable or creatable through generic provider forms.
export function isHiddenProvider(providerId) {
  return AI_PROVIDERS[providerId]?.hidden === true;
}

// Helper: Get providers by service kind (e.g. "tts", "embedding", "image")
// Providers without serviceKinds default to ["llm"]
export function getProvidersByKind(kind) {
  return Object.values(AI_PROVIDERS).
  filter((p) => {
    const kinds = p.serviceKinds ?? ["llm"];
    if (!kinds.includes(kind)) return false;
    if (p.hidden) return false;
    if (p.hiddenKinds?.includes(kind)) return false;
    return true;
  }).
  sort((a, b) => (a.priority ?? a.mediaPriority ?? 999) - (b.priority ?? b.mediaPriority ?? 999));
}

// Derive từ registry features flags
export const USAGE_SUPPORTED_PROVIDERS = REGISTRY.
filter((r) => r.features?.usage).
map((r) => r.id);

export const USAGE_APIKEY_PROVIDERS = REGISTRY.
filter((r) => r.features?.usageApikey).
map((r) => r.id);