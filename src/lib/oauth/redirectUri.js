// OAuth redirect_uri construction. Claude uses Anthropic's manual-code callback;
// other non-loopback providers redirect to the browser-visible dashboard URL.
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export const CODEX_LOOPBACK_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const CLAUDE_MANUAL_REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
export const XAI_LOOPBACK_REDIRECT_URI = "http://127.0.0.1:56121/callback";
// Built-in Antigravity desktop client callback (CLIProxyAPI
// internal/auth/antigravity/auth.go @47f18e4d, CallbackPort 51121). The server
// applies it at authorize time whenever no custom client is configured, for
// local and remote dashboards alike, because the desktop client has no other
// registered redirect. Kept equal to open-sse/providers/shared.js.
export const ANTIGRAVITY_DESKTOP_REDIRECT_URI = "http://localhost:51121/oauth-callback";

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
 * Server-side default redirect_uri for a provider, used when the caller does
 * not send one.
 *
 * Claude is special: Anthropic accepts only its own manual-code callback for
 * this OAuth client, so a caller that omits the redirect_uri must still get a
 * registered value. Every other provider keeps the generic dashboard
 * callback, which the route fills in.
 *
 * @param {string} provider provider id
 * @returns {string|null} absolute redirect_uri, or null for the generic default
 */
export function defaultOAuthRedirectUri(provider) {
  if (provider === "claude") return CLAUDE_MANUAL_REDIRECT_URI;
  return null;
}

/**
 * Build the redirect_uri to hand to the provider's authorization server.
 *
 * @param {object} location window.location ({ hostname, port, protocol, origin })
 * @param {string} provider provider id
 * @returns {string} absolute redirect_uri
 */
export function buildOAuthRedirectUri(location, provider, hosted = false) {
  // RenderHour accepts only loopback redirects (any port, RFC 8252 section 7.3),
  // so remote and hosted dashboards use one too and the user pastes the callback
  // URL back. The path is exactly /callback, without the base path. Source:
  // cheaper-inference/OmniRoute d3f06ea668109f8ac1feadfcae25f6ff9b873b5f,
  // src/shared/components/OAuthModal.tsx (LOOPBACK_REDIRECT_PROVIDERS).
  if (provider === "renderhour") {
    const host = location?.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost";
    const defaultPort = isLoopbackHostname(location?.hostname) ?
    location.protocol === "https:" ? "443" : "80" :
    "20128";
    return `http://${host}:${location?.port || defaultPort}/callback`;
  }
  if (hosted && provider !== "claude") return `${publicBaseUrl(location)}${process.env.NEXT_PUBLIC_BASE_PATH || ""}/callback`;
  // Fixed-port loopback flows: the CLI these providers pair with listens on a
  // known port, so the redirect is not ours to choose.
  if (provider === "codex") return CODEX_LOOPBACK_REDIRECT_URI;
  if (provider === "xai") return XAI_LOOPBACK_REDIRECT_URI;
  if (provider === "claude") return CLAUDE_MANUAL_REDIRECT_URI;

  if (isLoopbackHostname(location?.hostname)) {
    // Other loopback providers use the app's local callback listener.
    const appPort = location.port || (location?.protocol === "https:" ? "443" : "80");
    return `http://localhost:${appPort}${process.env.NEXT_PUBLIC_BASE_PATH || ""}/callback`;
  }

  return `${publicBaseUrl(location)}${process.env.NEXT_PUBLIC_BASE_PATH || ""}/callback`;
}
