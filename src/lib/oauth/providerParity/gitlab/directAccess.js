// GitLab Duo direct-access contract.
// Ported from OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523 (MIT):
// src/lib/oauth/gitlab.ts and open-sse/executors/gitlab.ts. The exchange path,
// gateway URL shape, `expires_at` seconds and 60-second validity margin follow
// that source. The checks on gateway URL, header names and cache binding are
// DurinDoor's own narrowing. Web-safe: no Node-only imports.
import { isNumber, isRecord, isString } from "../../../../shared/utils/typeChecks.js";

/** OmniRoute getCachedGitLabDirectAccess minValidityMs. */
export const GITLAB_DIRECT_ACCESS_MIN_VALIDITY_MS = 60_000;

const GATEWAY_HEADER_NAME = /^x-gitlab-[a-z0-9-]{1,64}$/i;
const MAX_GATEWAY_HEADERS = 32;
const MAX_HEADER_VALUE_LENGTH = 4096;
const MAX_TOKEN_LENGTH = 8192;
const HEADER_UNSAFE = /[\r\n\0]/;

function parseUrl(value) {
  if (!isString(value) || !value.trim()) return null;
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

/** Canonical instance root, or null when the URL could carry credentials or extra parts. */
export function normalizeGitLabRoot(value) {
  const url = parseUrl(value);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function gitlabDirectAccessUrl(root) {
  return `${root}/api/v4/code_suggestions/direct_access`;
}

/** Gateway completions URL, as OmniRoute buildGitLabDirectGatewayUrl derives it. */
export function buildGitLabDirectGatewayUrl(baseUrl) {
  const normalized = String(baseUrl).replace(/\/$/, "");
  if (normalized.endsWith("/ai/v2/completions")) return normalized;
  if (normalized.endsWith("/ai/v2")) return `${normalized}/completions`;
  return `${normalized}/ai/v2/completions`;
}

/** A bearer-carrying gateway must be https and must not embed credentials. */
function normalizeGatewayBase(value) {
  const url = parseUrl(value);
  if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function normalizeToken(value) {
  if (!isString(value)) return null;
  const token = value.trim();
  if (!token || token.length > MAX_TOKEN_LENGTH || /\s/.test(token) || HEADER_UNSAFE.test(token)) return null;
  return token;
}

/** Only GitLab routing headers; they cannot replace Authorization or content headers. */
function normalizeGatewayHeaders(value) {
  const headers = {};
  if (!isRecord(value)) return headers;
  for (const [name, headerValue] of Object.entries(value)) {
    if (Object.keys(headers).length >= MAX_GATEWAY_HEADERS) break;
    if (!GATEWAY_HEADER_NAME.test(name) || !isString(headerValue)) continue;
    if (headerValue.length > MAX_HEADER_VALUE_LENGTH || HEADER_UNSAFE.test(headerValue)) continue;
    headers[name] = headerValue;
  }
  return headers;
}

/**
 * Parse a `direct_access` response from the instance at `issuer`. Returns the
 * entry to use, or null when the answer is unusable. `expires_at` is seconds.
 */
export function parseGitLabDirectAccess(payload, issuer) {
  if (!isRecord(payload) || !issuer) return null;
  const token = normalizeToken(payload.token);
  const baseUrl = normalizeGatewayBase(payload.base_url);
  if (!token || !baseUrl) return null;
  const expiresAt = isNumber(payload.expires_at) && Number.isFinite(payload.expires_at) ?
    new Date(payload.expires_at * 1000).toISOString() : null;
  return { token, baseUrl, expiresAt, headers: normalizeGatewayHeaders(payload.headers), issuer };
}

/**
 * Whether an entry may be stored on the connection. An entry without an expiry
 * is used once and never stored.
 */
export function isCacheableGitLabDirectAccess(entry, now = Date.now()) {
  if (!entry?.expiresAt) return false;
  const expiresAtMs = Date.parse(entry.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > now + GITLAB_DIRECT_ACCESS_MIN_VALIDITY_MS;
}

/**
 * A stored entry, revalidated, for the connection's current instance only.
 * Reads `providerSpecificData.gitlabDirectAccess`, the field OmniRoute writes.
 */
export function readCachedGitLabDirectAccess(providerSpecificData, issuer, now = Date.now()) {
  const stored = isRecord(providerSpecificData) ? providerSpecificData.gitlabDirectAccess : null;
  if (!isRecord(stored) || !issuer || stored.issuer !== issuer) return null;
  const token = normalizeToken(stored.token);
  const baseUrl = normalizeGatewayBase(stored.baseUrl);
  if (!token || !baseUrl) return null;
  const entry = { token, baseUrl, expiresAt: stored.expiresAt, headers: normalizeGatewayHeaders(stored.headers), issuer };
  return isCacheableGitLabDirectAccess(entry, now) ? entry : null;
}

export function buildGitLabDirectHeaders(entry) {
  return {
    ...entry.headers,
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${entry.token}`
  };
}

/** OmniRoute shouldFallbackToPublicCodeSuggestions: a rejected exchange or gateway auth. */
export function isGitLabDirectAccessRejection(status) {
  return status === 401 || status === 403;
}

/** Provider responses are untrusted and are never echoed into client errors. */
export function gitlabRequestError(status) {
  if (status === 401 || status === 403) {
    return { error: { message: "GitLab Duo authentication failed", type: "authentication_error" } };
  }
  if (status === 429) {
    return { error: { message: "GitLab Duo rate limited the request", type: "rate_limit_error" } };
  }
  return { error: { message: "GitLab Duo request failed", type: "api_error" } };
}
