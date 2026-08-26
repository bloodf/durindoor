/**
 * Additive model/provider display projection for `/v1/models`.
 *
 * Returns friendly `name` / provider labels without mutating callable `id`,
 * `owned_by`, or routing identities. Callers that already expose a registry
 * `name` (notably `/v1/models/info`) must keep that name and only take the
 * extra provider fields — never overwrite an existing registry name.
 */
import REGISTRY from "../registry/index.js";
import { deriveModelName } from "./namePatterns.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";

function findProvider(providerId, outputAlias) {
  return REGISTRY.find((provider) =>
    provider.id === providerId
    || provider.alias === providerId
    || provider.uiAlias === providerId
    || provider.aliases?.includes(providerId)
    || provider.id === outputAlias
    || provider.alias === outputAlias
    || provider.uiAlias === outputAlias
    || provider.aliases?.includes(outputAlias)
  ) || null;
}

function suppliedDisplayName(model, modelId) {
  // Live provider catalogs often echo the model id as `name` (observed on
  // Codex: `gpt-5.6-sol`). An id-equal name is not a display name; treating
  // it as one shadows the friendly registry label, so only a name that
  // differs from the id counts as supplied.
  if (!isString(model.name)) return null;
  const name = model.name.trim();
  if (!name || name === modelId) return null;
  return name;
}

export function projectModelPresentation({ model = {}, modelId, providerId, outputAlias }) {
  const suppliedName = suppliedDisplayName(model, modelId);
  const provider = findProvider(providerId, outputAlias);
  if (!provider) {
    return {
      name: suppliedName || deriveModelName(modelId),
      provider_name: providerId,
      provider_alias: outputAlias,
      gateway_provider: providerId,
    };
  }

  const registryModel = provider.models?.find((entry) => entry.id === modelId);
  // Prefer the caller's model.name (only when it is a real display name, not
  // an echo of the id), then the registry row, then a derived label.
  // Never invent a hyphenated rewrite of an existing registry name.
  const name = suppliedName || registryModel?.name || deriveModelName(modelId);
  const providerName = model.providerName
    || registryModel?.providerName
    || provider.modelProviderName
    || provider.display?.name
    || provider.id;
  const gatewayProvider = provider.display?.name || providerName;

  return {
    name,
    provider_name: providerName,
    provider_alias: outputAlias,
    gateway_provider: gatewayProvider,
  };
}
