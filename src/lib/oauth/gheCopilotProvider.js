/**
 * GitHub Enterprise Copilot OAuth adapter (device code flow).
 *
 * Same device grant as github.com Copilot, run against the enterprise host the
 * user typed (`gheUrl`). The route validates that host before the flow starts;
 * `requestDeviceCode` returns it as the private `_gheUrl` field so it is kept in
 * the server-side flow payload (never sent back to the browser) and handed to
 * `pollToken` and `postExchange` as extraData.
 *
 * Every request is bound to that host and the flow's proxy by
 * `providerParity/copilot/gheConnection.js`: redirects are refused, the
 * provider outbound guard applies, and token-supplied endpoints are kept only
 * when the enterprise connection trusts them.
 */
import { PROVIDER_OAUTH } from "../../../open-sse/providers/index.js";
import { GITHUB_COPILOT } from "../../../open-sse/config/appConstants.js";
import { gheCopilotTokenUrl, gheOAuthTokenUrl } from "../../../open-sse/config/gheCopilot.js";
import { decodeCopilotPollResponse } from "./providerParity/copilot/index.js";
import {
  GheConnectionError,
  bindGheConnection,
  gheBoundFetch,
  globalFetchTransport,
  pickGheDeviceResponse,
  pickGheUserInfo,
  trustedGheEndpoints
} from "./providerParity/copilot/gheConnection.js";
import { gheCopilotClientId } from "../../../open-sse/services/gheCopilotAuth.js";
import { isNumber, isRecord, isString } from "../../shared/utils/typeChecks.js";

const GHE_OAUTH = PROVIDER_OAUTH["ghe-copilot"] || {};
const transport = { transport: globalFetchTransport };

function bind(gheUrl, config, proxyOptions) {
  return bindGheConnection({ gheUrl, proxyOptions, clientId: config?.clientId });
}

async function getJson(binding, url, accessToken) {
  try {
    const response = await gheBoundFetch(binding, url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "X-GitHub-Api-Version": GHE_OAUTH.apiVersion,
        "User-Agent": GITHUB_COPILOT.USER_AGENT
      }
    }, transport);
    if (!response.ok) {
      try { await response.body?.cancel?.(); } catch { /* best effort */ }
      return {};
    }
    const data = await response.json().catch(() => ({}));
    return isRecord(data) ? data : {};
  } catch (error) {
    if (error instanceof GheConnectionError) return {};
    throw error;
  }
}

/** Keep the session token and trusted endpoints; drop a token that is already expired. */
function sessionFromExchange(binding, data) {
  if (!isString(data.token) || !data.token) return {};
  if (isNumber(data.expires_at) && data.expires_at <= Date.now() / 1000) return {};
  const endpoints = trustedGheEndpoints(binding, data.endpoints);
  return {
    token: data.token,
    ...(isNumber(data.expires_at) ? { expires_at: data.expires_at } : null),
    ...(Object.keys(endpoints).length ? { endpoints } : null)
  };
}

export default {
  config: { ...GHE_OAUTH, get clientId() {return gheCopilotClientId();} },
  flowType: "device_code",
  requestDeviceCode: async (config, _codeChallenge, options = {}, proxyOptions) => {
    const binding = bind(options.gheUrl, config, proxyOptions);
    const response = await gheBoundFetch(binding, `${binding.gheUrl}/login/device/code`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: binding.clientId, scope: config.scopes })
    }, transport);
    if (!response.ok) {
      throw new Error(`GitHub Enterprise device code request failed (HTTP ${response.status})`);
    }
    return { ...pickGheDeviceResponse(await response.json()), _gheUrl: binding.gheUrl };
  },
  pollToken: async (config, deviceCode, _codeVerifier, extraData, proxyOptions) => {
    const binding = bind(extraData?._gheUrl, config, proxyOptions);
    let response;
    try {
      response = await gheBoundFetch(binding, gheOAuthTokenUrl(binding.gheUrl), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          client_id: binding.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code"
        })
      }, transport);
    } catch (error) {
      if (error instanceof GheConnectionError) return { ok: false, data: { error: "invalid_response" } };
      throw error;
    }
    return { ok: response.ok, data: decodeCopilotPollResponse(await response.text()) };
  },
  postExchange: async (tokens, proxyOptions, extraData) => {
    const binding = bind(extraData?._gheUrl, null, proxyOptions);
    const [copilotToken, userInfo] = await Promise.all([
    getJson(binding, gheCopilotTokenUrl(binding.gheUrl), tokens.access_token),
    getJson(binding, `${binding.gheUrl}/api/v3/user`, tokens.access_token)]
    );
    return { gheUrl: binding.gheUrl, copilotToken: sessionFromExchange(binding, copilotToken), userInfo: pickGheUserInfo(userInfo) };
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
        copilotApiUrl: endpoints.api,
        copilotProxyUrl: endpoints.proxy,
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
