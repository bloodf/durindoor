// Parse the dashboard's request-only `model(level)` thinking controls without
// confusing opaque/custom model IDs that legitimately contain parentheses.

import { LEVEL_TO_BUDGET } from "./thinking.js";
import { supportsServiceTier } from "../../config/serviceTier.js";

/**
 * Parse a recognized thinking suffix from a model ID.
 *
 * Unknown parenthesized values are part of the model ID and are returned
 * byte-for-byte in `cleanModel`. The UI's binary `thinking` choice maps to
 * automatic provider-native thinking.
 *
 * @param {unknown} model
 * @returns {{ cleanModel: unknown, override: null | { mode: "none" | "auto" } | { mode: "budget", budget: number } | { mode: "level", level: string } }}
 */
import { isString } from "../../../src/shared/utils/typeChecks.js";
function parseThinkingSuffix(model) {
  if (!isString(model)) return { cleanModel: model, override: null };
  const match = model.match(/^(.*)\(([^()]+)\)\s*$/);
  if (!match) return { cleanModel: model, override: null };

  const candidate = match[1].trim();
  if (!candidate) return { cleanModel: model, override: null };
  const raw = match[2].trim().toLowerCase();
  if (raw === "none" || raw === "off") {
    return { cleanModel: candidate, override: { mode: "none" } };
  }
  if (raw === "auto" || raw === "thinking") {
    return { cleanModel: candidate, override: { mode: "auto" } };
  }
  if (/^\d+$/.test(raw)) {
    const budget = Number(raw);
    if (!Number.isSafeInteger(budget)) return { cleanModel: model, override: null };
    if (budget === 0) return { cleanModel: candidate, override: { mode: "none" } };
    return { cleanModel: candidate, override: { mode: "budget", budget } };
  }
  if (LEVEL_TO_BUDGET[raw] !== undefined) {
    return { cleanModel: candidate, override: { mode: "level", level: raw } };
  }

  return { cleanModel: model, override: null };
}

/** Whether the service-tier control applies to this provider.
 * Without a provider context the historical behavior is kept: the suffix is a
 * tier control. With a provider, only providers whose upstream accepts the
 * OpenAI-style `service_tier` field (OpenAI, Codex) treat `fast`/`standard` as
 * a tier modifier. Everywhere else the suffix stays part of the opaque model
 * ID, so it reaches dispatch intact. */
function tierApplies(provider) {
  if (provider === null || provider === undefined) return true;
  return supportsServiceTier(provider);
}

/** Parse an optional service tier alongside one recognized thinking modifier.
 * Unknown or conflicting suffixes remain part of the opaque model ID.
 *
 * `provider` scopes the tier control to the providers that accept a service
 * tier. On every other provider a tier-shaped suffix is opaque model-ID text,
 * so the whole suffix is preserved and no tier is selected.
 */
export function parseModelModifiers(model, provider = null) {
  const empty = { cleanModel: model, override: null, serviceTier: null };
  if (!isString(model)) return empty;
  const match = model.match(/^(.*)\(([^()]+)\)\s*$/);
  if (!match || !match[1].trim()) return empty;
  const tokens = match[2].split(",").map((token) => token.trim().toLowerCase());
  const tiers = tokens.filter((token) => token === "fast" || token === "standard");
  if (!tiers.length || !tierApplies(provider)) return { ...parseThinkingSuffix(model), serviceTier: null };
  const thinking = tokens.filter((token) => token !== "fast" && token !== "standard");
  if (tiers.length !== 1 || thinking.length > 1 || thinking.includes("")) return empty;
  const cleanModel = match[1].trim();
  const parsed = thinking.length ? parseThinkingSuffix(`${cleanModel}(${thinking[0]})`) : { cleanModel, override: null };
  if (thinking.length && !parsed.override) return empty;
  return { ...parsed, serviceTier: tiers[0] === "fast" ? "priority" : "default" };
}

export function parseSuffix(model, provider = null) {
  const { cleanModel, override } = parseModelModifiers(model, provider);
  return { cleanModel, override };
}

/** Strip only a recognized request-only thinking suffix. */
export function stripThinkingSuffix(model, provider = null) {
  const parsed = parseSuffix(model, provider);
  return parsed.cleanModel;
}