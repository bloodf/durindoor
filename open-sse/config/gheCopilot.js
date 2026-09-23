/**
 * GitHub Enterprise Copilot (`ghe-copilot`) host helpers.
 *
 * A GHE Copilot connection targets the enterprise host the user typed at
 * connect time (`providerSpecificData.gheUrl`). The device login, OAuth token,
 * user and Copilot-token endpoints all live on that host. The Copilot token
 * response then names the chat host in `endpoints.api` (stored as
 * `copilotApiUrl`); `endpoints.proxy` (`copilotProxyUrl`) only serves
 * completions/NES and is kept as a legacy fallback.
 */
import { isString } from "../../src/shared/utils/typeChecks.js";

/**
 * Validate and normalize a GHE instance URL to its origin.
 * Only https is accepted, so an OAuth token is never sent in clear text.
 * @param {unknown} value
 * @returns {string|null} origin without trailing slash, or null when invalid
 */
export function normalizeGheUrl(value) {
  if (!isString(value) || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  return url.origin;
}

/**
 * Copilot API base (no trailing endpoint path) for a GHE connection:
 * endpoints.api, then endpoints.proxy, then the GHE web host.
 * @param {object|null|undefined} providerSpecificData
 * @returns {string|null}
 */
export function resolveGheCopilotApiBase(providerSpecificData) {
  const psd = providerSpecificData || {};
  for (const candidate of [psd.copilotApiUrl, psd.copilotProxyUrl, psd.gheUrl]) {
    const origin = normalizeGheUrl(candidate);
    if (!origin) continue;
    // Keep any path prefix the token endpoint returned, minus a trailing endpoint.
    const path = new URL(candidate.trim()).pathname
      .replace(/\/(v1\/messages|chat\/completions|responses)\/?$/, "")
      .replace(/\/+$/, "");
    return `${origin}${path}`;
  }
  return null;
}

/** Copilot token exchange URL on a GHE host. */
export function gheCopilotTokenUrl(gheUrl) {
  return `${gheUrl}/api/v3/copilot_internal/v2/token`;
}

/** OAuth access-token URL on a GHE host (device poll and refresh grant). */
export function gheOAuthTokenUrl(gheUrl) {
  return `${gheUrl}/login/oauth/access_token`;
}
