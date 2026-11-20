// Service-tier modifiers (`(fast)` / `(standard)`) map to the OpenAI-style
// `service_tier` request field. Only OpenAI and Codex accept that field, so
// only those providers may treat the suffix as a tier control. On every other
// provider the same suffix belongs to the opaque model ID and must reach
// dispatch intact — a custom or live model may legitimately end in it.
//
// The registry is the source of truth for provider ids and aliases, so the
// alias a caller holds ("cx") answers the same question as the provider id
// it stands for ("codex").

import REGISTRY from "../providers/registry/index.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

// Provider ids whose upstream accepts the OpenAI-style `service_tier` field.
const SERVICE_TIER_PROVIDER_IDS = new Set(["openai", "codex"]);

// Registry alias -> provider id.
const ALIAS_TO_PROVIDER_ID = new Map(REGISTRY.map((entry) => [entry.alias || entry.id, entry.id]));

/**
 * Whether a provider accepts a service tier. Accepts a provider id or a
 * registry alias.
 *
 * @param {unknown} providerOrAlias provider id ("openai", "codex") or alias ("openai", "cx")
 * @returns {boolean}
 */
export function supportsServiceTier(providerOrAlias) {
  if (!isString(providerOrAlias)) return false;
  const key = providerOrAlias.trim().toLowerCase();
  if (!key) return false;
  const providerId = ALIAS_TO_PROVIDER_ID.get(key) || key;
  return SERVICE_TIER_PROVIDER_IDS.has(providerId);
}
