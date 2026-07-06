import REGISTRY_LIST from "../providers/registry/index.js";
import {
  generateProviderPluginManifestFromRegistry,
  getProviderPluginManifestEntryFromRegistry,
} from "./providerPluginManifest.js";

const REGISTRY = Object.fromEntries(REGISTRY_LIST.map((entry) => [entry.id, entry]));

export function generateProviderPluginManifest() {
  return generateProviderPluginManifestFromRegistry(REGISTRY);
}

export function getProviderPluginManifestEntry(provider) {
  return getProviderPluginManifestEntryFromRegistry(REGISTRY, provider);
}

export function getProviderPluginManifestEntryForModel(model) {
  if (!model) return null;

  const providerPrefix = model.includes("/") ? model.split("/", 1)[0] : "";
  if (providerPrefix) {
    const prefixed = getProviderPluginManifestEntry(providerPrefix);
    if (prefixed) return prefixed;
  }

  const manifest = generateProviderPluginManifest();
  return manifest.providers.find((provider) =>
    provider.models.some((candidate) => candidate.id === model)
  ) || null;
}
