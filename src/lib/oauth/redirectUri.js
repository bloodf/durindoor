// OAuth redirect_uri construction. Claude uses Anthropic's manual-code callback;
// other non-loopback providers redirect to the browser-visible dashboard URL.
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export const CODEX_LOOPBACK_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const CLAUDE_MANUAL_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
export const XAI_LOOPBACK_REDIRECT_URI = "http://127.0.0.1:56121/callback";

export function isLoopbackHostname(hostname) {
  return LOOPBACK_HOSTNAMES.has(String(hostname || "").trim().toLowerCase());
}

// The public base URL, without a trailing slash. Prefers the operator-set
// NEXT_PUBLIC_BASE_URL, then location.origin, then falls back to
// protocol+host for environments that do not expose window.location.origin.
export function publicBaseUrl(location) {
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const origin = location?.origin;
  if (origin) return origin.replace(/\/+$/, "");
  return `${location?.protocol || "https:"}//${location?.host || ""}`.replace(/\/+$/, "");
}

/**
 * Build the redirect_uri to hand to the provider's authorization server.
 *
 * @param {object} location window.location ({ hostname, port, protocol, origin })
 * @param {string} provider provider id
 * @returns {string} absolute redirect_uri
 */
export function buildOAuthRedirectUri(location, provider) {
  // Fixed-port loopback flows: the CLI these providers pair with listens on a
  // known port, so the redirect is not ours to choose.
  if (provider === "codex") return CODEX_LOOPBACK_REDIRECT_URI;
  if (provider === "xai") return XAI_LOOPBACK_REDIRECT_URI;
  if (provider === "claude") return CLAUDE_MANUAL_REDIRECT_URI;

  if (isLoopbackHostname(location?.hostname)) {
    // Other loopback providers use the app's local callback listener.
    const appPort = location.port || (location?.protocol === "https:" ? "443" : "80");
    return `http://localhost:${appPort}/callback`;
  }

  return `${publicBaseUrl(location)}/callback`;
}
