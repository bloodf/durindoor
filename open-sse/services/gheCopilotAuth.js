/**
 * GitHub Enterprise Copilot token lifecycle.
 *
 * Mirrors the github.com Copilot flow against the connection's enterprise host:
 * the stored GitHub OAuth token mints a short-lived Copilot token at
 * `{gheUrl}/api/v3/copilot_internal/v2/token`; when that fails and a refresh
 * token exists, the OAuth token is refreshed at `{gheUrl}/login/oauth/access_token`
 * first. The token response carries `endpoints.api` (chat + models host), which
 * is returned as `providerSpecificData.copilotApiUrl` so routing follows it.
 */
import { GITHUB_COPILOT } from "../config/appConstants.js";
import { PROVIDERS } from "../config/providers.js";
import { gheCopilotTokenUrl, gheOAuthTokenUrl, normalizeGheUrl } from "../config/gheCopilot.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

/** OAuth client id for GHE: env override first, then the registry default. */
export function gheCopilotClientId() {
  return process.env.GHE_COPILOT_OAUTH_CLIENT_ID || PROVIDERS["ghe-copilot"]?.clientId;
}

async function drain(response) {
  try {await response.body?.cancel?.();} catch {/* best effort */}
}

/**
 * Exchange a GHE GitHub OAuth token for a Copilot token.
 * @returns {Promise<{token: string, expiresAt: number|string, apiUrl?: string, proxyUrl?: string}|null>}
 */
export async function fetchGheCopilotToken(gheUrl, githubAccessToken, log, proxyOptions = null) {
  if (!gheUrl || !githubAccessToken) return null;
  try {
    const response = await proxyAwareFetch(gheCopilotTokenUrl(gheUrl), {
      headers: {
        Authorization: `token ${githubAccessToken}`,
        "User-Agent": GITHUB_COPILOT.USER_AGENT,
        "Editor-Version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
        "Editor-Plugin-Version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
        Accept: "application/json",
        "x-github-api-version": GITHUB_COPILOT.API_VERSION
      }
    }, proxyOptions);
    if (!response.ok) {
      await drain(response);
      log?.error?.("TOKEN", `GHE Copilot token exchange failed with HTTP ${response.status}`);
      return null;
    }
    const data = await response.json();
    if (!data?.token) return null;
    return {
      token: data.token,
      expiresAt: data.expires_at,
      apiUrl: normalizeGheUrl(data.endpoints?.api) ? data.endpoints.api : undefined,
      proxyUrl: normalizeGheUrl(data.endpoints?.proxy) ? data.endpoints.proxy : undefined
    };
  } catch {
    log?.error?.("TOKEN", "GHE Copilot token request failed");
    return null;
  }
}

/** Refresh the GHE GitHub OAuth token. Returns null when the host refuses. */
export async function refreshGheOAuthToken(gheUrl, refreshToken, log, proxyOptions = null) {
  if (!gheUrl || !refreshToken) return null;
  try {
    const response = await proxyAwareFetch(gheOAuthTokenUrl(gheUrl), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: gheCopilotClientId()
      })
    }, proxyOptions);
    if (!response.ok) {
      await drain(response);
      return null;
    }
    const tokens = await response.json();
    if (!tokens?.access_token) return null;
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken,
      expiresIn: tokens.expires_in
    };
  } catch {
    log?.error?.("TOKEN", "GHE OAuth refresh request failed");
    return null;
  }
}

function copilotFields(result) {
  const providerSpecificData = {};
  if (result.apiUrl) providerSpecificData.copilotApiUrl = result.apiUrl;
  if (result.proxyUrl) providerSpecificData.copilotProxyUrl = result.proxyUrl;
  return {
    copilotToken: result.token,
    copilotTokenExpiresAt: result.expiresAt,
    ...(Object.keys(providerSpecificData).length ? { providerSpecificData } : null)
  };
}

/**
 * Refresh a ghe-copilot connection: Copilot token first, OAuth refresh only
 * when the stored OAuth token can no longer mint one.
 * @param {object} credentials executor credentials (accessToken, refreshToken, providerSpecificData)
 * @returns {Promise<object|null>}
 */
export async function refreshGheCopilotCredentials(credentials, log, proxyOptions = null) {
  const gheUrl = normalizeGheUrl(credentials?.providerSpecificData?.gheUrl);
  if (!gheUrl) {
    log?.warn?.("TOKEN", "GHE Copilot connection has no valid gheUrl; reconnect it");
    return null;
  }

  const direct = await fetchGheCopilotToken(gheUrl, credentials.accessToken, log, proxyOptions);
  if (direct) {
    return {
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      ...copilotFields(direct)
    };
  }

  const oauth = await refreshGheOAuthToken(gheUrl, credentials?.refreshToken, log, proxyOptions);
  if (!oauth) return null;
  const minted = await fetchGheCopilotToken(gheUrl, oauth.accessToken, log, proxyOptions);
  return minted ? { ...oauth, ...copilotFields(minted) } : oauth;
}
