export const PROVIDER_PLUGIN_MANIFEST_HEADER = "X-OmniRoute-Provider-Manifest-Url";
export const PROVIDER_PLUGIN_MANIFEST_PATH = "/api/v1/provider-plugin-manifest";

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function appendManifestPath(baseUrl) {
  return `${trimTrailingSlash(baseUrl)}${PROVIDER_PLUGIN_MANIFEST_PATH}`;
}

/**
 * Resolve the sidecar manifest URL from trusted server configuration only.
 * Inbound request headers such as Origin are intentionally ignored; set
 * OMNIROUTE_PROVIDER_MANIFEST_URL or BASE_URL for public sidecar deployments.
 */
export function resolveProviderPluginManifestUrl() {
  const configured = process.env.OMNIROUTE_PROVIDER_MANIFEST_URL?.trim();
  if (configured) return configured;

  const publicBaseUrl = (
    process.env.BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    ""
  ).trim();
  if (/^https?:\/\//i.test(publicBaseUrl)) {
    return appendManifestPath(publicBaseUrl);
  }

  const host = process.env.HOST || "127.0.0.1";
  const port = process.env.PORT || process.env.DASHBOARD_PORT || process.env.API_PORT || "20128";
  const protocol = process.env.OMNIROUTE_PUBLIC_PROTOCOL || "http";
  return `${protocol}://${host}:${port}${PROVIDER_PLUGIN_MANIFEST_PATH}`;
}

export function getProviderPluginManifestHeader() {
  return {
    [PROVIDER_PLUGIN_MANIFEST_HEADER]: resolveProviderPluginManifestUrl(),
  };
}
