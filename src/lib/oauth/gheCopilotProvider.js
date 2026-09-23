/**
 * GitHub Enterprise Copilot OAuth adapter (device code flow).
 *
 * Same device grant as github.com Copilot, run against the enterprise host the
 * user typed (`gheUrl`). The route validates that host before the flow starts;
 * `requestDeviceCode` returns it as the private `_gheUrl` field so it is kept in
 * the server-side flow payload (never sent back to the browser) and handed to
 * `pollToken` and `postExchange` as extraData.
 */
import { PROVIDER_OAUTH } from "open-sse/providers/index.js";
import { GITHUB_COPILOT } from "open-sse/config/appConstants.js";
import { gheCopilotTokenUrl, gheOAuthTokenUrl, normalizeGheUrl } from "open-sse/config/gheCopilot.js";
import { gheCopilotClientId } from "open-sse/services/gheCopilotAuth.js";

const GHE_OAUTH = PROVIDER_OAUTH["ghe-copilot"] || {};

function requireGheUrl(value) {
  const gheUrl = normalizeGheUrl(value);
  if (!gheUrl) throw new Error("A valid https GitHub Enterprise URL is required");
  return gheUrl;
}

async function readJsonOrError(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: "invalid_response", error_description: text.slice(0, 200) };
  }
}

async function getJson(url, accessToken, proxyOptions) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "X-GitHub-Api-Version": GHE_OAUTH.apiVersion,
      "User-Agent": GITHUB_COPILOT.USER_AGENT
    },
    proxyOptions
  });
  return response.ok ? response.json() : {};
}

export default {
  config: { ...GHE_OAUTH, get clientId() {return gheCopilotClientId();} },
  flowType: "device_code",
  requestDeviceCode: async (config, _codeChallenge, options = {}, proxyOptions) => {
    const gheUrl = requireGheUrl(options.gheUrl);
    const response = await fetch(`${gheUrl}/login/device/code`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: config.clientId, scope: config.scopes }),
      proxyOptions
    });
    if (!response.ok) {
      throw new Error(`GitHub Enterprise device code request failed (HTTP ${response.status})`);
    }
    return { ...await response.json(), _gheUrl: gheUrl };
  },
  pollToken: async (config, deviceCode, _codeVerifier, extraData, proxyOptions) => {
    const gheUrl = requireGheUrl(extraData?._gheUrl);
    const response = await fetch(gheOAuthTokenUrl(gheUrl), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: config.clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      }),
      proxyOptions
    });
    return { ok: response.ok, data: await readJsonOrError(response) };
  },
  postExchange: async (tokens, proxyOptions, extraData) => {
    const gheUrl = requireGheUrl(extraData?._gheUrl);
    const [copilotToken, userInfo] = await Promise.all([
    getJson(gheCopilotTokenUrl(gheUrl), tokens.access_token, proxyOptions),
    getJson(`${gheUrl}/api/v3/user`, tokens.access_token, proxyOptions)]
    );
    return { gheUrl, copilotToken, userInfo };
  },
  mapTokens: (tokens, extra) => {
    const endpoints = extra?.copilotToken?.endpoints || {};
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      name: extra?.userInfo?.login || extra?.userInfo?.name,
      displayName: extra?.userInfo?.name || extra?.userInfo?.login,
      email: extra?.userInfo?.email || null,
      providerSpecificData: {
        gheUrl: extra?.gheUrl,
        copilotApiUrl: normalizeGheUrl(endpoints.api) ? endpoints.api : undefined,
        copilotProxyUrl: normalizeGheUrl(endpoints.proxy) ? endpoints.proxy : undefined,
        copilotToken: extra?.copilotToken?.token,
        copilotTokenExpiresAt: extra?.copilotToken?.expires_at,
        githubUserId: extra?.userInfo?.id,
        githubLogin: extra?.userInfo?.login,
        githubName: extra?.userInfo?.name,
        githubEmail: extra?.userInfo?.email
      }
    };
  }
};
