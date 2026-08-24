import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { parseModel, resolveProviderAlias } from "open-sse/services/model.js";
import { getModelCapabilityOverride } from "./db/repos/modelCapabilityOverridesRepo.js";

/**
 * Resolve effective model capabilities, applying manual DB overrides on top of the
 * registry/sync/spec fallback chain used by the rest of the runtime.
 *
 * This is the DurinDoor equivalent of OmniRoute's `getResolvedModelCapabilities`:
 * it is async because the SQLite adapter is async, and it is kept app-side so the
 * sync capability tables inside `open-sse` do not need to change shape.
 *
 * @param {string | { provider?: string | null, model?: string | null }} input
 *   Either a "provider/model" string or an object with provider/model fields.
 * @returns {Promise<{ provider: string | null, model: string | null, maxOutputTokens: number | null }>}
 */
import { isObject, isString } from "../shared/utils/typeChecks.js";
export async function getResolvedModelCapabilities(input) {
  let provider = null;
  let model = null;

  if (isString(input)) {
    const parsed = parseModel(input);
    provider = parsed.provider;
    model = parsed.model;
  } else if (input && isObject(input)) {
    provider = input.provider ? resolveProviderAlias(input.provider) : null;
    model = input.model || null;
  }

  const base = getCapabilitiesForModel(provider, model);
  const maxOutputTokens =
  (await getModelCapabilityOverride(provider, model, "max_token")) ?? base.maxOutput ?? null;

  return { provider, model, maxOutputTokens };
}

/**
 * Resolve the effective max output tokens for a provider/model, applying any stored
 * `max_token` override. Falls back to the static capability table when no override
 * is set.
 *
 * @param {string | null} provider
 * @param {string | null} model
 * @returns {Promise<number | null>}
 */
export async function getResolvedMaxOutputTokens(provider, model) {
  const caps = await getResolvedModelCapabilities({ provider, model });
  return caps.maxOutputTokens;
}