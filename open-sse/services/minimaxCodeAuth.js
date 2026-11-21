/**
 * MiniMax Code account protocol: device sign-in (RFC 8628 + S256 PKCE) and refresh.
 *
 * Staged module. Ported from OmniRoute release/v3.8.55
 * (4265bb2ad5477450a07d3a43ea33a62c6c874878):
 *   - open-sse/config/minimaxCode.ts            (endpoints, scope, audience, grant)
 *   - src/lib/oauth/providers/minimax-code.ts   (device-code request and poll)
 *   - open-sse/executors/minimaxCodeGateway.ts  (refresh grant)
 * The client binding (`mcode-public`, scope `agent.default`, audience `agent-backend`)
 * and the `/oauth2/*` paths match the first-party source recorded in
 * docs/providers/minimax-code.mdx.
 *
 * Differences from upstream: DurinDoor keeps the credential on its own connection row
 * (encrypted like any other OAuth connection) and never reads or writes a local MiniMax
 * Code CLI profile. Every call goes through proxyAwareFetch so the connection proxy applies,
 * and redirects fail closed so a token request is never replayed to another host.
 */
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

export const MINIMAX_CODE_ACCOUNT_BASES = Object.freeze({
  en: "https://account.minimax.io",
  cn: "https://account.minimax.cn",
});
export const MINIMAX_CODE_DEFAULT_REGION = "en";
export const MINIMAX_CODE_CLIENT_ID = "mcode-public";
export const MINIMAX_CODE_SCOPE = "agent.default";
export const MINIMAX_CODE_AUDIENCE = "agent-backend";
export const MINIMAX_CODE_DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
export const MINIMAX_CODE_CODE_CHALLENGE_METHOD = "S256";
// The account service expects the CLI's user agent.
export const MINIMAX_CODE_ACCOUNT_USER_AGENT = "minimax-code-cli";
const ACCOUNT_TIMEOUT_MS = 20_000;
const DEFAULT_EXPIRES_IN_S = 3600;

/** "EN", " cn " -> canonical key; anything unknown falls back to the global region. */
export function normalizeMinimaxCodeRegion(region) {
  const key = isString(region) ? region.trim().toLowerCase() : "";
  return Object.hasOwn(MINIMAX_CODE_ACCOUNT_BASES, key) ? key : MINIMAX_CODE_DEFAULT_REGION;
}

export function resolveMinimaxCodeAccountBase(region) {
  return MINIMAX_CODE_ACCOUNT_BASES[normalizeMinimaxCodeRegion(region)];
}

export const MINIMAX_CODE_OAUTH_CONFIG = Object.freeze({
  clientId: MINIMAX_CODE_CLIENT_ID,
  scope: MINIMAX_CODE_SCOPE,
  audience: MINIMAX_CODE_AUDIENCE,
  accountBases: MINIMAX_CODE_ACCOUNT_BASES,
});

/** An error with an HTTP status the caller may surface. Never carries a token. */
export class MinimaxCodeAuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "MinimaxCodeAuthError";
    this.status = status;
    this.code = code;
  }
}

const asRecord = (value) => (value && isObject(value) && !Array.isArray(value) ? value : {});
const asString = (value) => (isString(value) ? value : "");

/**
 * POST a form to the account service. The endpoint answers a pending device code with
 * HTTP 400 and a JSON body, so the body decides, not the status. status 0 = unreachable.
 */
async function postAccountForm(url, params, proxyOptions, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCOUNT_TIMEOUT_MS);
  timer.unref?.();
  try {
    const init = {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": MINIMAX_CODE_ACCOUNT_USER_AGENT,
      },
      body: new URLSearchParams(params).toString(),
    };
    const response = fetchImpl ? await fetchImpl(url, init) : await proxyAwareFetch(url, init, proxyOptions);
    const data = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, data: asRecord(data) };
  } catch {
    return { status: 0, ok: false, data: { error: "network_error" } };
  } finally {
    clearTimeout(timer);
  }
}

function accountErrorText(data) {
  return asString(data.error_description) || asString(data.error) || "unknown error";
}

/** Region travels inside the device code so a poll hits the host that issued it. */
const REGION_PREFIX = /^(en|cn)\|/;
export function packDeviceCode(region, deviceCode) {
  return `${normalizeMinimaxCodeRegion(region)}|${deviceCode}`;
}
export function unpackDeviceCode(packed) {
  const text = asString(packed);
  const match = REGION_PREFIX.exec(text);
  return match
    ? { region: match[1], deviceCode: text.slice(match[0].length) }
    : { region: MINIMAX_CODE_DEFAULT_REGION, deviceCode: text };
}

/**
 * Ask the account service for a device code. The PKCE challenge binds the grant to the
 * caller: only the verifier it kept can redeem the device code.
 */
export async function requestMinimaxCodeDeviceCode({ region, codeChallenge, proxyOptions = null, fetchImpl = null } = {}) {
  if (!codeChallenge) throw new MinimaxCodeAuthError(400, "missing_code_challenge", "MiniMax Code sign-in needs a PKCE challenge.");
  const resolvedRegion = normalizeMinimaxCodeRegion(region);
  const base = resolveMinimaxCodeAccountBase(resolvedRegion);
  const { status, data } = await postAccountForm(`${base}/oauth2/device/code`, {
    client_id: MINIMAX_CODE_CLIENT_ID,
    scope: MINIMAX_CODE_SCOPE,
    audience: MINIMAX_CODE_AUDIENCE,
    code_challenge: codeChallenge,
    code_challenge_method: MINIMAX_CODE_CODE_CHALLENGE_METHOD,
  }, proxyOptions, fetchImpl);
  if (status === 0) {
    throw new MinimaxCodeAuthError(502, "account_unreachable", "MiniMax Code device authorization failed: the account endpoint is unreachable.");
  }
  const deviceCode = asString(data.device_code);
  const userCode = asString(data.user_code);
  if (!deviceCode || !userCode) {
    throw new MinimaxCodeAuthError(status >= 400 && status < 500 ? status : 502, "device_authorization_failed",
      `MiniMax Code device authorization failed: ${accountErrorText(data)}`);
  }
  const verificationUri = asString(data.verification_uri);
  return {
    device_code: packDeviceCode(resolvedRegion, deviceCode),
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: asString(data.verification_uri_complete) || verificationUri,
    expires_in: Number(data.expires_in) > 0 ? Number(data.expires_in) : 300,
    interval: Number(data.interval) > 0 ? Number(data.interval) : 5,
    region: resolvedRegion,
  };
}

/**
 * Redeem the device code. Returns `{ ok: true, data }` once tokens arrive; otherwise
 * `{ ok: false, data: { error, error_description } }`. `authorization_pending` and
 * `slow_down` mean keep polling; `expired_token` and `access_denied` end the flow.
 */
export async function pollMinimaxCodeDeviceToken({ deviceCode, codeVerifier, proxyOptions = null, fetchImpl = null } = {}) {
  const { region, deviceCode: raw } = unpackDeviceCode(deviceCode);
  const base = resolveMinimaxCodeAccountBase(region);
  const { status, data } = await postAccountForm(`${base}/oauth2/token`, {
    grant_type: MINIMAX_CODE_DEVICE_GRANT,
    device_code: raw,
    client_id: MINIMAX_CODE_CLIENT_ID,
    code_verifier: codeVerifier || "",
  }, proxyOptions, fetchImpl);
  if (status === 0) return { ok: false, data: { error: "network_error" } };
  if (asString(data.access_token)) return { ok: true, data: { ...data, _region: region } };
  const error = asString(data.error);
  if (!error) return { ok: false, data: { error: "poll_failed", error_description: `Poll failed: ${status}` } };
  return { ok: false, data: { error, error_description: asString(data.error_description) } };
}

/** Connection row fields for a completed sign-in. */
export function mapMinimaxCodeTokens(tokens) {
  const expiresIn = Number(tokens?.expires_in);
  return {
    accessToken: tokens.access_token,
    refreshToken: asString(tokens.refresh_token) || null,
    expiresIn: expiresIn > 0 ? expiresIn : DEFAULT_EXPIRES_IN_S,
    // The account service returns no identity, so the connection is labelled by provider.
    displayName: "MiniMax Code account",
    // enableSessionDispatch is deliberately absent: dispatch stays off until the operator opts in.
    providerSpecificData: {
      authKind: "oauth",
      region: normalizeMinimaxCodeRegion(tokens._region),
      clientId: MINIMAX_CODE_CLIENT_ID,
      lastRefresh: new Date().toISOString(),
    },
  };
}

/**
 * Exchange the connection's own refresh token. Returns the new credential fields, or null
 * when the account service rejected or could not serve the refresh (the caller then keeps
 * the old token, the gateway answers 401 and the operator is told to sign in again).
 * The refresh token rotates: the response's value replaces the stored one.
 */
export async function refreshMinimaxCodeToken(credentials, log, proxyOptions = null, fetchImpl = null) {
  const refreshToken = asString(credentials?.refreshToken);
  if (!refreshToken) {
    log?.warn?.("TOKEN_REFRESH", "MiniMax Code connection has no refresh token; sign in again");
    return null;
  }
  const data = credentials?.providerSpecificData;
  const region = normalizeMinimaxCodeRegion(data?.region);
  const { status, ok, data: body } = await postAccountForm(`${resolveMinimaxCodeAccountBase(region)}/oauth2/token`, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: MINIMAX_CODE_CLIENT_ID,
    scope: MINIMAX_CODE_SCOPE,
    audience: MINIMAX_CODE_AUDIENCE,
  }, proxyOptions, fetchImpl);
  const accessToken = asString(body.access_token);
  if (!ok || !accessToken) {
    const kind = status >= 400 && status < 500 ? "rejected (sign in again)" : "unavailable";
    log?.warn?.("TOKEN_REFRESH", `MiniMax Code token refresh ${kind}: HTTP ${status}`);
    return null;
  }
  const expiresIn = Number(body.expires_in);
  return {
    accessToken,
    refreshToken: asString(body.refresh_token) || refreshToken,
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_EXPIRES_IN_S,
    providerSpecificData: { ...(data || {}), region, lastRefresh: new Date().toISOString() },
  };
}
