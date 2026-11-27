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
import { isDeepStrictEqual } from "node:util";
import { PROVIDER_OAUTH } from "../../../open-sse/providers/index.js";
import { GITHUB_COPILOT } from "../../../open-sse/config/appConstants.js";
import { gheCopilotTokenUrl, gheOAuthTokenUrl, normalizeGheUrl } from "../../../open-sse/config/gheCopilot.js";
import { decodeCopilotPollResponse } from "./providerParity/copilot/index.js";
import {
  GheConnectionError,
  bindGheConnection,
  gheBoundFetch,
  globalFetchTransport,
  pickGheDeviceResponse,
  pickGheUserInfo,
  trustedGheEndpoints,
  gheTokenHash,
  decodeGheSessionToken
} from "./providerParity/copilot/gheConnection.js";
import { gheCopilotClientId } from "../../../open-sse/services/gheCopilotAuth.js";
import { isRecord } from "../../shared/utils/typeChecks.js";

const GHE_OAUTH = PROVIDER_OAUTH["ghe-copilot"] || {};
/** Non-enumerable, in-process carrier of the poll's issuer/client/proxy. */
const GHE_SIGNIN_BINDING = Symbol("gheSignInBinding");
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
  const session = decodeGheSessionToken(binding, data);
  if (!session) return {};
  return { token: session.token, expires_at: session.expiresAt, endpoints: trustedGheEndpoints(binding, data.endpoints) };
}

const gheCopilot = {
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
    const data = decodeCopilotPollResponse(await response.text());
    // The issuing identity rides with this token, in process only, to postExchange.
    if (isRecord(data) && data.access_token) {
      Object.defineProperty(data, GHE_SIGNIN_BINDING, {
        value: Object.freeze({ issuer: binding.gheUrl, clientId: binding.clientId, proxyOptions: binding.proxyOptions ? { ...binding.proxyOptions } : null })
      });
    }
    return { ok: response.ok, data };
  },
  postExchange: async (tokens, proxyOptions, extraData) => {
    const saved = tokens?.[GHE_SIGNIN_BINDING];
    if (saved && (saved.issuer !== normalizeGheUrl(extraData?._gheUrl) || !isDeepStrictEqual(saved.proxyOptions || null, proxyOptions || null))) {
      throw new GheConnectionError("reauthentication_needed", "GitHub Enterprise sign-in identity or proxy changed; restart sign-in");
    }
    const binding = bind(extraData?._gheUrl, saved, proxyOptions);
    const [copilotToken, userInfo] = await Promise.all([
    getJson(binding, gheCopilotTokenUrl(binding.gheUrl), tokens.access_token),
    getJson(binding, `${binding.gheUrl}/api/v3/user`, tokens.access_token)]
    );
    let session = sessionFromExchange(binding, copilotToken);
    let kind = "session";
    if (!session.token && !copilotToken.token && !copilotToken.endpoints?.api && binding.host.endsWith(".ghe.com")) {
      // OmniRoute's GHE.com fallback uses OAuth, not a minted session token.
      // Only its issuer may receive that credential; no sibling-domain guess.
      const user = await getJson(binding, `${binding.gheUrl}/api/v3/copilot_internal/user`, tokens.access_token);
      const api = user.endpoints?.api;
      if (!trustedGheEndpoints(binding, { api }).api || new URL(api).origin !== binding.gheUrl) {
        throw new GheConnectionError("unsupported_ghe_oauth_peer", "GHE.com returned no session credential: cross-origin OAuth fallback is unsupported; no safe peer credential contract in pinned sources");
      }
      session = { token: tokens.access_token, expires_at: Math.floor(Date.now() / 1000) + Math.min(Number(tokens.expires_in) || 3600, 3600), endpoints: { api } };
      kind = "issuer-oauth";
    }
    if (!session.token) throw new GheConnectionError("reauthentication_needed", "GitHub Enterprise reauthentication needed: exchange returned no valid unexpired scoped credential");
    if (kind === "session" && session.token === tokens.access_token) throw new GheConnectionError("oauth_forwarding_refused", "Session exchange returned the OAuth credential instead of a scoped token");
    return {
      gheUrl: binding.gheUrl, gheBinding: saved ? { ...saved } : undefined,
      gheSession: session.token ? {
        issuer: binding.gheUrl, clientId: binding.clientId,
        apiOrigin: new URL(session.endpoints?.api || binding.gheUrl).origin,
        kind, tokenHash: gheTokenHash(session.token)
      } : undefined,
      copilotToken: session, userInfo: pickGheUserInfo(userInfo)
    };
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
        ...(extra?.gheBinding ? { gheBinding: extra.gheBinding, gheSession: extra.gheSession } : null),
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

export default gheCopilot;
