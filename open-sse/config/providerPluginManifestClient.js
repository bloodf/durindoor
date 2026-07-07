export const PROVIDER_PLUGIN_MANIFEST_PATH = "/api/v1/provider-plugin-manifest";
export const PROVIDER_PLUGIN_MANIFEST_ENV = "OMNIROUTE_PROVIDER_MANIFEST_URL";

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export function resolveProviderPluginManifestUrl(options = {}) {
  const explicitUrl = options.manifestUrl?.trim();
  if (explicitUrl) return explicitUrl;

  const envUrl = process.env[PROVIDER_PLUGIN_MANIFEST_ENV]?.trim();
  if (envUrl) return envUrl;

  const baseUrl = options.baseUrl?.trim();
  if (baseUrl) return `${trimTrailingSlash(baseUrl)}${PROVIDER_PLUGIN_MANIFEST_PATH}`;

  const host = process.env.HOST || "127.0.0.1";
  const port = process.env.PORT || process.env.DASHBOARD_PORT || process.env.API_PORT || "20128";
  const protocol = process.env.OMNIROUTE_PUBLIC_PROTOCOL || "http";
  return `${protocol}://${host}:${port}${PROVIDER_PLUGIN_MANIFEST_PATH}`;
}

export async function fetchProviderPluginManifest(options = {}) {
  const fetcher = options.fetchImpl || fetch;
  const response = await fetcher(resolveProviderPluginManifestUrl(options), {
    headers: { Accept: "application/json" },
    signal: options.signal || undefined,
  });

  if (!response.ok) {
    throw new Error(`Provider plugin manifest request failed: HTTP ${response.status}`);
  }

  const manifest = await response.json();
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.providers)) {
    throw new Error("Provider plugin manifest response is not schemaVersion 1");
  }
  return manifest;
}

export function getProviderPluginManifestEntryForModelFromManifest(manifest, model) {
  if (!model) return null;

  const exactOwner = manifest.providers.find((provider) =>
    provider.models.some((candidate) => candidate.id === model)
  );
  if (exactOwner) return exactOwner;

  const providerPrefix = model.includes("/") ? model.split("/", 1)[0] : "";
  if (providerPrefix) {
    const prefixed = manifest.providers.find(
      (provider) =>
        provider.id === providerPrefix ||
        provider.alias === providerPrefix ||
        provider.aliases?.includes(providerPrefix)
    );
    if (prefixed) return prefixed;
  }

  return null;
}

export async function fetchProviderPluginManifestEntryForModel(model, options = {}) {
  const manifest = await fetchProviderPluginManifest(options);
  return getProviderPluginManifestEntryForModelFromManifest(manifest, model);
}
