import REGISTRY from "../providers/registry/index.js";
import {
  MODEL_CAPABILITIES,
  PROVIDER_CAPABILITIES,
} from "../providers/capabilities.js";
import { normalizeModelId } from "../providers/models/schema.js";
import { supportsReasoning } from "./modelCapabilities.js";

/** Add reasoning headroom without exceeding an explicit model output cap. */
export const REASONING_BUFFER_MIN_TRIGGER = 256;

export function toPositiveInteger(value) {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const normalized = Math.floor(numeric);
  return normalized > 0 ? normalized : null;
}

function findNormalizedEntry(entries, model) {
  const normalizedModel = normalizeModelId(model);
  return Object.entries(entries || {}).find(([id]) => normalizeModelId(id) === normalizedModel)?.[1] || null;
}

export function getExplicitModelOutputCap(modelStr) {
  const slash = typeof modelStr === "string" ? modelStr.indexOf("/") : -1;
  if (slash <= 0) return null;

  const provider = modelStr.slice(0, slash);
  const model = modelStr.slice(slash + 1);
  const registryProvider = REGISTRY.find((entry) =>
    [entry.id, entry.alias, entry.uiAlias, ...(entry.aliases || [])].includes(provider)
  );
  const providerIds = [
    provider,
    registryProvider?.id,
    registryProvider?.alias,
    registryProvider?.uiAlias,
    ...(registryProvider?.aliases || []),
  ].filter(Boolean);

  for (const providerId of providerIds) {
    const providerCaps = findNormalizedEntry(PROVIDER_CAPABILITIES[providerId], model);
    if (typeof providerCaps?.maxOutput === "number") return providerCaps.maxOutput;
  }

  const registryModel = registryProvider?.models?.find((entry) =>
    normalizeModelId(entry.id) === normalizeModelId(model)
  );
  if (typeof registryModel?.maxOutputTokens === "number") return registryModel.maxOutputTokens;

  const staticCaps = findNormalizedEntry(MODEL_CAPABILITIES, model);
  return staticCaps?.maxOutput ?? null;
}

function getExplicitModelThinkingSupport(modelStr) {
  const slash = typeof modelStr === "string" ? modelStr.indexOf("/") : -1;
  if (slash <= 0) return null;

  const provider = modelStr.slice(0, slash);
  const model = modelStr.slice(slash + 1);
  const registryProvider = REGISTRY.find((entry) =>
    [entry.id, entry.alias, entry.uiAlias, ...(entry.aliases || [])].includes(provider)
  );
  if (!supportsReasoning(`${registryProvider?.id || provider}/${model}`)) return false;
  const providerIds = [
    provider,
    registryProvider?.id,
    registryProvider?.alias,
    registryProvider?.uiAlias,
    ...(registryProvider?.aliases || []),
  ].filter(Boolean);

  for (const providerId of providerIds) {
    const reasoning = findNormalizedEntry(PROVIDER_CAPABILITIES[providerId], model)?.reasoning;
    if (typeof reasoning === "boolean") return reasoning;
  }

  const registryModel = registryProvider?.models?.find((entry) =>
    normalizeModelId(entry.id) === normalizeModelId(model)
  );
  if (typeof registryModel?.supportsReasoning === "boolean") return registryModel.supportsReasoning;
  if (typeof registryModel?.thinking === "boolean") return registryModel.thinking;

  const reasoning = findNormalizedEntry(MODEL_CAPABILITIES, model)?.reasoning;
  return typeof reasoning === "boolean" ? reasoning : null;
}

export function resolveReasoningBufferedMaxTokens(
  modelStr,
  currentMaxTokens,
  options = {},
) {
  if (options.enabled === false) return null;

  const current = toPositiveInteger(currentMaxTokens);
  if (current === null) return null;

  if (getExplicitModelThinkingSupport(modelStr) !== true) return null;

  const maxOutput = toPositiveInteger(getExplicitModelOutputCap(modelStr));
  if (maxOutput === null) return null;
  if (current > maxOutput) return maxOutput;
  if (current < REASONING_BUFFER_MIN_TRIGGER) return current;

  const buffered = Math.max(current + 1000, Math.ceil(current * 1.5));
  return buffered > maxOutput ? current : buffered;
}
