import { isString } from "../../shared/utils/typeChecks.js";

/**
 * Static browser headers the www.kimi.com web app sends on its model-discovery
 * and chat endpoints. Shared by the model-discovery route (modelsConfig.js) and
 * the connection-validation probe (providerProbe.js) so both present the same
 * web-app fingerprint; Kimi accepts some valid cookies only with this set.
 * Auth (`Authorization` / `Cookie`) is added per-request, not here.
 */
export const KIMI_WEB_DISCOVERY_HEADERS = {
  accept: "*/*",
  "Content-Type": "application/json",
  "connect-protocol-version": "1",
  Origin: "https://www.kimi.com",
  Referer: "https://www.kimi.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
};

/**
 * Cookie / session helpers for web-session providers.
 *
 * All functions are fail-open: invalid/missing input returns an empty string.
 */

/**
 * Strip accidental prefixes from pasted credential blobs.
 * @param {string} rawValue
 * @returns {string}
 */
export function stripCookieInputPrefix(rawValue) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) return "";

  const withoutBearer = trimmed.replace(/^bearer\s+/i, "");
  return withoutBearer.replace(/^cookie:/i, "").trim();
}

/**
 * Extract the value of a single named cookie from a pasted blob.
 * Handles bare values, single pairs, and full DevTools cookie strings.
 * @param {string} rawValue
 * @param {string} cookieName
 * @returns {string}
 */
export function extractCookieValue(rawValue, cookieName) {
  const trimmed = stripCookieInputPrefix(rawValue);
  if (!trimmed) return "";

  if (trimmed.includes(";")) {
    const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = trimmed.match(new RegExp("(?:^|;\\s*)" + escaped + "=([^;\\s]+)"));
    return match ? match[1] : "";
  }

  const prefix = `${cookieName}=`;
  if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);

  return "";
}

const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * Kimi runs two web deployments, each with its own auth host: www.kimi.com
 * (auth.kimi.com) and the international www.kimi.ai (auth.kimi.ai). Requests
 * go back to the deployment that issued the session. The first entry is the default
 * for pastes that do not say where they came from (every legacy `kimi-auth`
 * cookie was captured on www.kimi.com).
 */
export const KIMI_WEB_ORIGINS = ["https://www.kimi.com", "https://www.kimi.ai"];

/**
 * Pull the Kimi Web session tokens out of whatever the user pasted for the
 * international Kimi consumer chat (www.kimi.com).
 *
 * Accepts:
 *   - JSON `{"access_token":"...","refresh_token":"...","origin":"https://www.kimi.ai"}`
 *     (the registry `authSnippet`; `origin` is kept only if it is a known Kimi host)
 *   - bare access-token JWT, optionally JSON-quoted
 *   - `access_token=...; refresh_token=...` pairs
 *   - legacy full Cookie header (`_ga=...; kimi-auth=eyJ...; theme=dark`)
 *   - `Cookie:` / `Authorization: Bearer` prefixed forms
 *
 * Missing parts come back as "".
 * @param {string} rawValue
 * @returns {{ accessToken: string, refreshToken: string, origin: string }}
 */
export function extractKimiTokens(rawValue) {
  const raw = (rawValue || "").trim();
  if (raw.startsWith("{") || raw.startsWith("\"")) {
    try {
      const parsed = JSON.parse(raw);
      if (isString(parsed)) return extractKimiTokens(parsed);
      const pick = (v) => isString(v) ? v.trim() : "";
      const origin = pick(parsed?.origin).replace(/\/+$/, "");
      return {
        accessToken: pick(parsed?.access_token) || pick(parsed?.accessToken),
        refreshToken: pick(parsed?.refresh_token) || pick(parsed?.refreshToken),
        origin: KIMI_WEB_ORIGINS.includes(origin) ? origin : "",
      };
    } catch {
      return { accessToken: "", refreshToken: "", origin: "" };
    }
  }

  const trimmed = stripCookieInputPrefix(raw);
  const pair = (name) => trimmed.match(new RegExp(`(?:^|[\\s;])${name}=([^;\\s]+)`))?.[1] || "";
  const bearer = trimmed.match(/bearer\s+(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i)?.[1];
  const accessToken =
    (JWT_RE.test(trimmed) ? trimmed : "") ||
    pair("access_token") ||
    pair("kimi-auth") ||
    bearer ||
    "";
  return { accessToken, refreshToken: pair("refresh_token"), origin: "" };
}

/**
 * Kimi web origin a pasted credential belongs to.
 * @param {string} rawValue
 * @returns {string}
 */
export function kimiWebOrigin(rawValue) {
  return extractKimiTokens(rawValue).origin || KIMI_WEB_ORIGINS[0];
}

/**
 * Access token only — see `extractKimiTokens` for the accepted input forms.
 * Returns "" if no token can be located.
 * @param {string} rawValue
 * @returns {string}
 */
export function extractKimiJwt(rawValue) {
  return extractKimiTokens(rawValue).accessToken;
}
