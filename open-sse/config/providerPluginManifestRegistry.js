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

  const manifest = generateProviderPluginManifest();
  const exact = manifest.providers.find((provider) =>
    provider.models.some((candidate) => candidate.id === model)
  );
  if (exact) return exact;

  const providerPrefix = model.includes("/") ? model.split("/", 1)[0] : "";
  if (providerPrefix) {
    return getProviderPluginManifestEntry(providerPrefix);
  }
  return null;
}
