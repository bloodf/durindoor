import { isString, isNumber } from "../../../src/shared/utils/typeChecks.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { readBoundedResponseText } from "../../utils/error.js";
import { dedupRefresh } from "./dedup.js";

/** Exchange a Cursor refresh token, retaining it when the response does not rotate it. */
export async function refreshCursorToken(token, log, proxyOptions = null) {
  if (!token) return null;
  return dedupRefresh("cursor", token, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const signal = AbortSignal.timeout(15000);
        const response = await proxyAwareFetch("https://api2.cursor.sh/auth/exchange_user_api_key", {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: "{}", redirect: "error", signal,
        }, proxyOptions);
        if (response.ok) {
          const text = await readBoundedResponseText(response, { signal, throwOnTimeout: true });
          if (!text) return null;
          const data = JSON.parse(text);
          if (!isString(data?.accessToken) || !data.accessToken) return null;
          let expiry = Date.now() + 3600000;
          try {
            const payload = JSON.parse(Buffer.from(data.accessToken.split(".")[1], "base64url").toString());
            if (isNumber(payload.exp) && Number.isFinite(payload.exp)) expiry = payload.exp * 1000;
          } catch { /* opaque access token */ }
          return { accessToken: data.accessToken, refreshToken: isString(data.refreshToken) && data.refreshToken ? data.refreshToken : token, expiresAt: new Date(expiry).toJSON() ?? new Date(Date.now() + 3600000).toISOString() };
        }
        void response.body?.cancel().catch(() => {});
        if (response.status === 401 || response.status === 403) return { error: "unrecoverable_refresh_error", code: "unauthorized" };
        if (![429, 500, 502, 503, 504].includes(response.status)) return null;
      } catch { /* retry transient failures */ }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, Math.floor(300 * 2 ** attempt * (0.8 + Math.random() * 0.4))));
    }
    log?.error?.("TOKEN_REFRESH", "Cursor token refresh failed");
    return null;
  }, log, proxyOptions);
}
