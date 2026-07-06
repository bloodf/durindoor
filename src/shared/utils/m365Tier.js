/**
 * Helpers for the Microsoft 365 Copilot web tier selector.
 *
 * The executor reads providerSpecificData.tier to choose the consumer, EDU, or
 * enterprise/work BizChat surface. These pure helpers keep the dashboard form
 * mapping testable without coupling tests to React rendering.
 */

export const M365_TIER_CAPABLE_PROVIDERS = new Set(["copilot-m365-web"]);

export function isM365TierCapableProvider(provider) {
  return !!provider && M365_TIER_CAPABLE_PROVIDERS.has(provider);
}

export function normalizeM365TierValue(raw) {
  const tier = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (tier === "edu" || tier === "included") return "edu";
  if (tier === "enterprise" || tier === "work") return "enterprise";
  return "";
}

export function applyM365Tier(target, tier) {
  if (!target || typeof target !== "object") return;
  if (tier === "edu" || tier === "enterprise") {
    target.tier = tier;
  } else {
    target.tier = null;
  }
}
