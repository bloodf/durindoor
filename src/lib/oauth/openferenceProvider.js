// Authorization-code PKCE contract adapted from OmniRoute #9869,
// src/lib/oauth/providers/openference.ts and src/lib/oauth/constants/oauth.ts.
import { isString } from "../../shared/utils/typeChecks.js";
import { PROVIDER_OAUTH } from "../../../open-sse/providers/index.js";

const config = PROVIDER_OAUTH.openference;
function clientId(meta) {
  const id = meta?.clientId;
  if (!id) throw new Error("OPENFERENCE_OAUTH_CLIENT_ID is required");
  return id;
}

export default {
  config,
  flowType: "authorization_code_pkce",
  buildAuthUrl: (cfg, redirectUri, state, challenge, meta) => {
    const params = new URLSearchParams({ response_type: "code", client_id: clientId(meta),
      redirect_uri: redirectUri, scope: cfg.scope, state, code_challenge: challenge,
      code_challenge_method: "S256" });
    return `${cfg.authorizeUrl}?${params}`;
  },
  exchangeToken: async (cfg, code, redirectUri, verifier, _state, _meta, proxyOptions) => {
    const id = clientId(_meta);
    const response = await fetch(cfg.tokenUrl, { method: "POST", redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: id, code,
        redirect_uri: redirectUri, code_verifier: verifier }), proxyOptions });
    if (!response.ok) throw new Error(`Openference token exchange failed (${response.status})`);
    const tokens = await response.json();
    if (!isString(tokens.access_token) || !tokens.access_token) throw new Error("Openference returned no access token");
    return { ...tokens, _clientId: id };
  },
  mapTokens: (tokens) => ({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in, providerSpecificData: { clientId: tokens._clientId, scope: tokens.scope || config.scope } }),
};
