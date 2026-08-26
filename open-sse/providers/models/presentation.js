import REGISTRY from "../registry/index.js";
import { deriveModelName } from "./namePatterns.js";

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

export function projectModelPresentation({ model = {}, modelId, providerId, outputAlias }) {
  const provider = findProvider(providerId, outputAlias);
  if (!provider) {
    return {
      name: model.name || deriveModelName(modelId),
      provider_name: providerId,
      provider_alias: outputAlias,
      gateway_provider: providerId,
    };
  }

  const registryModel = provider.models?.find((entry) => entry.id === modelId);
  const name = model.name || registryModel?.name || deriveModelName(modelId);
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
