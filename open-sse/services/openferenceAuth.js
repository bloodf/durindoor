import { isString } from "../../src/shared/utils/typeChecks.js";
import { PROVIDER_OAUTH } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { dedupRefresh } from "./tokenRefresh/dedup.js";

// A refresh belongs to its original client and egress route. Never fall back to
// another client's identifier when rotating an existing connection.
export async function refreshOpenferenceToken(credentials, log, proxyOptions = null) {
  const token = credentials?.refreshToken;
  const clientId = credentials?.providerSpecificData?.clientId;
  if (!token || !clientId) return null;
  return dedupRefresh(`openference:${clientId}`, token, async () => {
    try {
      const response = await proxyAwareFetch(PROVIDER_OAUTH.openference.tokenUrl, {
        method: "POST", redirect: "error", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token, client_id: clientId })
      }, proxyOptions);
      if (!response.ok) return null;
      const data = await response.json();
      if (!isString(data.access_token) || !data.access_token) return null;
      return { accessToken: data.access_token, refreshToken: data.refresh_token || token, expiresIn: data.expires_in };
    } catch {
      log?.warn?.("TOKEN_REFRESH", "Openference refresh failed");
      return null;
    }
  }, log, proxyOptions);
}
