import crypto from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";
import { getSettings } from "@/lib/localDb";
import { fetchPublic } from "@/shared/utils/ssrfGuard.js";
import { isString } from "@/shared/utils/typeChecks.js";

export const OIDC_COOKIE_NAMES = {
  state: "oidc_state",
  nonce: "oidc_nonce",
  verifier: "oidc_code_verifier",
};

const DEFAULT_SCOPES = "openid profile email";
const DEFAULT_LOGIN_LABEL = "Sign in with OIDC";

function trimTrailingSlashes(value) {
  return (value || "").trim().replace(/\/+$/, "");
}

function normalizeScopes(value) {
  return (value || DEFAULT_SCOPES).trim() || DEFAULT_SCOPES;
}

export function getPublicOrigin(request) {
  const configuredBaseUrl = process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
  if (configuredBaseUrl) {
    try {
      return new URL(configuredBaseUrl).origin;
    } catch {
      throw new Error("Invalid OIDC public origin configuration");
    }
  }
  return new URL(request.url).origin;
}

export function isOidcConfigured(settings) {
  return !!(
    trimTrailingSlashes(settings?.oidcIssuerUrl) &&
    (settings?.oidcClientId || "").trim() &&
    (settings?.oidcClientSecret || "").trim()
  );
}

/**
 * Auth modes under which OIDC login is offered. "sso" is the OIDC-only value
 * written by 9router installs sharing this data dir; the dashboard here writes
 * "oidc" and "both". Without it an SSO-only install could never start login.
 *
 * @param {string|undefined} authMode Stored `authMode` setting.
 * @returns {boolean}
 */
export function isOidcAuthMode(authMode) {
  return ["sso", "oidc", "both"].includes(authMode);
}

export async function getOidcRuntimeConfig() {
  const settings = await getSettings();
  if (!isOidcAuthMode(settings.authMode) || !isOidcConfigured(settings)) return null;

  const issuerUrl = trimTrailingSlashes(settings.oidcIssuerUrl);
  warnIfOidcAllowlistEmpty(settings);
  return {
    allowlistEmpty: isOidcAllowlistEmpty(settings),
    issuerUrl,
    clientId: settings.oidcClientId.trim(),
    clientSecret: settings.oidcClientSecret.trim(),
    scopes: normalizeScopes(settings.oidcScopes),
    loginLabel: (settings.oidcLoginLabel || DEFAULT_LOGIN_LABEL).trim() || DEFAULT_LOGIN_LABEL,
  };
}

/**
 * Fetch the OIDC discovery document for an issuer.
 * Rejects link-local / private / metadata targets (including hostnames that resolve to
 * them) via fetchPublic, which also re-validates every redirect hop (#2196)
 * (login start, callback, and settings discovery test all share this path).
 *
 * @param {string} issuerUrl Absolute issuer URL (no trailing slash required).
 * @returns {Promise<object>} Parsed openid-configuration JSON.
 */
export async function fetchOidcDiscovery(issuerUrl) {
  const base = trimTrailingSlashes(issuerUrl);
  const discoveryUrl = `${base}/.well-known/openid-configuration`;
  // SSRF guard: block internal/private/metadata issuers and redirects to them.
  const res = await fetchPublic(discoveryUrl, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load OIDC discovery document from ${discoveryUrl}`);
  }
  return await res.json();
}

export function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createOidcState() {
  return crypto.randomBytes(16).toString("base64url");
}

export function createOidcNonce() {
  return crypto.randomBytes(16).toString("base64url");
}

export function buildOidcAuthorizationUrl({
  authorizationEndpoint,
  clientId,
  redirectUri,
  scopes = DEFAULT_SCOPES,
  state,
  nonce,
  codeChallenge,
}) {
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", normalizeScopes(scopes));
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeOidcCode({
  tokenEndpoint,
  clientId,
  clientSecret,
  code,
  redirectUri,
  codeVerifier,
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const res = await fetchPublic(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error_description || data?.error || `OIDC token exchange failed (${res.status})`;
    throw new Error(message);
  }

  return data;
}

export async function probeOidcClientSecret({
  tokenEndpoint,
  clientId,
  clientSecret,
  redirectUri,
}) {
  if (!clientSecret) {
    return {
      tested: false,
      valid: null,
      message: "No client secret was provided, so secret validation was skipped.",
    };
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code: "__oidc_test_invalid_code__",
    redirect_uri: redirectUri,
    code_verifier: "__oidc_test_invalid_verifier__",
  });

  const res = await fetchPublic(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json().catch(() => ({}));
  const error = (data?.error || "").toLowerCase();
  const errorDescription = data?.error_description || data?.error || "";

  if (res.ok) {
    return {
      tested: true,
      valid: true,
      message: "Client secret was accepted by the token endpoint.",
      raw: data,
    };
  }

  if (error === "invalid_client" || error === "unauthorized_client" || /client.*(invalid|failed|mismatch)/i.test(errorDescription)) {
    return {
      tested: true,
      valid: false,
      message: errorDescription || "Client secret is not valid.",
      raw: data,
    };
  }

  if (error === "invalid_grant" || error === "invalid_code" || /grant|code/i.test(errorDescription)) {
    return {
      tested: true,
      valid: true,
      message: "Client secret was accepted; the token exchange failed only because the test authorization code is invalid.",
      raw: data,
    };
  }

  return {
    tested: true,
    valid: null,
    message: errorDescription || `Token endpoint responded with ${res.status}`,
    raw: data,
  };
}

export async function verifyOidcIdToken({
  idToken,
  issuer,
  audience,
  jwksUri,
  nonce,
}) {
  const jwksRes = await fetchPublic(jwksUri, { cache: "no-store" });
  if (!jwksRes.ok) throw new Error(`Failed to load OIDC JWKS (${jwksRes.status})`);
  const jwks = createLocalJWKSet(await jwksRes.json());
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer,
    audience,
    nonce,
  });
  return payload;
}

export function pickOidcDisplayName(payload = {}) {
  return payload.preferred_username || payload.email || payload.name || payload.given_name || payload.sub || "OIDC user";
}

export function pickOidcEmail(payload = {}) {
  return payload.email || "";
}

function normalizeAllowList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  return list.map((item) => String(item || "").trim()).filter(Boolean);
}

/** Normalized OIDC allowlists from settings (#2195). */
export function getOidcAllowlists(settings = {}) {
  return {
    subjects: normalizeAllowList(settings.oidcAllowedSubjects),
    emails: normalizeAllowList(settings.oidcAllowedEmails).map((e) => e.toLowerCase()),
    domains: normalizeAllowList(settings.oidcAllowedDomains).map((d) => d.toLowerCase().replace(/^@/, "")),
  };
}

export function isOidcAllowlistEmpty(settings = {}) {
  const { subjects, emails, domains } = getOidcAllowlists(settings);
  return subjects.length === 0 && emails.length === 0 && domains.length === 0;
}

let warnedEmptyAllowlist = false;
/** Log once per process when OIDC is enabled but no identity is allowlisted. */
export function warnIfOidcAllowlistEmpty(settings = {}) {
  if (warnedEmptyAllowlist) return;
  if (!["oidc", "both"].includes(settings.authMode) || !isOidcAllowlistEmpty(settings)) return;
  warnedEmptyAllowlist = true;
  console.warn("[oidc] OIDC login is enabled but oidcAllowedSubjects, oidcAllowedEmails and oidcAllowedDomains are all empty; " +
    "every OIDC login will be refused until an allowlist is configured.");
}

/**
 * Decide whether a verified id_token identity may become an operator.
 * Subjects match exactly; emails and domains require email_verified === true.
 * Returns { allowed, reason } where reason is a login-page error code.
 */
export function checkOidcIdentityAllowed(payload = {}, settings = {}) {
  const { subjects, emails, domains } = getOidcAllowlists(settings);
  if (subjects.length === 0 && emails.length === 0 && domains.length === 0) {
    return { allowed: false, reason: "oidc_allowlist_empty" };
  }
  const sub = isString(payload.sub) ? payload.sub : "";
  if (sub && subjects.includes(sub)) return { allowed: true, reason: null };
  const email = isString(payload.email) ? payload.email.trim().toLowerCase() : "";
  if (email && payload.email_verified === true) {
    if (emails.includes(email)) return { allowed: true, reason: null };
    const at = email.lastIndexOf("@");
    const domain = at > 0 ? email.slice(at + 1) : "";
    if (domain && domains.includes(domain)) return { allowed: true, reason: null };
  }
  return { allowed: false, reason: "oidc_not_allowed" };
}

/** Compare two issuer URLs ignoring trailing slashes. */
export function isSameOidcIssuer(a, b) {
  const left = trimTrailingSlashes(a);
  return !!left && left === trimTrailingSlashes(b);
}

export function __resetOidcWarningForTests() {
  warnedEmptyAllowlist = false;
}
