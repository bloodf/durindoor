// Kimi device identity and request headers, staged for #2034.
//
// Provenance (MIT):
//   cheaper-inference/OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523
//     `open-sse/config/providers/registry/kimi/coding/runtime.ts`
//       `sanitizeKimiHeaderValue`, `normalizeKimiDeviceId`,
//       `buildKimiCodeIdentityHeaders`.
//     `open-sse/utils/kimiDevice.ts` `getKimiDeviceModel`.
//     `open-sse/services/tokenRefresh/providers/kimiCoding.ts`
//       `refreshKimiCodingToken` — the stable device id and its
//       `pbkdf2Sync(refreshToken, "kimi-device-id", 1000, 16, "sha256")`
//       fallback for connections without a stored device id.
//   router-for-me/CLIProxyAPI dbe641f286a489ecb39e3c041c554371e6add864
//     `internal/auth/kimi/kimi.go` `commonHeaders` — platform, version,
//     device name, device model and device id.
//     `internal/runtime/executor/kimi_executor.go` `applyKimiHeaders` — the
//     same identity headers on inference requests.
//
// Server-side module: it reads the local machine identity through `node:os`
// and `node:crypto`. It has no import-time side effects, so it stays safe to
// import from the Next.js OAuth tier. See `registration.json` for the central
// integration slots.

import { pbkdf2Sync, randomUUID } from "node:crypto";
import { arch, hostname, release, type as osType } from "node:os";
import { isString } from "../../../../shared/utils/typeChecks.js";

/**
 * Strip everything outside printable ASCII from a header value.
 *
 * OmniRoute `runtime.ts` `sanitizeKimiHeaderValue`: a header that carries a
 * newline or a control byte can split the request, so the value is reduced to
 * its printable range and falls back when nothing printable is left.
 *
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function sanitizeKimiHeaderValue(value, fallback = "unknown") {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return text.replace(/[^\x20-\x7e]/g, "").trim() || fallback;
}

/**
 * Normalize a device id to the canonical dashed UUID shape.
 *
 * OmniRoute `runtime.ts` `normalizeKimiDeviceId`: a bare 32 hex digit id is
 * regrouped as `8-4-4-4-12`; any other value is only sanitized.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeKimiDeviceId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const deviceId = sanitizeKimiHeaderValue(raw, "");
  if (!deviceId) return "";
  if (!/^[0-9a-f]{32}$/i.test(deviceId)) return deviceId;
  return [
    deviceId.slice(0, 8),
    deviceId.slice(8, 12),
    deviceId.slice(12, 16),
    deviceId.slice(16, 20),
    deviceId.slice(20)
  ].join("-");
}

/**
 * The machine facts Kimi sees in the identity headers.
 *
 * `deviceName` is the host name (CLIProxyAPI `getKimiHostname`), `osVersion`
 * is the kernel release (OmniRoute `osVersion: release()`), and `deviceModel`
 * follows OmniRoute `getKimiDeviceModel()` for the Linux and Windows shapes.
 * Upstream reads the macOS product version through `/usr/bin/sw_vers`; this
 * helper keeps the release string instead of spawning a process, because the
 * header only has to be a stable, printable description of the machine.
 *
 * @returns {{deviceName: string, deviceModel: string, osVersion: string}}
 */
export function getKimiDeviceFacts() {
  const type = osType();
  const version = release();
  const architecture = arch();
  const deviceModel = type === "Darwin" ?
    `macOS ${version} ${architecture}` :
    type === "Windows_NT" ?
      `Windows ${version} ${architecture}` :
      `${type} ${version} ${architecture}`.trim();
  return {
    deviceName: sanitizeKimiHeaderValue(hostname(), "unknown"),
    deviceModel: sanitizeKimiHeaderValue(deviceModel, "unknown"),
    osVersion: sanitizeKimiHeaderValue(version, "unknown")
  };
}

/**
 * Build the Kimi identity headers.
 *
 * The header set is the union of what the two upstreams send:
 *   - CLIProxyAPI `commonHeaders`: platform, version, device name, device
 *     model, device id.
 *   - OmniRoute `buildKimiCodeIdentityHeaders`: the same five plus
 *     `X-Msh-Os-Version`.
 *
 * DurinDoor's production headers currently omit the device name and the OS
 * version, which is the delta this helper stages.
 *
 * @param {object} identity
 * @param {string} identity.platform  Value of `X-Msh-Platform`.
 * @param {string} identity.version   Value of `X-Msh-Version`.
 * @param {string} [identity.deviceId]
 * @param {string} [identity.deviceName]
 * @param {string} [identity.deviceModel]
 * @param {string} [identity.osVersion]
 * @returns {Record<string, string>}
 */
export function buildKimiDeviceIdentityHeaders(identity = {}) {
  const facts = getKimiDeviceFacts();
  const deviceId = normalizeKimiDeviceId(identity.deviceId);
  return {
    "X-Msh-Platform": sanitizeKimiHeaderValue(identity.platform, "unknown"),
    "X-Msh-Version": sanitizeKimiHeaderValue(identity.version, "unknown"),
    "X-Msh-Device-Name": sanitizeKimiHeaderValue(identity.deviceName ?? facts.deviceName),
    "X-Msh-Device-Model": sanitizeKimiHeaderValue(identity.deviceModel ?? facts.deviceModel),
    "X-Msh-Os-Version": sanitizeKimiHeaderValue(identity.osVersion ?? facts.osVersion),
    "X-Msh-Device-Id": sanitizeKimiHeaderValue(deviceId, "unknown")
  };
}

/**
 * Derive a stable device id from a refresh token.
 *
 * OmniRoute `open-sse/services/tokenRefresh/providers/kimiCoding.ts` falls back
 * to `pbkdf2Sync(refreshToken, "kimi-device-id", 1000, 16, "sha256")` when a
 * connection has no stored device id, so repeated refreshes of the same token
 * keep presenting the same device. The derivation is deterministic and never
 * exposes the token itself.
 *
 * @param {string} refreshToken
 * @returns {string} A dashed device id, or "" when no token was supplied.
 */
export function deriveKimiDeviceIdFromRefreshToken(refreshToken) {
  const token = isString(refreshToken) ? refreshToken.trim() : "";
  if (!token) return "";
  const hex = pbkdf2Sync(token, "kimi-device-id", 1000, 16, "sha256").toString("hex");
  return normalizeKimiDeviceId(hex);
}

/**
 * Resolve the device id a Kimi Coding request should present.
 *
 * Order of preference:
 *   1. the device id stored with the connection (written at sign-in and kept
 *      across rotations),
 *   2. the deterministic derivation from the refresh token (OmniRoute's
 *      fallback, for connections stored before the device id was persisted),
 *   3. a fresh random UUID (CLIProxyAPI `getOrCreateDeviceID`).
 *
 * The result is always a UUID-shaped, printable value, so Kimi never sees a
 * request without an identity and never sees a new device on every refresh.
 *
 * @param {object} [options]
 * @param {string} [options.deviceId]
 * @param {string} [options.refreshToken]
 * @returns {string}
 */
export function resolveKimiDeviceId(options = {}) {
  const stored = normalizeKimiDeviceId(options.deviceId);
  if (stored) return stored;
  const derived = deriveKimiDeviceIdFromRefreshToken(options.refreshToken);
  if (derived) return derived;
  return randomUUID();
}
