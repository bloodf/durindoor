import { isRecord, isString } from "../../../../shared/utils/typeChecks.js";
import { validateXaiOAuthEndpoint } from "../../providerHelpers.js";
import { XAI_CONFIG } from "../../constants/xai.js";
import { oauthFailureMessage } from "./oauthError.js";

/**
 * Web-safe xAI discovery and code exchange for the dashboard `xai` provider.
 * Staged: production providers.js still uses its inlined discovery, which caches
 * the static fallback for the process lifetime and copies token error bodies.
 * Behavior follows the CLI service in src/lib/oauth/services/xai.js and
 * CLIProxyAPI internal/auth/xai/xai.go (MIT, dbe641f) endpoint validation.
 */
const proxyDiscovery = new WeakMap();
let directDiscovery = null;

export function resetXaiWebDiscoveryCache() {
  directDiscovery = null;
}

export async function discoverXaiWebEndpoints(proxyOptions = null) {
  const keyed = isRecord(proxyOptions);
  const cached = keyed ? proxyDiscovery.get(proxyOptions) : directDiscovery;
  if (cached) return cached;
  try {
    const res = await fetch(XAI_CONFIG.discoveryUrl, { headers: { Accept: "application/json" }, proxyOptions });
    if (res.ok) {
      const data = await res.json();
      const discovered = {
        authorizeUrl: validateXaiOAuthEndpoint(data?.authorization_endpoint, "authorization_endpoint"),
        tokenUrl: validateXaiOAuthEndpoint(data?.token_endpoint, "token_endpoint")
      };
      if (keyed) proxyDiscovery.set(proxyOptions, discovered);
      else directDiscovery = discovered;
      return discovered;
    }
  } catch {
    // Use static endpoints for this attempt; the next attempt retries discovery.
  }
  return { authorizeUrl: XAI_CONFIG.authorizeUrl, tokenUrl: XAI_CONFIG.tokenUrl };
}

/** Same request as production `xai.exchangeToken`, with body-free failures. */
export async function exchangeXaiWebCode(config, code, redirectUri, codeVerifier, proxyOptions = null) {
  if (!isString(code) || !code || !isString(codeVerifier) || !codeVerifier || !isString(redirectUri) || !redirectUri) {
    throw new Error("Invalid xAI exchange parameters");
  }
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    }),
    proxyOptions
  });
  if (!response.ok) throw new Error(await oauthFailureMessage("xAI token exchange failed", response));
  const tokens = await response.json();
  if (!isString(tokens?.access_token) || !tokens.access_token.trim()) {
    throw new Error("xAI token response missing access_token");
  }
  return tokens;
}
