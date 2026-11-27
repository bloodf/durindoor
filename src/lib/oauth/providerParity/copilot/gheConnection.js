/**
 * GitHub Enterprise Copilot connection binding (#2034).
 *
 * One GHE connection owns one enterprise origin (`gheUrl`), one OAuth client id
 * and one proxy selection. Every request built for that connection (device
 * login, refresh, discovery and inference) must stay on origins that the
 * connection trusts, must not follow redirects, and must use that connection's
 * proxy. This module is that boundary; it reuses the existing host
 * normalization, provider outbound guard and proxy transport rather than adding
 * a separate network policy.
 *
 * Sources (MIT):
 * - CLIProxyAPI dbe641f286a489ecb39e3c041c554371e6add864
 *   internal/auth/copilot/client.go: `TrustedAPI` host allowlist, refused
 *   redirects, and rejection of missing or already-expired session tokens.
 * - OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523
 *   src/lib/oauth/providers/ghe-copilot.ts: every request built from `gheUrl`
 *   goes through the provider outbound guard with a metadata-block floor and
 *   refuses redirects; device responses are reduced to the fields the flow uses.
 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { GITHUB_COPILOT } from "../../../../../open-sse/config/appConstants.js";
import {
  gheCopilotTokenUrl,
  gheOAuthTokenUrl,
  normalizeGheUrl,
  resolveGheCopilotApiBase
} from "../../../../../open-sse/config/gheCopilot.js";
import { gheCopilotClientId } from "../../../../../open-sse/services/gheCopilotAuth.js";
import {
  OutboundUrlGuardError,
  assertOutboundUrlAllowed,
  createGuardedProbeDispatcher,
  getProviderValidationGuard
} from "../../../../../open-sse/utils/outboundUrlGuard.js";
import { proxyAwareFetch } from "../../../../../open-sse/utils/proxyFetch.js";
import { isNumber, isRecord, isString } from "../../../../shared/utils/typeChecks.js";

/** GitHub-operated Copilot API hosts (CLIProxyAPI `TrustedAPI`). */
export const GITHUB_COPILOT_PUBLIC_API_HOSTS = Object.freeze([
  "api.githubcopilot.com",
  "api.individual.githubcopilot.com",
  "api.business.githubcopilot.com",
  "api.enterprise.githubcopilot.com"
]);

const PROXY_REFUSES_GUARDED_DISPATCHER = "Guarded provider probe cannot use an outbound proxy";

export class GheConnectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GheConnectionError";
    this.code = code;
  }
}

/**
 * Freeze the identity of one GHE connection or flow.
 * @param {{gheUrl: unknown, proxyOptions?: object|null, clientId?: string}} input
 * @returns {Readonly<{gheUrl: string, host: string, proxyOptions: object|null, clientId: string|undefined}>}
 */
export function bindGheConnection({ gheUrl, proxyOptions = null, clientId = gheCopilotClientId() } = {}) {
  const origin = normalizeGheUrl(gheUrl);
  if (!origin) throw new GheConnectionError("invalid_host", "A valid https GitHub Enterprise URL is required");
  return Object.freeze({ gheUrl: origin, host: new URL(origin).hostname, proxyOptions: proxyOptions || null, clientId });
}

/**
 * Whether a token-supplied endpoint may receive this connection's credentials:
 * the enterprise host itself, one of its subdomains (GHE.com data residency
 * returns `copilot-api.<tenant>.ghe.com`), or a GitHub-operated Copilot API host.
 */
export function isTrustedGheEndpoint(binding, value) {
  if (!binding || !isString(value) || !normalizeGheUrl(value)) return false;
  const url = new URL(value.trim());
  if (url.search || url.hash || url.port) return false;
  if (url.pathname !== "/") return false;
  const host = url.hostname;
  return host === binding.host || host.endsWith(`.${binding.host}`) ||
    GITHUB_COPILOT_PUBLIC_API_HOSTS.includes(host);
}

/** Keep only trusted `endpoints.api` / `endpoints.proxy` values from a session exchange. */
export function trustedGheEndpoints(binding, endpoints) {
  const result = {};
  if (!isRecord(endpoints)) return result;
  if (isTrustedGheEndpoint(binding, endpoints.api)) result.api = endpoints.api.trim();
  if (isTrustedGheEndpoint(binding, endpoints.proxy)) result.proxy = endpoints.proxy.trim();
  return result;
}

/**
 * Inference/discovery base for a stored connection. Untrusted stored
 * endpoints are skipped, falling back to the enterprise host.
 * @returns {string|null}
 */
export function resolveBoundGheApiBase(providerSpecificData) {
  const psd = providerSpecificData || {};
  let binding;
  try {
    binding = bindGheConnection({ gheUrl: psd.gheUrl });
  } catch {
    return null;
  }
  return resolveGheCopilotApiBase({
    gheUrl: binding.gheUrl,
    copilotApiUrl: isTrustedGheEndpoint(binding, psd.copilotApiUrl) ? psd.copilotApiUrl : undefined,
    copilotProxyUrl: isTrustedGheEndpoint(binding, psd.copilotProxyUrl) ? psd.copilotProxyUrl : undefined
  });
}

/** Resolve identity from durable connection metadata, never the current process client. */
export function storedGheBinding(credentials, proxyOptions = null, { refresh = false } = {}) {
  const data = credentials?.providerSpecificData || {};
  const identity = data.gheBinding;
  // gheUrl is the historical field written by this provider and OmniRoute.
  // API/proxy URLs alone cannot establish an OAuth issuer.
  const issuer = identity?.issuer || data.gheUrl;
  if (!normalizeGheUrl(issuer)) throw new GheConnectionError("reauthentication_needed", "GitHub Enterprise reauthentication needed: OAuth issuer is missing");
  if (identity && normalizeGheUrl(data.gheUrl) !== identity.issuer) {
    throw new GheConnectionError("reauthentication_needed", "GitHub Enterprise reauthentication needed: issuer binding mismatch");
  }
  // Rows written before the binding existed were issued by the configured
  // provider client (OmniRoute and this provider use the same configured id).
  const clientId = identity ? identity.clientId : (data.oauthClientId || gheCopilotClientId());
  if ((refresh || identity) && (!isString(clientId) || !clientId.trim())) throw new GheConnectionError("reauthentication_needed", "GitHub Enterprise reauthentication needed: issuing OAuth client is unknown");
  const selectedProxy = identity ? identity.proxyOptions : proxyOptions;
  if (identity && !isDeepStrictEqual(selectedProxy || null, proxyOptions || null)) {
    throw new GheConnectionError("reauthentication_needed", "GitHub Enterprise reauthentication needed: selected proxy differs from sign-in");
  }
  return bindGheConnection({ gheUrl: issuer, clientId: clientId || null, proxyOptions: selectedProxy });
}

/** Credential digest binds provenance without storing a second credential. */
export const gheTokenHash = (token) => createHash("sha256").update(token).digest("hex");

/** Preflight all inference routes before any quota lookup or provider transport. */
export function gheRequestContext(credentials, proxyOptions = null, nowMs = Date.now()) {
  const binding = storedGheBinding(credentials, proxyOptions);
  const data = credentials.providerSpecificData;
  const token = credentials.copilotToken || data.copilotToken;
  const expiry = credentials.copilotTokenExpiresAt ?? data.copilotTokenExpiresAt;
  // Historical rows may lack an expiry; a stated one must still be in the future.
  if (!isString(token) || !token || (expiry != null && (!Number.isFinite(expiry) || expiry <= nowMs / 1000))) {
    throw new GheConnectionError("reauthentication_needed", "GitHub Enterprise reauthentication needed: a valid session credential is required");
  }
  const stated = data.copilotApiUrl;
  const trusted = Boolean(stated) && isTrustedGheEndpoint(binding, stated);
  // A bound row never had untrusted metadata written by sign-in; a mismatch is forgery.
  if (data.gheBinding && stated && !trusted) {
    throw new GheConnectionError("untrusted_api", "GitHub Enterprise API endpoint is untrusted; refusing host substitution");
  }
  // Without a trusted API endpoint the enterprise issuer itself serves the API.
  const base = trusted ? resolveGheCopilotApiBase({ copilotApiUrl: stated }) : resolveBoundGheApiBase({ gheUrl: binding.gheUrl });
  const api = new URL(base).origin;
  const provenance = data.gheSession;
  if (data.gheBinding && (!provenance || !["session", "issuer-oauth"].includes(provenance.kind) || provenance.issuer !== binding.gheUrl || provenance.clientId !== binding.clientId || provenance.apiOrigin !== api || provenance.tokenHash !== gheTokenHash(token))) {
    throw new GheConnectionError("reauthentication_needed", "GitHub Enterprise reauthentication needed: session provenance mismatch");
  }
  if (token === credentials.accessToken && !(provenance?.kind === "issuer-oauth" && api === binding.gheUrl)) {
    throw new GheConnectionError("oauth_forwarding_refused", "Refusing to forward GitHub Enterprise OAuth credentials to an API peer");
  }
  const policy = getProviderValidationGuard();
  assertOutboundUrlAllowed(base, policy === "none" ? "block-metadata" : policy);
  return { binding, token, base };
}

const guardedDispatchers = new Map();
function guardedDispatcher(guard) {
  if (!guardedDispatchers.has(guard)) guardedDispatchers.set(guard, createGuardedProbeDispatcher(guard));
  return guardedDispatchers.get(guard);
}

/** Proxy transport (refresh/discovery) — the default. */
export const proxyTransport = (url, init, proxyOptions) => proxyAwareFetch(url, init, proxyOptions);
/** Patched global fetch (web OAuth adapters), which reads `proxyOptions` from init. */
export const globalFetchTransport = (url, init, proxyOptions) => globalThis.fetch(url, { ...init, proxyOptions });

async function drain(response) {
  try { await response.body?.cancel?.(); } catch { /* best effort */ }
}

/**
 * Send one request for a bound connection. The URL must be the enterprise
 * origin or a trusted endpoint; the provider outbound guard applies with a
 * metadata-block floor; redirects are refused; the connection's proxy is used.
 * When no proxy routes the request, connection-time DNS answers are validated
 * by the shared guarded dispatcher; a proxy resolves the target itself.
 */
export async function gheBoundFetch(binding, url, init = {}, { transport = proxyTransport } = {}) {
  if (!binding?.gheUrl) throw new GheConnectionError("invalid_host", "GitHub Enterprise connection is not bound");
  const target = String(url);
  if (new URL(target).origin !== binding.gheUrl && !isTrustedGheEndpoint(binding, new URL(target).origin)) {
    throw new GheConnectionError("foreign_origin", "Refusing to send GitHub Enterprise credentials to another origin");
  }
  init.signal?.throwIfAborted();
  const policy = getProviderValidationGuard();
  const guard = policy === "none" ? "block-metadata" : policy;
  assertOutboundUrlAllowed(target, guard);
  const request = { ...init, redirect: init.redirect === "error" ? "error" : "manual" };
  let response;
  try {
    response = await transport(target, { ...request, dispatcher: guardedDispatcher(guard) }, binding.proxyOptions);
  } catch (error) {
    if (!(error instanceof OutboundUrlGuardError) || error.message !== PROXY_REFUSES_GUARDED_DISPATCHER) throw error;
    response = await transport(target, request, binding.proxyOptions);
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    await drain(response);
    throw new GheConnectionError("redirect_refused", `GitHub Enterprise redirect refused (HTTP ${response.status})`);
  }
  return response;
}

const DEVICE_STRING_FIELDS = ["device_code", "user_code", "verification_uri", "verification_uri_complete"];
const DEVICE_NUMBER_FIELDS = ["expires_in", "interval"];
const USER_STRING_FIELDS = ["login", "name", "email"];

function pick(source, strings, numbers = []) {
  const picked = {};
  if (!isRecord(source)) return picked;
  for (const key of strings) if (isString(source[key])) picked[key] = source[key];
  for (const key of numbers) if (isNumber(source[key])) picked[key] = source[key];
  return picked;
}

/** Device authorization fields the web flow uses (OmniRoute `pickFields`). */
export const pickGheDeviceResponse = (data) => pick(data, DEVICE_STRING_FIELDS, DEVICE_NUMBER_FIELDS);
/** Account fields the connection stores. */
export const pickGheUserInfo = (data) => pick(data, USER_STRING_FIELDS, ["id"]);

/**
 * Decode a Copilot session exchange. Missing tokens and stated-but-past expiries
 * are rejected (CLIProxyAPI `Exchange`); endpoints are filtered for trust.
 * @returns {{token: string, expiresAt: number, apiUrl?: string, proxyUrl?: string}|null}
 */
export function decodeGheSessionToken(binding, data, nowMs = Date.now()) {
  if (!isRecord(data) || !isString(data.token) || !data.token) return null;
  // Absent expiry is accepted (historical exchanges); a stated one must be a future number.
  if (data.expires_at != null && (!isNumber(data.expires_at) || !Number.isFinite(data.expires_at) || data.expires_at <= nowMs / 1000)) return null;
  const endpoints = trustedGheEndpoints(binding, data.endpoints);
  return {
    token: data.token,
    ...(data.expires_at != null ? { expiresAt: data.expires_at } : null),
    ...(endpoints.api ? { apiUrl: endpoints.api } : null),
    ...(endpoints.proxy ? { proxyUrl: endpoints.proxy } : null)
  };
}

function sessionHeaders(oauthToken) {
  return {
    Authorization: `token ${oauthToken}`,
    "User-Agent": GITHUB_COPILOT.USER_AGENT,
    "Editor-Version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
    "Editor-Plugin-Version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
    Accept: "application/json",
    "x-github-api-version": GITHUB_COPILOT.API_VERSION
  };
}

async function readJson(response) {
  try { return await response.json(); } catch { return null; }
}

/** Mint a Copilot session token on the bound enterprise host. */
export async function mintBoundGheSession(binding, oauthToken, { signal, transport, now = Date.now } = {}) {
  if (!oauthToken) return null;
  const response = await gheBoundFetch(binding, gheCopilotTokenUrl(binding.gheUrl),
    { headers: sessionHeaders(oauthToken), signal }, { transport });
  if (response.status === 404 && binding.host.endsWith(".ghe.com")) {
    await drain(response);
    const fallback = await gheBoundFetch(binding, `${binding.gheUrl}/api/v3/copilot_internal/user`,
      { headers: sessionHeaders(oauthToken), signal }, { transport });
    if (!fallback.ok) { await drain(fallback); return null; }
    const data = await readJson(fallback);
    const api = trustedGheEndpoints(binding, data?.endpoints).api;
    if (!api || new URL(api).origin !== binding.gheUrl) {
      throw new GheConnectionError("unsupported_ghe_oauth_peer", "GHE.com returned no session credential: cross-origin OAuth fallback is unsupported; no safe peer credential contract in pinned sources");
    }
    // Local reuse ceiling, not a claim that the OAuth credential expires here.
    return { token: oauthToken, expiresAt: Math.floor(now() / 1000) + 3600, apiUrl: api, kind: "issuer-oauth" };
  }
  if (!response.ok) {
    await drain(response);
    return null;
  }
  const session = decodeGheSessionToken(binding, await readJson(response), now());
  if (session?.token === oauthToken) throw new GheConnectionError("oauth_forwarding_refused", "Session exchange returned the OAuth credential instead of a scoped token");
  return session;
}

/** Refresh the GHE OAuth token with the bound client id. */
export async function refreshBoundGheOAuth(binding, refreshToken, { signal, transport } = {}) {
  if (!refreshToken || !binding.clientId) return null;
  const response = await gheBoundFetch(binding, gheOAuthTokenUrl(binding.gheUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: binding.clientId }),
    signal
  }, { transport });
  if (!response.ok) {
    await drain(response);
    return null;
  }
  const tokens = await readJson(response);
  if (!isRecord(tokens) || !isString(tokens.access_token) || !tokens.access_token) return null;
  return {
    accessToken: tokens.access_token,
    refreshToken: isString(tokens.refresh_token) && tokens.refresh_token ? tokens.refresh_token : refreshToken,
    ...(isNumber(tokens.expires_in) ? { expiresIn: tokens.expires_in } : null)
  };
}

function sessionFields(session) {
  const providerSpecificData = {};
  if (session.apiUrl) providerSpecificData.copilotApiUrl = session.apiUrl;
  if (session.proxyUrl) providerSpecificData.copilotProxyUrl = session.proxyUrl;
  return {
    copilotToken: session.token,
    copilotTokenExpiresAt: session.expiresAt,
    ...(Object.keys(providerSpecificData).length ? { providerSpecificData } : null)
  };
}

/**
 * Connection-bound replacement for `refreshGheCopilotCredentials`: same
 * result shape, session mint first, OAuth refresh only when the stored OAuth
 * token can no longer mint one. Upstream bodies are never logged or returned.
 */
export async function refreshBoundGheCopilotCredentials(credentials, log, proxyOptions = null, options = {}) {
  let binding;
  try {
    binding = storedGheBinding(credentials, proxyOptions, { refresh: true });
  } catch (error) {
    if (error instanceof GheConnectionError) throw error;
    throw new GheConnectionError("reauthentication_needed", "GitHub Enterprise reauthentication needed");
  }
  try {
    const direct = await mintBoundGheSession(binding, credentials.accessToken, options);
    const fields = (session) => {
      const result = sessionFields(session);
      if (credentials.providerSpecificData?.gheBinding) {
        result.providerSpecificData = {
          ...result.providerSpecificData,
          gheSession: {
            issuer: binding.gheUrl, clientId: binding.clientId,
            apiOrigin: new URL(session.apiUrl || binding.gheUrl).origin,
            kind: session.kind || "session", tokenHash: gheTokenHash(session.token)
          },
          copilotToken: session.token, copilotTokenExpiresAt: session.expiresAt,
          copilotApiUrl: session.apiUrl || null
        };
      }
      return result;
    };
    if (direct) {
      return { accessToken: credentials.accessToken, refreshToken: credentials.refreshToken, ...fields(direct) };
    }
    const oauth = await refreshBoundGheOAuth(binding, credentials?.refreshToken, options);
    if (!oauth) return null;
    const minted = await mintBoundGheSession(binding, oauth.accessToken, options);
    return minted ? { ...oauth, ...fields(minted) } : oauth;
  } catch (error) {
    if (options.signal?.aborted || error?.code === "unsupported_ghe_oauth_peer" || error?.code === "oauth_forwarding_refused") throw error;
    log?.error?.("TOKEN", error instanceof GheConnectionError ? error.message : "GHE Copilot refresh request failed");
    return null;
  }
}
