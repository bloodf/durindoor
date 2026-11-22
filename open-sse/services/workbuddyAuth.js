/**
 * WorkBuddy token refresh. Ported from OmniRoute release/v3.8.55
 * (4265bb2ad5477450a07d3a43ea33a62c6c874878),
 * open-sse/services/tokenRefresh/providers/workbuddy.ts (MIT).
 *
 * Shared by the executor (reactive refresh after a 401) and the token refresh
 * registry (proactive refresh), so both rotate the same way. A failed refresh
 * answers null: the connection is reported as expired and the operator signs
 * in again.
 */
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { clientHeaders } from "../providers/registry/workbuddy.js";

export const WORKBUDDY_REFRESH_URL = "https://www.workbuddy.ai/v2/plugin/auth/token/refresh";

export async function refreshWorkbuddyToken(credentials, _log, proxyOptions = null) {
  if (!credentials?.refreshToken) return null;
  try {
    const response = await proxyAwareFetch(WORKBUDDY_REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...clientHeaders, "X-Refresh-Token": credentials.refreshToken },
      body: "{}",
    }, proxyOptions);
    if (!response.ok) return null;
    const payload = await response.json();
    if (payload.code !== 0 || !payload.data?.accessToken) return null;
    return { accessToken: payload.data.accessToken, refreshToken: payload.data.refreshToken || credentials.refreshToken, expiresIn: payload.data.expiresIn };
  } catch { return null; }
}
