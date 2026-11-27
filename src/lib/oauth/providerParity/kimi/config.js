// Kimi Coding device-flow contract, staged for #2034.
//
// Provenance (MIT):
//   router-for-me/CLIProxyAPI dbe641f286a489ecb39e3c041c554371e6add864
//     `internal/auth/kimi/kimi.go` — device authorization and token endpoints,
//     the public client id, the device grant, the poll interval floor, the
//     15 minute poll ceiling and the device-code error mapping.
//   cheaper-inference/OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523
//     `src/lib/oauth/providers/kimi-coding.ts` — device request and poll
//     envelope (client id, device grant, required device-code fields).
//     `open-sse/config/providers/registry/kimi/coding/runtime.ts` — the identity
//     header set and the device-id normalization.
//
// Private staging metadata. No production module imports this directory yet:
// the shared OAuth wiring (`src/lib/oauth/providers.js`,
// `open-sse/config/appConstants.js`, `open-sse/executors/default.js`) belongs to
// the ordered auth batches. `registration.json` lists the exact integration
// slots and the exports this directory offers to them.

import { isString } from "../../../../shared/utils/typeChecks.js";

/**
 * Kimi Code's public OAuth client id.
 * CLIProxyAPI `internal/auth/kimi/kimi.go` `kimiClientID`; OmniRoute
 * `src/lib/oauth/providers/kimi-coding.ts` reads the same value from its
 * registry default.
 */
export const KIMI_CODING_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";

/**
 * Environment override for the `.com` grant.
 * DurinDoor-specific: CLIProxyAPI hardcodes the client id and OmniRoute reads
 * `clientIdEnv` from its registry entry. The override stays DurinDoor's own
 * deployment switch and is not part of the upstream contract.
 */
export const KIMI_CODING_CLIENT_ID_ENV = "KIMI_CODING_OAUTH_CLIENT_ID";

/** RFC 8628 device grant (CLIProxyAPI `exchangeDeviceCode`, OmniRoute `kimi-coding.ts`). */
export const KIMI_OAUTH_GRANT_DEVICE = "urn:ietf:params:oauth:grant-type:device_code";

/** Refresh grant (CLIProxyAPI `refreshTokenSingleFlight`, OmniRoute `kimiCoding.ts`). */
export const KIMI_OAUTH_GRANT_REFRESH = "refresh_token";

/**
 * Minimum seconds between two polls of the token endpoint.
 * CLIProxyAPI `internal/auth/kimi/kimi.go` `defaultPollInterval`; the provider
 * may ask for a longer interval, never a shorter one.
 */
export const KIMI_DEVICE_POLL_INTERVAL_FLOOR_SECONDS = 5;

/**
 * Hard ceiling on one device authorization, in seconds.
 * CLIProxyAPI `internal/auth/kimi/kimi.go` `maxPollDuration`.
 */
export const KIMI_DEVICE_POLL_MAX_SECONDS = 900;

/**
 * Provider replies that keep the device flow open.
 * CLIProxyAPI `internal/auth/kimi/kimi.go` `exchangeDeviceCode` maps
 * `authorization_pending` and `slow_down` to "continue polling".
 */
export const KIMI_DEVICE_PENDING_ERRORS = Object.freeze([
  "authorization_pending",
  "slow_down"
]);

/**
 * Provider replies that end the device flow.
 * CLIProxyAPI `internal/auth/kimi/kimi.go` `exchangeDeviceCode` maps
 * `expired_token` to "device code expired" and `access_denied` to
 * "access denied by user"; both stop the poll loop.
 */
export const KIMI_DEVICE_TERMINAL_ERRORS = Object.freeze([
  "expired_token",
  "access_denied"
]);

/**
 * The Kimi Coding regions DurinDoor serves, keyed by canonical provider id.
 *
 * `kimi-coding` is the `.com` deployment and `kimi-ai` the international
 * `.ai` one. CLIProxyAPI `internal/auth/kimi/kimi.go` `ResolveKimiOAuthHost`
 * and `ResolveKimiAPIBaseURL` derive the same two hosts from the credential
 * domain; OmniRoute registers only the `.com` device flow and keeps the
 * international consumer session in a separate web adapter, so the `.ai`
 * Coding row below is a DurinDoor extension of the CLIProxyAPI contract.
 */
export const KIMI_OAUTH_REGIONS = Object.freeze({
  "kimi-coding": Object.freeze({
    provider: "kimi-coding",
    domain: "kimi.com",
    oauthHost: "https://auth.kimi.com",
    deviceCodeUrl: "https://auth.kimi.com/api/oauth/device_authorization",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    apiBaseUrl: "https://api.kimi.com/coding"
  }),
  "kimi-ai": Object.freeze({
    provider: "kimi-ai",
    domain: "kimi.ai",
    oauthHost: "https://auth.kimi.ai",
    deviceCodeUrl: "https://auth.kimi.ai/api/oauth/device_authorization",
    tokenUrl: "https://auth.kimi.ai/api/oauth/token",
    apiBaseUrl: "https://api.kimi.ai/coding"
  })
});

/** Provider ids that own a Kimi Coding device credential. */
export const KIMI_CODING_PROVIDER_IDS = Object.freeze(Object.keys(KIMI_OAUTH_REGIONS));

/**
 * Resolve the device-flow region for a provider id.
 *
 * Unsupported provider ids fail here, before any network call: the Kimi
 * platform API key (`kimi`), the Kimi Code API key (`kimi-coding-apikey`) and
 * the Kimi consumer web session (`kimi-web`) are separate identities with
 * separate credential shapes and must never borrow the device grant.
 *
 * @param {string} providerId
 * @returns {{provider: string, domain: string, oauthHost: string, deviceCodeUrl: string, tokenUrl: string, apiBaseUrl: string}}
 */
export function resolveKimiOAuthRegion(providerId) {
  const id = isString(providerId) ? providerId.trim() : "";
  const region = KIMI_OAUTH_REGIONS[id];
  if (!region) {
    throw new Error(`Unsupported Kimi OAuth provider: ${id || "(empty)"}`);
  }
  return region;
}

/**
 * Whether a provider id owns a Kimi Coding device credential.
 * @param {string} providerId
 * @returns {boolean}
 */
export function isKimiCodingProvider(providerId) {
  return isString(providerId) && Object.hasOwn(KIMI_OAUTH_REGIONS, providerId.trim());
}
