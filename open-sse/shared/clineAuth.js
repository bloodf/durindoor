import pkg from "../../package.json" with { type: "json" };
import { isString } from "../../src/shared/utils/typeChecks.js";

const APP_VERSION = pkg.version || "0.0.0";

/**
 * Normalize a Cline/ClinePass bearer credential.
 *
 * Cline OAuth access tokens are WorkOS JWTs and the API only accepts them with
 * a `workos:` prefix. ClinePass API keys (`clp_…`) are opaque strings the API
 * accepts verbatim — prefixing them yields HTTP 401 ("re-authenticate your
 * Cline account"). So only JWT-shaped tokens get the prefix, and an existing
 * prefix is never doubled.
 *
 * Ported from decolua/9router f6e7cabe.
 *
 * @param {unknown} token Raw access token or API key.
 * @returns {string} Wire-ready token, or "" when unusable.
 */
export function getClineAccessToken(token) {
  if (!isString(token)) return "";
  const trimmed = token.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("workos:")) return trimmed;
  const isWorkOsJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(trimmed);
  return isWorkOsJwt ? `workos:${trimmed}` : trimmed;
}

export function getClineAuthorizationHeader(token) {
  const accessToken = getClineAccessToken(token);
  return accessToken ? `Bearer ${accessToken}` : "";
}

export function buildClineHeaders(token, extraHeaders = {}) {
  const authorization = getClineAuthorizationHeader(token);
  const headers = {
    "HTTP-Referer": "https://cline.bot",
    "X-Title": "Cline",
    "User-Agent": `9Router/${APP_VERSION}`,
    "X-PLATFORM": process.platform || "unknown",
    "X-PLATFORM-VERSION": process.version || "unknown",
    "X-CLIENT-TYPE": "9router",
    "X-CLIENT-VERSION": APP_VERSION,
    "X-CORE-VERSION": APP_VERSION,
    "X-IS-MULTIROOT": "false",
    ...extraHeaders
  };

  if (authorization) {
    headers.Authorization = authorization;
  }

  return headers;
}