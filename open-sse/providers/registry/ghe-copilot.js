import github from "./github.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";

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

// GitHub Enterprise Copilot. Same wire protocol and model catalog as `github`,
// but every host comes from the connection: the GHE web host the user typed
// (providerSpecificData.gheUrl) for OAuth, and the Copilot API host returned by
// the token exchange (copilotApiUrl) for chat. The transport URLs below are
// static placeholders; GheCopilotExecutor resolves the real ones per request.
export default {
  id: "ghe-copilot",
  priority: 41,
  alias: "ghe",
  uiAlias: "ghe",
  display: {
    name: "GitHub Enterprise Copilot",
    icon: "code",
    color: "#10B981",
    website: "https://docs.github.com/en/enterprise-cloud@latest/copilot",
    notice: {
      text: "Enter your GitHub Enterprise URL (for example https://ghe.company.com), then sign in with the device code.",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: github.transport.baseUrl,
    responsesUrl: github.transport.responsesUrl,
    messagesUrl: github.transport.messagesUrl,
    headers: github.transport.headers,
    copilot: github.transport.copilot,
    quirks: github.transport.quirks,
  },
  models: github.models.filter((model) => model.kind !== "embedding"),
  serviceKinds: ["llm"],
  oauth: {
    // GitHub's Copilot OAuth app. Self-hosted GHES instances that do not carry
    // it can override with GHE_COPILOT_OAUTH_CLIENT_ID.
    clientId: github.oauth.clientId,
    scopes: github.oauth.scopes,
    apiVersion: github.oauth.apiVersion,
    userAgent: github.oauth.userAgent,
  },
};
