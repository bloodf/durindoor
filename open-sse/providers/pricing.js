import REGISTRY from "./registry/index.js";
import {
  isFreeModel,
  providerHasFreeModels } from
"../config/freeModelCatalog.js";
import { stripKiroSyntheticSuffixes } from "./models/kiroVariants.js";
import { normalizeModelId } from "./models/schema.js";

// Pricing rates for AI models — all rates in $/1M tokens
//
// Fallback order (first match wins):
//   1. PROVIDER_PRICING[provider][model]  — provider-specific override
//   2. MODEL_PRICING[model]               — canonical model price (provider-agnostic)
//   3. PATTERN_PRICING                    — glob pattern match (e.g. "codex-*")

// Alias→id and id→entry maps for resolving the provider half of a model string
// when classifying paid vs free. Built once from the registry single-source so
// per-model classification is O(1) (the /v1/models list carries hundreds).
import { isString } from "../../src/shared/utils/typeChecks.js";
const ALIAS_TO_PROVIDER_ID = {};
const PROVIDER_BY_ID = {};
for (const entry of REGISTRY) {
  PROVIDER_BY_ID[entry.id] = entry;
  ALIAS_TO_PROVIDER_ID[entry.id] = entry.id;
  if (entry.alias) ALIAS_TO_PROVIDER_ID[entry.alias] = entry.id;
  if (entry.uiAlias && entry.uiAlias !== entry.alias) ALIAS_TO_PROVIDER_ID[entry.uiAlias] = entry.id;
  for (const a of entry.aliases || []) ALIAS_TO_PROVIDER_ID[a] = entry.id;
}

/**
 * Split a "provider/model" string at the FIRST slash, preserving nested model
 * ids like "fireworks/accounts/fireworks/models/glm-5p2".
 */
function splitProviderModel(modelStr) {
  if (!isString(modelStr)) return { provider: "", model: "" };
  const slash = modelStr.indexOf("/");
  if (slash <= 0) return { provider: "", model: modelStr };
  return {
    provider: modelStr.slice(0, slash),
    model: modelStr.slice(slash + 1)
  };
}

function resolveProviderId(providerOrAlias) {
  return ALIAS_TO_PROVIDER_ID[providerOrAlias] || providerOrAlias;
}

function registryEntry(providerId) {
  return PROVIDER_BY_ID[providerId] || null;
}

function registryModel(entry, modelId) {
  if (!entry?.models) return null;
  return entry.models.find((m) => m.id === modelId) || null;
}

/**
 * Whether the registry entry for (provider, model) is explicitly marked free.
 * Honors per-model markers (name "(Free)", id ending in ":free"/"-free") and
 * provider-level no-auth/category:"free". Provider-wide `hasFree` is NOT an
 * exemption — a provider can mix free and priced models, so exemption needs
 * per-model evidence. Returns `null` when there is no signal either way so
 * callers fall through to pricing.
 */
function registryFreeSignal(providerId, modelId) {
  const entry = registryEntry(providerId);
  if (!entry) return null;
  if (entry.noAuth === true || entry.category === "free") return true;
  const m = registryModel(entry, modelId);
  if (!m) return null;
  if (m.free === true || m.isFree === true) return true;
  if (isString(m.name) && /\(Free\)\s*$/i.test(m.name)) return true;
  if (isString(m.id) && /(:free|-free)$/i.test(m.id)) return true;
  return null;
}

/**
 * Classify a model string as PAID for the `hidePaidModels` filter.
 *
 * Mirrors OmniRoute #6495 `shouldHidePaid(provider, modelId, pricing)` exactly:
 *   - toggle off → caller skips this (returns false here only when nothing hides);
 *   - provider NOT in curated free catalog → PAID (whole provider paid-only);
 *   - provider in catalog → PAID unless `isFreeModel(provider, {id, pricing})`
 *     says free (`:free` suffix, zero prompt+completion price, catalog id match).
 * One deliberate extension beyond upstream: an explicit registry free marker
 * (no-auth provider, `category:"free"`, per-model `free`/`(Free)`/`:free`/`-free`)
 * wins first — DurinDoor lists free routes (api-airforce `(Free)`, auggie) that
 * are not in the curated catalog, and those must stay visible. Unknown/unpriced
 * on a non-free provider is PAID (matches upstream: the catalog is the
 * authority, not the pricing table).
 *
 * @param {string} modelStr "alias/model" or "provider/model" (nested ids ok).
 * @returns {boolean}
 */
export function isPaidModel(modelStr) {
  const { provider: providerOrAlias, model } = splitProviderModel(modelStr);
  // Bare / providerless IDs (custom/providerless rows in buildModelsList) have
  // no curated catalog entry and must stay visible — never classify as paid.
  if (!providerOrAlias || !model) return false;
  const provider = resolveProviderId(providerOrAlias);

  if (registryFreeSignal(provider, model) === true) return false;

  // OmniRoute shouldHidePaid: provider with no curated free roster → hide all.
  if (!providerHasFreeModels(provider)) return true;

  // Provider has a free roster → keep only the models the catalog marks free
  // (or an explicit zero-price row). Pricing is resolved raw-alias-first so
  // alias-keyed overrides (PROVIDER_PRICING.gh) still feed zero-price detection.
  const pricing =
  getPricingForModel(providerOrAlias, model) ?? getPricingForModel(provider, model);
  return !isFreeModel(provider, { id: model, pricing });
}

/**
 * Filter an array of model strings/objects down to the free ones when the
 * hide-paid toggle is on. Passes the array through unchanged when disabled.
 * Object entries are classified by their `id` (string) field.
 *
 * @template T
 * @param {T[]} models
 * @param {boolean} enabled
 * @param {(m: T) => string} [toModelStr] defaults to `m.id ?? m`
 * @returns {T[]}
 */
export function filterPaidModels(models, enabled, toModelStr = (m) => isString(m) ? m : m?.id) {
  if (!enabled || !Array.isArray(models)) return models;
  return models.filter((m) => {
    const s = toModelStr(m);
    return !isString(s) || !isPaidModel(s);
  });
}

/**
 * Whether a single model qualifies as FREE for `provider` (OmniRoute #6495).
 * Canonical definition lives in `open-sse/config/freeModelCatalog.js`; it is
 * re-exported here so the hide-paid classifier surface — `isPaidModel`,
 * `filterPaidModels`, `isFreeModel` — is addressable from one module.
 *
 * Free when ANY of: `model.id` ends with `:free`; pricing is zero prompt AND
 * zero completion (`{prompt,completion}` or `{input,output}`); or `model.id` is
 * on the curated free roster for `provider`. No-pricing / unknown is NOT free.
 *
 * @param {string} provider canonical provider id (aliases resolved by caller).
 * @param {{ id?: string, pricing?: object }} model
 * @returns {boolean}
 */
export { isFreeModel };

/**
 * Canonical model pricing — provider-agnostic.
 * Cover all known models; deduplicated across providers.
 */
export const MODEL_PRICING = {
  // === Anthropic / Claude ===
  "claude-sonnet-5": { input: 3.00, output: 15.00, cached: 0.30, reasoning: 15.00, cache_creation: 3.75 },
  "claude-opus-4-6": { input: 5.00, output: 25.00, cached: 0.50, reasoning: 25.00, cache_creation: 6.25 },
  "claude-opus-4-5-20251101": { input: 5.00, output: 25.00, cached: 0.50, reasoning: 25.00, cache_creation: 6.25 },
  "claude-sonnet-4-6": { input: 3.00, output: 15.00, cached: 0.30, reasoning: 15.00, cache_creation: 3.75 },
  "claude-sonnet-4-5-20250929": { input: 3.00, output: 15.00, cached: 0.30, reasoning: 15.00, cache_creation: 3.75 },
  "claude-haiku-4-5-20251001": { input: 1.00, output: 5.00, cached: 0.10, reasoning: 5.00, cache_creation: 1.25 },
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00, cached: 1.50, reasoning: 15.00, cache_creation: 3.00 },
  "claude-opus-4-20250514": { input: 15.00, output: 25.00, cached: 7.50, reasoning: 112.50, cache_creation: 15.00 },
  "claude-3-5-sonnet-20241022": { input: 3.00, output: 15.00, cached: 1.50, reasoning: 15.00, cache_creation: 3.00 },
  "claude-haiku-4.5": { input: 0.50, output: 2.50, cached: 0.05, reasoning: 3.75, cache_creation: 0.50 },
  "claude-opus-4.1": { input: 5.00, output: 25.00, cached: 0.50, reasoning: 37.50, cache_creation: 5.00 },
  "claude-opus-4.5": { input: 5.00, output: 25.00, cached: 0.50, reasoning: 37.50, cache_creation: 5.00 },
  "claude-opus-4.6": { input: 5.00, output: 25.00, cached: 0.50, reasoning: 37.50, cache_creation: 5.00 },
  "claude-sonnet-4": { input: 3.00, output: 15.00, cached: 0.30, reasoning: 22.50, cache_creation: 3.00 },
  "claude-sonnet-4.5": { input: 3.00, output: 15.00, cached: 0.30, reasoning: 22.50, cache_creation: 3.00 },
  "claude-sonnet-4.6": { input: 3.00, output: 15.00, cached: 0.30, reasoning: 22.50, cache_creation: 3.00 },
  "claude-opus-4-5-thinking": { input: 5.00, output: 25.00, cached: 0.50, reasoning: 37.50, cache_creation: 5.00 },
  "claude-opus-4-6-thinking": { input: 5.00, output: 25.00, cached: 0.50, reasoning: 37.50, cache_creation: 5.00 },
  "claude-fable-5": { input: 10.00, output: 50.00, cached: 1.00, reasoning: 50.00, cache_creation: 12.50 },

  // === OpenAI / GPT ===
  // Official standard-tier list prices in $/1M tokens. OpenAI reports
  // reasoning as a subset of output, so reasoning uses the output rate.
  "gpt-4": { input: 30.00, output: 60.00, cached: 30.00, reasoning: 60.00, cache_creation: 30.00 },
  "gpt-4-turbo": { input: 10.00, output: 30.00, cached: 10.00, reasoning: 30.00, cache_creation: 10.00 },
  "gpt-4o": { input: 2.50, output: 10.00, cached: 1.25, reasoning: 10.00, cache_creation: 2.50 },
  "gpt-4o-mini": { input: 0.15, output: 0.60, cached: 0.075, reasoning: 0.60, cache_creation: 0.15 },
  "gpt-4.1": { input: 2.00, output: 8.00, cached: 0.50, reasoning: 8.00, cache_creation: 2.00 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60, cached: 0.10, reasoning: 1.60, cache_creation: 0.40 },
  "gpt-4.1-nano": { input: 0.10, output: 0.40, cached: 0.025, reasoning: 0.40, cache_creation: 0.10 },
  "gpt-5": { input: 1.25, output: 10.00, cached: 0.125, reasoning: 10.00, cache_creation: 1.25 },
  "gpt-5-mini": { input: 0.25, output: 2.00, cached: 0.025, reasoning: 2.00, cache_creation: 0.25 },
  "gpt-5-nano": { input: 0.05, output: 0.40, cached: 0.005, reasoning: 0.40, cache_creation: 0.05 },
  "gpt-5-codex": { input: 1.25, output: 10.00, cached: 0.625, reasoning: 10.00, cache_creation: 1.25 },
  "gpt-5.1": { input: 1.25, output: 10.00, cached: 0.125, reasoning: 10.00, cache_creation: 1.25 },
  "gpt-5.1-codex": { input: 1.25, output: 10.00, cached: 0.625, reasoning: 10.00, cache_creation: 1.25 },
  "gpt-5.1-codex-mini": { input: 1.50, output: 6.00, cached: 0.75, reasoning: 9.00, cache_creation: 1.50 },
  "gpt-5.1-codex-mini-high": { input: 2.00, output: 8.00, cached: 1.00, reasoning: 12.00, cache_creation: 2.00 },
  "gpt-5.1-codex-max": { input: 8.00, output: 32.00, cached: 4.00, reasoning: 48.00, cache_creation: 8.00 },
  "gpt-5.2": { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 },
  "gpt-5.2-codex": { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 },
  "gpt-5.3-codex": { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 },
  "gpt-5.3-codex-spark": { input: 3.00, output: 12.00, cached: 0.30, reasoning: 12.00, cache_creation: 3.00 },
  "gpt-5.4": { input: 2.50, output: 15.00, cached: 0.25, reasoning: 15.00, cache_creation: 2.50 },
  "gpt-5.4-mini": { input: 0.75, output: 4.50, cached: 0.075, reasoning: 4.50, cache_creation: 0.75 },
  "gpt-5.4-nano": { input: 0.20, output: 1.25, cached: 0.02, reasoning: 1.25, cache_creation: 0.20 },
  "gpt-5.4-pro": { input: 30.00, output: 180.00, cached: 30.00, reasoning: 180.00, cache_creation: 30.00 },
  "gpt-5.5": { input: 5.00, output: 30.00, cached: 0.50, reasoning: 30.00, cache_creation: 5.00 },
  "gpt-5.5-pro": { input: 30.00, output: 180.00, cached: 30.00, reasoning: 180.00, cache_creation: 30.00 },
  // Fork-specific exact GPT-5.6 and synthetic tiers retain subscription prices.
  "gpt-5.6": { input: 2.50, output: 15.00, cached: 0.25, reasoning: 15.00, cache_creation: 2.50 },
  "gpt-5.6-luna": { input: 1.00, output: 1.25, cached: 0.10, reasoning: 1.25, cache_creation: 1.00 },
  "gpt-5.6-terra": { input: 2.50, output: 3.125, cached: 0.25, reasoning: 3.125, cache_creation: 2.50 },
  "gpt-5.6-sol": { input: 5.00, output: 6.25, cached: 0.50, reasoning: 6.25, cache_creation: 5.00 },
  "o1": { input: 15.00, output: 60.00, cached: 7.50, reasoning: 60.00, cache_creation: 15.00 },
  "o1-mini": { input: 3.00, output: 12.00, cached: 1.50, reasoning: 12.00, cache_creation: 3.00 },
  "o3": { input: 2.00, output: 8.00, cached: 0.50, reasoning: 8.00, cache_creation: 2.00 },
  "o3-mini": { input: 1.10, output: 4.40, cached: 0.55, reasoning: 4.40, cache_creation: 1.10 },
  "o3-pro": { input: 20.00, output: 80.00, cached: 20.00, reasoning: 80.00, cache_creation: 20.00 },
  "o4-mini": { input: 1.10, output: 4.40, cached: 0.275, reasoning: 4.40, cache_creation: 1.10 },

  // === Gemini ===
  "gemini-3-flash-preview": { input: 0.50, output: 3.00, cached: 0.03, reasoning: 4.50, cache_creation: 0.50 },
  "gemini-3-pro-preview": { input: 2.00, output: 12.00, cached: 0.25, reasoning: 18.00, cache_creation: 2.00 },
  "gemini-3.1-pro-low": { input: 2.00, output: 12.00, cached: 0.25, reasoning: 18.00, cache_creation: 2.00 },
  "gemini-3.1-pro-high": { input: 4.00, output: 18.00, cached: 0.50, reasoning: 27.00, cache_creation: 4.00 },
  "gemini-pro-agent": { input: 4.00, output: 18.00, cached: 0.50, reasoning: 27.00, cache_creation: 4.00 },
  "gemini-3-flash-agent": { input: 0.50, output: 3.00, cached: 0.03, reasoning: 4.50, cache_creation: 0.50 },
  "gemini-3.5-flash-low": { input: 0.50, output: 3.00, cached: 0.03, reasoning: 4.50, cache_creation: 0.50 },
  "gemini-3.5-flash-extra-low": { input: 0.50, output: 3.00, cached: 0.03, reasoning: 4.50, cache_creation: 0.50 },
  "gemini-3-flash": { input: 0.50, output: 3.00, cached: 0.03, reasoning: 4.50, cache_creation: 0.50 },
  "gemini-2.5-pro": { input: 2.00, output: 12.00, cached: 0.25, reasoning: 18.00, cache_creation: 2.00 },
  "gemini-2.5-flash": { input: 0.30, output: 2.50, cached: 0.03, reasoning: 3.75, cache_creation: 0.30 },
  "gemini-2.5-flash-lite": { input: 0.15, output: 1.25, cached: 0.015, reasoning: 1.875, cache_creation: 0.15 },

  // === Qwen ===
  "qwen3-coder-plus": { input: 1.00, output: 4.00, cached: 0.50, reasoning: 6.00, cache_creation: 1.00 },
  "qwen3-coder-flash": { input: 0.50, output: 2.00, cached: 0.25, reasoning: 3.00, cache_creation: 0.50 },

  /** Qwen3.8 canonical per-million-token rates; exact rows must beat the generic Qwen fallback. */
  "qwen3.8-max": { input: 2.00, output: 6.00, cached: 0.25, cache_creation: 2.50, reasoning: 6.00 },
  "qwen3.8-27b": { input: 0.40, output: 3.00, cached: 0.05, reasoning: 3.00 },
  "qwen3.8-2.4t-a95b": { input: 2.00, output: 6.00, cached: 0.25, reasoning: 6.00 },

  // === Kimi (third-party registries; first-party Kimi Code subscriptions remain quota-based) ===
  "kimi-k3": { input: 3.00, output: 15.00, cached: 0.30 },
  "kimi-k2": { input: 1.00, output: 4.00, cached: 0.50, reasoning: 6.00, cache_creation: 1.00 },
  "kimi-k2-thinking": { input: 1.50, output: 6.00, cached: 0.75, reasoning: 9.00, cache_creation: 1.50 },
  "kimi-k2.5": { input: 1.20, output: 4.80, cached: 0.60, reasoning: 7.20, cache_creation: 1.20 },
  "kimi-k2.5-thinking": { input: 1.80, output: 7.20, cached: 0.90, reasoning: 10.80, cache_creation: 1.80 },

  // === DeepSeek ===
  "deepseek-chat": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 },
  "deepseek-reasoner": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 },
  "deepseek-r1": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 },
  "deepseek-v3.2-chat": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 },
  "deepseek-v3.2-reasoner": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 },
  "deepseek-v4-flash": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 },
  "deepseek-v4-pro": { input: 0.435, output: 0.87, cached: 0.003625, reasoning: 0.87, cache_creation: 0.435 },

  // === GLM ===
  "glm-5": { input: 1.00, output: 3.20, cached: 0.20 },
  "glm-5.1": { input: 1.40, output: 4.40, cached: 0.26 },
  "glm-5.2": { input: 1.40, output: 4.40, cached: 0.26 },
  "glm-5-turbo": { input: 1.20, output: 4.00, cached: 0.24 },
  "glm-4.5": { input: 0.60, output: 2.20, cached: 0.11 },
  "glm-4.5-air": { input: 0.20, output: 1.10, cached: 0.03 },
  "glm-4.5-airx": { input: 1.10, output: 4.50, cached: 0.22 },
  "glm-4.5-x": { input: 2.20, output: 8.90, cached: 0.45 },
  "glm-4.6": { input: 0.60, output: 2.20, cached: 0.11 },
  "glm-4.6v": { input: 0.75, output: 3.00, cached: 0.375, reasoning: 4.50, cache_creation: 0.75 },
  "glm-4.7": { input: 0.60, output: 2.20, cached: 0.11 },
  "glm-4.7-flash": { input: 0, output: 0, cached: 0, reasoning: 0, cache_creation: 0 },
  "glm-4.7-flashx": { input: 0.07, output: 0.40, cached: 0.01 },
  "glm-4-32b-0414-128k": { input: 0.10, output: 0.10 },
  "glm-4.5-flash": { input: 0, output: 0, cached: 0, reasoning: 0, cache_creation: 0 },

  // === MiniMax ===
  "MiniMax-M2": { input: 0.30, output: 1.20, cached: 0.03, cache_creation: 0.375 },
  "MiniMax-M2.1": { input: 0.30, output: 1.20, cached: 0.03, cache_creation: 0.375 },
  "MiniMax-M2.1-highspeed": { input: 0.60, output: 2.40, cached: 0.03, cache_creation: 0.375 },
  "MiniMax-M2.5": { input: 0.30, output: 1.20, cached: 0.03, cache_creation: 0.375 },
  "MiniMax-M2.5-highspeed": { input: 0.60, output: 2.40, cached: 0.03, cache_creation: 0.375 },
  "MiniMax-M2.7": { input: 0.30, output: 1.20, cached: 0.06, cache_creation: 0.375 },
  "MiniMax-M2.7-highspeed": { input: 0.60, output: 2.40, cached: 0.06, cache_creation: 0.375 },
  // MiniMax-M3 standard pricing applies to requests with ≤512K input tokens.
  // Requests above 512K input tokens fall into a higher-rate long-context tier;
  // this catalog does not model that tier, and the advertised capability
  // context window is capped to 512K. See first-party docs:
  // https://platform.minimax.io/docs/guides/pricing-paygo
  "MiniMax-M3": { input: 0.30, output: 1.20, cached: 0.06 },
  "minimax-m2.1": { input: 0.30, output: 1.20, cached: 0.03, cache_creation: 0.375 },
  "minimax-m2.5": { input: 0.30, output: 1.20, cached: 0.03, cache_creation: 0.375 },
  "minimax-m2.7": { input: 0.30, output: 1.20, cached: 0.06, cache_creation: 0.375 },
  "minimax-m3": { input: 0.30, output: 1.20, cached: 0.06 },

  // === Grok ===
  "grok-code-fast-1": { input: 0.50, output: 2.00, cached: 0.25, reasoning: 3.00, cache_creation: 0.50 },

  // === OpenRouter fallback ===
  "auto": { input: 2.00, output: 8.00, cached: 1.00, reasoning: 12.00, cache_creation: 2.00 },

  // === Misc ===
  "oswe-vscode-prime": { input: 1.00, output: 4.00, cached: 0.50, reasoning: 6.00, cache_creation: 1.00 },
  "gpt-oss-120b-medium": { input: 0.50, output: 2.00, cached: 0.25, reasoning: 3.00, cache_creation: 0.50 },
  "vision-model": { input: 1.50, output: 6.00, cached: 0.75, reasoning: 9.00, cache_creation: 1.50 },
  "coder-model": { input: 1.50, output: 6.00, cached: 0.75, reasoning: 9.00, cache_creation: 1.50 }
};

/**
 * Provider-specific pricing overrides.
 * Only include entries where price DIFFERS from MODEL_PRICING.
 * Keyed by provider alias (cc, cx, gc, gh, ...) or provider id (openai, anthropic, ...).
 */
export const PROVIDER_PRICING = {
  // GitHub Copilot (gh) — explicit override, matches canonical gpt-5.3-codex rate
  gh: {
    "gpt-5.3-codex": { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 }
  },

  // Fireworks AI — OpenAI-compatible, reasoning/cache_creation not separately
  // charged (completion_tokens already includes reasoning tokens; setting
  // reasoning/cache_creation to output/input would double-count in the
  // cost calculator).
  fireworks: {
    "accounts/fireworks/models/glm-5p2": { input: 1.40, output: 4.40, cached: 0.14, reasoning: 0, cache_creation: 0 },
    "accounts/fireworks/routers/glm-5p2-fast": { input: 2.10, output: 6.60, cached: 0.21, reasoning: 0, cache_creation: 0 },
    "accounts/fireworks/models/glm-5p1": { input: 1.40, output: 4.40, cached: 0.26, reasoning: 0, cache_creation: 0 },
    "accounts/fireworks/routers/glm-5p1-fast": { input: 2.80, output: 8.80, cached: 0.52, reasoning: 0, cache_creation: 0 },
    "accounts/fireworks/models/qwen3p7-plus": { input: 0.40, output: 1.60, cached: 0.08, reasoning: 0, cache_creation: 0 },
    "accounts/fireworks/models/minimax-m3": { input: 0.30, output: 1.20, cached: 0.06, reasoning: 0, cache_creation: 0 },
    "accounts/fireworks/models/minimax-m2p7": { input: 0.30, output: 1.20, cached: 0.06, reasoning: 0, cache_creation: 0 },
    "accounts/fireworks/models/kimi-k2p7-code": { input: 0.95, output: 4.00, cached: 0.19, reasoning: 0, cache_creation: 0 },
    "accounts/fireworks/routers/kimi-k2p7-code-fast": { input: 1.90, output: 8.00, cached: 0.38, reasoning: 0, cache_creation: 0 },
    "accounts/fireworks/models/kimi-k2p6": { input: 0.95, output: 4.00, cached: 0.16, reasoning: 0, cache_creation: 0 },
    "accounts/fireworks/routers/kimi-k2p6-turbo": { input: 2.00, output: 8.00, cached: 0.30, reasoning: 0, cache_creation: 0 },
    "accounts/fireworks/routers/kimi-k2p6-fast": { input: 2.00, output: 8.00, cached: 0.30, reasoning: 0, cache_creation: 0 },
    "accounts/fireworks/models/gpt-oss-120b": { input: 0.15, output: 0.60, cached: 0.015, reasoning: 0, cache_creation: 0 },
    "accounts/fireworks/models/gpt-oss-20b": { input: 0.07, output: 0.30, cached: 0.035, reasoning: 0, cache_creation: 0 },
    "accounts/fireworks/models/deepseek-v4-pro": { input: 1.74, output: 3.48, cached: 0.145, reasoning: 0, cache_creation: 0 },
    "accounts/fireworks/models/deepseek-v4-flash": { input: 0.14, output: 0.28, cached: 0.028, reasoning: 0, cache_creation: 0 }
  }
};

/**
 * Pattern-based pricing fallback — matched when no exact model entry found.
 * Patterns use simple glob: "*" matches any substring.
 * First match wins — order matters.
 */
export const PATTERN_PRICING = [
// --- Codex variants ---
{ pattern: "*-codex-xhigh", pricing: { input: 10.00, output: 40.00, cached: 5.00, reasoning: 60.00, cache_creation: 10.00 } },
{ pattern: "*-codex-high", pricing: { input: 8.00, output: 32.00, cached: 4.00, reasoning: 48.00, cache_creation: 8.00 } },
{ pattern: "*-codex-max", pricing: { input: 8.00, output: 32.00, cached: 4.00, reasoning: 48.00, cache_creation: 8.00 } },
{ pattern: "*-codex-mini-*", pricing: { input: 1.50, output: 6.00, cached: 0.75, reasoning: 9.00, cache_creation: 1.50 } },
{ pattern: "*-codex-mini", pricing: { input: 1.50, output: 6.00, cached: 0.75, reasoning: 9.00, cache_creation: 1.50 } },
{ pattern: "*-codex-low", pricing: { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 } },
{ pattern: "*-codex-none", pricing: { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 } },
{ pattern: "*-codex-spark", pricing: { input: 3.00, output: 12.00, cached: 0.30, reasoning: 12.00, cache_creation: 3.00 } },
{ pattern: "codex-*", pricing: { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 } },
{ pattern: "*-codex", pricing: { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 } },

// --- Claude ---
{ pattern: "claude-opus-*", pricing: { input: 5.00, output: 25.00, cached: 0.50, reasoning: 25.00, cache_creation: 6.25 } },
{ pattern: "claude-sonnet-*", pricing: { input: 3.00, output: 15.00, cached: 0.30, reasoning: 15.00, cache_creation: 3.75 } },
{ pattern: "claude-haiku-*", pricing: { input: 1.00, output: 5.00, cached: 0.10, reasoning: 5.00, cache_creation: 1.25 } },
{ pattern: "claude-*", pricing: { input: 3.00, output: 15.00, cached: 0.30, reasoning: 15.00, cache_creation: 3.75 } },

// --- Gemini (specific first, generic last) ---
{ pattern: "gemini-*-flash-lite", pricing: { input: 0.15, output: 1.25, cached: 0.015, reasoning: 1.875, cache_creation: 0.15 } },
{ pattern: "gemini-*-flash", pricing: { input: 0.30, output: 2.50, cached: 0.03, reasoning: 3.75, cache_creation: 0.30 } },
{ pattern: "gemini-*-pro", pricing: { input: 2.00, output: 12.00, cached: 0.25, reasoning: 18.00, cache_creation: 2.00 } },
{ pattern: "gemini-3-*", pricing: { input: 0.50, output: 3.00, cached: 0.03, reasoning: 4.50, cache_creation: 0.50 } },
{ pattern: "gemini-2.5-*", pricing: { input: 0.30, output: 2.50, cached: 0.03, reasoning: 3.75, cache_creation: 0.30 } },
{ pattern: "gemini-*", pricing: { input: 0.50, output: 3.00, cached: 0.03, reasoning: 4.50, cache_creation: 0.50 } },

// --- GPT (specific first, generic last) ---
{ pattern: "gpt-5.6-*", pricing: { input: 2.50, output: 15.00, cached: 0.25, reasoning: 15.00, cache_creation: 2.50 } },
{ pattern: "gpt-5.4-*", pricing: { input: 2.50, output: 15.00, cached: 0.25, reasoning: 15.00, cache_creation: 2.50 } },
{ pattern: "gpt-5.3-*", pricing: { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 } },
{ pattern: "gpt-5.2-*", pricing: { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 } },
{ pattern: "gpt-5.1-*", pricing: { input: 1.25, output: 10.00, cached: 0.125, reasoning: 10.00, cache_creation: 1.25 } },
{ pattern: "gpt-5-*", pricing: { input: 1.25, output: 10.00, cached: 0.125, reasoning: 10.00, cache_creation: 1.25 } },
{ pattern: "gpt-5*", pricing: { input: 1.25, output: 10.00, cached: 0.125, reasoning: 10.00, cache_creation: 1.25 } },
{ pattern: "gpt-4o-*", pricing: { input: 0.15, output: 0.60, cached: 0.075, reasoning: 0.60, cache_creation: 0.15 } },
{ pattern: "gpt-4o", pricing: { input: 2.50, output: 10.00, cached: 1.25, reasoning: 10.00, cache_creation: 2.50 } },
{ pattern: "gpt-4*", pricing: { input: 10.00, output: 30.00, cached: 10.00, reasoning: 30.00, cache_creation: 10.00 } },

// --- o1 / o-series ---
{ pattern: "o1-*", pricing: { input: 3.00, output: 12.00, cached: 1.50, reasoning: 12.00, cache_creation: 3.00 } },
{ pattern: "o1", pricing: { input: 15.00, output: 60.00, cached: 7.50, reasoning: 60.00, cache_creation: 15.00 } },
{ pattern: "o3-*", pricing: { input: 2.00, output: 8.00, cached: 0.50, reasoning: 8.00, cache_creation: 2.00 } },
{ pattern: "o4-*", pricing: { input: 1.10, output: 4.40, cached: 0.275, reasoning: 4.40, cache_creation: 1.10 } },

// --- Qwen ---
{ pattern: "qwen3-coder-*", pricing: { input: 1.00, output: 4.00, cached: 0.50, reasoning: 6.00, cache_creation: 1.00 } },
{ pattern: "qwen*-coder-*", pricing: { input: 1.00, output: 4.00, cached: 0.50, reasoning: 6.00, cache_creation: 1.00 } },
{ pattern: "qwen*", pricing: { input: 0.50, output: 2.00, cached: 0.25, reasoning: 3.00, cache_creation: 0.50 } },

// --- Kimi ---
{ pattern: "kimi-*-thinking", pricing: { input: 1.80, output: 7.20, cached: 0.90, reasoning: 10.80, cache_creation: 1.80 } },
{ pattern: "kimi-k2*", pricing: { input: 1.20, output: 4.80, cached: 0.60, reasoning: 7.20, cache_creation: 1.20 } },
{ pattern: "kimi-*", pricing: { input: 1.00, output: 4.00, cached: 0.50, reasoning: 6.00, cache_creation: 1.00 } },

// --- DeepSeek ---
{ pattern: "deepseek-*reasoner*", pricing: { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 } },
{ pattern: "deepseek-r*", pricing: { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 } },
{ pattern: "deepseek-v*", pricing: { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 } },
{ pattern: "deepseek-*", pricing: { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 } },

// --- GLM ---
{ pattern: "glm-5*", pricing: { input: 1.00, output: 4.00, cached: 0.50, reasoning: 6.00, cache_creation: 1.00 } },
{ pattern: "glm-4*", pricing: { input: 0.75, output: 3.00, cached: 0.375, reasoning: 4.50, cache_creation: 0.75 } },
{ pattern: "glm-*", pricing: { input: 0.50, output: 2.00, cached: 0.25, reasoning: 3.00, cache_creation: 0.50 } },

// --- MiniMax ---
{ pattern: "MiniMax-*", pricing: { input: 0.50, output: 2.00, cached: 0.25, reasoning: 3.00, cache_creation: 0.50 } },
{ pattern: "minimax-*", pricing: { input: 0.50, output: 2.00, cached: 0.25, reasoning: 3.00, cache_creation: 0.50 } },

// --- Grok ---
{ pattern: "grok-code-*", pricing: { input: 0.50, output: 2.00, cached: 0.25, reasoning: 3.00, cache_creation: 0.50 } },

{ pattern: "grok-*", pricing: { input: 0.50, output: 2.00, cached: 0.25, reasoning: 3.00, cache_creation: 0.50 } },

/** Meta Muse pattern rates; first match wins, so specializations precede the family fallback. */
{ pattern: "*muse-spark*contributor*", pricing: { input: 0.10, output: 0.20, cached: 0.002, reasoning: 0.30, cache_creation: 0.10 } },
{ pattern: "*muse-spark*", pricing: { input: 1.25, output: 4.25, cached: 0.15, reasoning: 6.375, cache_creation: 1.25 } },
{ pattern: "*muse-glimmer*", pricing: { input: 0.30, output: 1.20, cached: 0.04, reasoning: 1.80, cache_creation: 0.30 } },
{ pattern: "*muse*", pricing: { input: 1.25, output: 4.25, cached: 0.15, reasoning: 6.375, cache_creation: 1.25 } }];


/**
 * Match a model ID against a glob pattern (* = wildcard). Case-insensitive:
 * registry ids mix casing (e.g. "MiniMax-M2.5" vs "minimax-m2.5").
 */
export function matchPattern(pattern, model) {
  const regex = new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
  return regex.test(model);
}

/**
 * Resolve pricing for a model using the 3-step fallback chain:
 *   1. PROVIDER_PRICING[provider][model]
 *   2. MODEL_PRICING[model]
 *   3. PATTERN_PRICING (glob match)
 *
 * @param {string} provider
 * @param {string} model
 * @returns {object|null}
 */
export function getPricingForModel(provider, model) {
  if (!model) return null;

  // 1. Provider-specific override
  if (provider && PROVIDER_PRICING[provider]?.[model]) {
    return PROVIDER_PRICING[provider][model];
  }

  // 2. Canonical model pricing (strip vendor prefix if needed: "deepseek/deepseek-chat" → "deepseek-chat")
  const baseModel = model.includes("/") ? model.split("/").pop() : model;
  if (MODEL_PRICING[baseModel]) return MODEL_PRICING[baseModel];
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];

  // 2b. Kiro GPT-5.6 synthetic variants (decolua/9router#2596): the catalog
  // expands each tier into `-thinking`/`-agentic`/`-thinking-agentic` ids, but
  // only the bare tiers carry exact prices. Scoped to kiro/kr so genuine
  // non-Kiro `*-thinking` models with their own exact rows are untouched.
  // Normalize digit-dash-digit ids (gpt-5-6-sol) to the dotted catalog form
  // and retry the canonical lookup on the de-suffixed id before the glob
  // fallback so Sol variants don't fall through to the generic gpt-5.6-* Terra rate.
  if (provider === "kiro" || provider === "kr") {
    const suffixStripped = stripKiroSyntheticSuffixes(baseModel);
    const normalized = normalizeModelId(suffixStripped);
    if (MODEL_PRICING[normalized]) return MODEL_PRICING[normalized];
  }

  // 3. Pattern match
  for (const { pattern, pricing } of PATTERN_PRICING) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, model)) {
      return pricing;
    }
  }

  return null;
}

/**
 * Get all provider pricing (for UI / API).
 * Returns PROVIDER_PRICING — consumers should fall back to MODEL_PRICING for unlisted models.
 */
export function getDefaultPricing() {
  return PROVIDER_PRICING;
}

/**
 * Format cost for display
 * @param {number} cost
 * @returns {string}
 */
export function formatCost(cost) {
  if (cost === null || cost === undefined || isNaN(cost)) return "$0.00";
  return `$${cost.toFixed(2)}`;
}

/**
 * Calculate cost from tokens and pricing
 * @param {object} tokens
 * @param {object} pricing
 * @returns {number} cost in dollars
 */
export function calculateCostFromTokens(tokens, pricing) {
  if (!tokens) return 0;

  const directCost = tokens.cost_usd ?? tokens.cost_in_usd;
  if (Number.isFinite(Number(directCost)) && Number(directCost) >= 0) return Number(directCost);
  if (Number.isFinite(Number(tokens.cost_in_usd_ticks)) && Number(tokens.cost_in_usd_ticks) >= 0) {
    return Number(tokens.cost_in_usd_ticks) / 1_000_000_000_000;
  }
  if (!pricing) return 0;

  let cost = 0;

  const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
  const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
  const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
  // prompt_tokens is cache-inclusive (see canonicalizeUsage): cached + cache_creation
  // are subsets, so subtract both to avoid charging them at the full input rate.
  const nonCachedInput = Math.max(0, inputTokens - cachedTokens - cacheCreationTokens);

  cost += nonCachedInput * (pricing.input / 1000000);

  if (cachedTokens > 0) {
    cost += cachedTokens * ((pricing.cached || pricing.input) / 1000000);
  }

  const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
  const reasoningTokens = tokens.reasoning_tokens || 0;
  // Reasoning detail is a subset of completion/output in the canonical usage
  // contract. Price the visible remainder at the ordinary output rate, then
  // price the reasoning subset once at its dedicated rate (or output fallback).
  const billedReasoningTokens = outputTokens > 0 ?
  Math.min(outputTokens, reasoningTokens) :
  reasoningTokens;
  const visibleOutputTokens = Math.max(0, outputTokens - billedReasoningTokens);
  cost += visibleOutputTokens * (pricing.output / 1000000);
  if (billedReasoningTokens > 0) {
    cost += billedReasoningTokens * ((pricing.reasoning || pricing.output) / 1000000);
  }

  if (cacheCreationTokens > 0) {
    cost += cacheCreationTokens * ((pricing.cache_creation || pricing.input) / 1000000);
  }

  return cost;
}