/**
 * Freebuff (freebuff.com, the Codebuff free tier) sign-in adapter. Staged:
 * the registration batch adds it to src/lib/oauth/providers.js.
 *
 * Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
 * MIT, src/lib/oauth/providers/freebuff.ts. Custom fingerprint login that
 * mirrors the official `freebuff login` flow (CodebuffAI/codebuff,
 * cli/src/login/login-flow.ts):
 *
 *   1. POST codeUrl { fingerprintId } -> { loginUrl, fingerprintHash, expiresAt }
 *   2. Open loginUrl in the browser
 *   3. GET statusUrl?fingerprintId&fingerprintHash&expiresAt until { user.authToken }
 *      (401 = still pending)
 *
 * The poll needs all three login values, so they travel as one opaque
 * base64url `device_code` through the shared device-code route. The resulting
 * auth token has no refresh grant: re-login replaces it. It is a Freebuff
 * device-session token, never a paid Codebuff API key.
 */
import { randomBytes } from "node:crypto";
import { FREEBUFF_OAUTH } from "open-sse/config/freebuff.js";
import { isNumber, isObject, isString } from "../../shared/utils/typeChecks.js";
import { credentialFetch } from "../../../open-sse/utils/credentialFetch.js";

const EPOCH_DIGITS = /^\d+(\.\d+)?$/;

/** Same shape as the CLI's fallback fingerprint (`codebuff-cli-<8 base64url chars>`). */
export function generateFreebuffFingerprintId() {
  return `codebuff-cli-${randomBytes(6).toString("base64url").substring(0, 8)}`;
}

export function encodeFreebuffLoginState(state) {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeFreebuffLoginState(deviceCode) {
  if (!isString(deviceCode) || !deviceCode) return null;
  try {
    const parsed = JSON.parse(Buffer.from(deviceCode, "base64url").toString("utf8"));
    if (parsed && isString(parsed.fingerprintId) && isString(parsed.fingerprintHash) && isString(parsed.expiresAt)
      && parsed.fingerprintId && parsed.fingerprintHash && parsed.expiresAt) {
      return { fingerprintId: parsed.fingerprintId, fingerprintHash: parsed.fingerprintHash, expiresAt: parsed.expiresAt };
    }
  } catch {/* a malformed device code is reported by the caller as invalid_request */}
  return null;
}

/** Epoch ms of a login expiresAt: an ISO date, or an epoch-ms number kept as its digits. */
function expiresAtMs(expiresAt) {
  return EPOCH_DIGITS.test(expiresAt) ? Number(expiresAt) : Date.parse(expiresAt);
}

/** The upstream expiresAt as the poll must echo it; null when missing or not a valid date. */
function upstreamExpiresAt(value) {
  if (isString(value)) return value || null;
  if (!isNumber(value) || !Number.isFinite(new Date(value).getTime())) return null;
  const digits = String(value);
  return EPOCH_DIGITS.test(digits) ? digits : null;
}

function secondsUntil(expiresAt, fallback) {
  const ms = expiresAtMs(expiresAt) - Date.now();
  if (!Number.isFinite(ms)) return fallback;
  return Math.max(1, Math.floor(ms / 1000));
}

const expiredResult = () => ({ ok: false, data: { error: "expired_token", error_description: "Freebuff login expired" } });

export default {
  config: { ...FREEBUFF_OAUTH },
  flowType: "device_code",

  requestDeviceCode: async (config, _codeChallenge, _options, proxyOptions) => {
    const fingerprintId = generateFreebuffFingerprintId();
    const response = await credentialFetch(fetch, config.codeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ fingerprintId }),
      proxyOptions
    });
    if (!response.ok) throw new Error(`Freebuff login URL request failed (${response.status})`);

    const data = await response.json();
    const expiresAt = upstreamExpiresAt(data?.expiresAt);
    if (!isString(data?.loginUrl) || !isString(data?.fingerprintHash) || !expiresAt || !data.loginUrl || !data.fingerprintHash) {
      throw new Error("Freebuff login URL response is missing required fields");
    }
    return {
      device_code: encodeFreebuffLoginState({ fingerprintId, fingerprintHash: data.fingerprintHash, expiresAt }),
      user_code: fingerprintId.replace(/^codebuff-cli-/, ""),
      verification_uri: data.loginUrl,
      verification_uri_complete: data.loginUrl,
      expires_in: secondsUntil(expiresAt, config.loginTimeoutSec),
      interval: Math.max(1, Math.floor(config.pollInterval / 1000))
    };
  },

  pollToken: async (config, deviceCode, _codeVerifier, _extraData, proxyOptions) => {
    const state = decodeFreebuffLoginState(deviceCode);
    if (!state) {
      return { ok: false, data: { error: "invalid_request", error_description: "Malformed Freebuff login state" } };
    }
    const url = new URL(config.statusUrl);
    url.searchParams.set("fingerprintId", state.fingerprintId);
    url.searchParams.set("fingerprintHash", state.fingerprintHash);
    url.searchParams.set("expiresAt", state.expiresAt);

    const response = await credentialFetch(fetch, url.toString(), { method: "GET", headers: { Accept: "application/json" }, proxyOptions });
    const expired = expiresAtMs(state.expiresAt) <= Date.now();
    if (!response.ok) {
      if (expired) return expiredResult();
      // 401 is the upstream "not approved yet" signal; the official CLI keeps
      // polling through any other status until its timeout, too.
      if (response.status === 429 || response.status >= 500) return { ok: false, data: { error: "slow_down" } };
      return { ok: false, data: { error: "authorization_pending" } };
    }

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {/* a non-JSON 2xx body is treated as still pending below */}
    const user = body?.user;
    if (isObject(user) && isString(user.authToken) && user.authToken) {
      return {
        ok: true,
        data: {
          access_token: user.authToken,
          _userId: isString(user.id) ? user.id : undefined,
          _userEmail: isString(user.email) ? user.email : undefined,
          _userName: isString(user.name) && user.name ? user.name : undefined,
          _fingerprintId: state.fingerprintId
        }
      };
    }
    if (expired) return expiredResult();
    return { ok: false, data: { error: "authorization_pending" } };
  },

  mapTokens: (tokens) => {
    const providerSpecificData = { authKind: "oauth" };
    if (tokens._userId) providerSpecificData.userId = tokens._userId;
    if (tokens._fingerprintId) providerSpecificData.fingerprintId = tokens._fingerprintId;
    return {
      accessToken: tokens.access_token,
      refreshToken: null,
      expiresIn: null,
      email: tokens._userEmail,
      displayName: tokens._userName,
      providerSpecificData
    };
  }
};
