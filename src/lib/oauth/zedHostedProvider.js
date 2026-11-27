// Zed-hosted native-app sign-in (staged; not wired into providers.js).
//
// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// src/lib/oauth/providers/zed-hosted.ts (MIT).
//
// The flow follows `authorization_code` but carries an RSA private key where PKCE
// would carry a code verifier: `buildAuthUrl` returns { authUrl, codeVerifier,
// redirectUri } and `exchangeToken` receives the pasted native-app callback URL as
// `code`. Zed always redirects to http://127.0.0.1:<native_app_port>/ and ignores any
// path, so a loopback dashboard reuses its own port and the callback relay completes
// the flow; any other host leaves the dead default port and the user pastes the URL.
// Access tokens are long-lived and Zed exposes no refresh grant, so mapTokens sets no
// refreshToken or expiry; the short-lived LLM token is re-exchanged on demand.
import {
  ZED_DEFAULT_NATIVE_APP_PORT,
  ZED_HOSTED_CONFIG,
  createZedNativeAuthData,
  decryptZedAccessToken,
  fetchZedAuthenticatedUser,
  parseZedCallbackPayload,
  resolveZedOrganizationId,
} from "../../../open-sse/shared/zedHostedAuth.js";
import { proxyAwareFetch } from "../../../open-sse/utils/proxyFetch.js";
import { credentialFetch } from "../../../open-sse/utils/credentialFetch.js";

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/i;

// Only the hostname of the browser's redirect URI is trusted. Its port reflects what the
// browser sees (a TLS front proxy on 443, say), so the server's own listening port wins.
export function resolveDashboardLoopbackPort(redirectUri, env = process.env) {
  try {
    const url = new URL(String(redirectUri));
    if (!LOOPBACK_HOST.test(url.hostname)) return null;
    const port = Number.parseInt(env.PORT || env.DASHBOARD_PORT || url.port, 10);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

export const zedHosted = {
  config: ZED_HOSTED_CONFIG,
  flowType: "authorization_code",
  buildAuthUrl: (config, redirectUri) => {
    const nativeAppPort = resolveDashboardLoopbackPort(redirectUri) || config.defaultNativeAppPort || ZED_DEFAULT_NATIVE_APP_PORT;
    const authData = createZedNativeAuthData(config, { nativeAppPort });
    return {
      authUrl: authData.authUrl,
      codeVerifier: authData.privateKeyVerifier,
      redirectUri: `http://127.0.0.1:${authData.nativeAppPort}/`,
      systemId: authData.systemId,
    };
  },
  exchangeToken: async (config, code, _redirectUri, codeVerifier, _state, meta = {}, proxyOptions = null, signal = null) => {
    signal?.throwIfAborted();
    const { userId, encryptedAccessToken } = parseZedCallbackPayload(code);
    const accessToken = decryptZedAccessToken(encryptedAccessToken, codeVerifier);
    const credentials = { accessToken, providerSpecificData: { userId, systemId: meta?.systemId } };
    let userInfo = null;
    let organizationId = "";
    try {
      const baseFetch = meta?.fetch || ((url, init) => proxyAwareFetch(url, init, proxyOptions));
      userInfo = await fetchZedAuthenticatedUser(credentials, { config, signal, fetch: (url, init) => credentialFetch(baseFetch, url, init, { maxRedirects: 0 }) });
      organizationId = resolveZedOrganizationId(credentials, userInfo);
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError" || error?.name === "TimeoutError") throw error;
      // Non-fatal: the account still works without a resolved profile. The LLM token
      // exchange resolves the organization on first use.
    }
    return {
      access_token: accessToken,
      user_id: userId,
      system_id: meta?.systemId,
      email: userInfo?.email || userInfo?.github_login,
      name: userInfo?.name || userInfo?.github_login,
      organization_id: organizationId,
    };
  },
  mapTokens: (tokens) => ({
    accessToken: tokens.access_token,
    name: tokens.name || tokens.email || null,
    email: tokens.email,
    providerSpecificData: {
      userId: tokens.user_id,
      organizationId: tokens.organization_id || undefined,
      systemId: tokens.system_id || undefined,
    },
  }),
};

export default zedHosted;
