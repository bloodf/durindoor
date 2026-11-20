/**
 * Muse Code (Meta) endpoints and CLI identity.
 *
 * Login is an RFC 8628 device grant against auth.meta.com. The device grant
 * returns a durable `dca:` token; the subscription inference key is minted from
 * it at api.meta.ai/muse-code/key and reminted when it is rejected. Meta
 * requires the Muse CLI User-Agent on the auth calls.
 *
 * Two different credentials reach api.meta.ai and they are not interchangeable:
 *
 * - The Muse Code subscription key is minted from the device token. Meta scopes
 *   it to the Muse Code client: "The subscription applies to the Muse Code API
 *   key that is automatically connected in the Muse Code CLI onboarding
 *   process. This credential is for use with Muse Code only."
 *   (dev.meta.ai/help/subscriptions/subscribe-to-muse-code). It travels with
 *   the Muse Code client identity.
 * - The Meta Model API key is issued separately under the Meta Model API
 *   account and is billed pay-as-you-go. Meta documents it for external
 *   clients on `https://api.meta.ai/v1` with a bearer token
 *   (dev.meta.ai/docs/overview). The documented request carries no Muse Code
 *   client fingerprint, so it travels bare.
 */
import { isString } from "../../src/shared/utils/typeChecks.js";

export const MUSE_CODE_USER_AGENT = "muse-code/1.0.2";
export const MUSE_CODE_INFERENCE_USER_AGENT =
  "muse-build/1.3.0 (interactive; macos-aarch64; build ac7280f2aca67769d1455a8847bb502b617d50f6)";
export const MUSE_CODE_DEVICE_CODE_URL = "https://auth.meta.com/oidc/device/authorization/";
export const MUSE_CODE_TOKEN_URL = "https://auth.meta.com/oidc/device/token/";
export const MUSE_CODE_MINT_URL = "https://api.meta.ai/muse-code/key";
export const MUSE_CODE_RESPONSES_URL = "https://api.meta.ai/v1/responses";
export const MUSE_CODE_DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
export const MUSE_CODE_DEFAULT_POLL_INTERVAL_SEC = 5;

/**
 * Meta Model API — the documented public surface for external clients.
 *
 * Same host and path as the Muse Code inference endpoint; the credential is
 * what differs. A Model API key is a general bearer credential for this
 * surface, so the request carries no Muse Code client fingerprint.
 */
export const META_MODEL_API_BASE_URL = "https://api.meta.ai/v1";
export const META_MODEL_API_RESPONSES_URL = MUSE_CODE_RESPONSES_URL;
export const META_MODEL_API_MODELS_URL = `${META_MODEL_API_BASE_URL}/models`;

/**
 * Headers that claim the Muse Code client identity.
 *
 * They belong on the Muse Code subscription path, whose credential Meta scopes
 * to that client. A Meta Model API key is documented for external clients and
 * must not be sent with a Muse Code fingerprint.
 */
export const MUSE_CODE_CLIENT_IDENTITY_HEADERS = ["User-Agent"];

/** Meta's refusal code for a credential that is not entitled to the request. */
export const MUSE_CODE_ATTESTATION_DENIED = "client_attestation_denied";

/**
 * Client-facing text for an attestation denial.
 *
 * Meta answers `client_attestation_denied` when the credential is not entitled
 * to the requested surface. The remedy is a credential change, never a retry
 * with a different identity.
 */
export const MUSE_CODE_ATTESTATION_DENIED_MESSAGE =
  "Meta refused this credential (client_attestation_denied). A Muse Code subscription key is scoped to the Muse Code client; "
  + "use a Meta Model API key for gateway requests, or sign in with the Muse Code CLI.";

/** True when an upstream error body carries Meta's attestation denial. */
export function isMuseAttestationDenied(body) {
  return isString(body) && body.includes(MUSE_CODE_ATTESTATION_DENIED);
}

/** Headers for Meta auth endpoints (device, token, mint). */
export function museCodeHeaders(extra = {}) {
  return { Accept: "application/json", "User-Agent": MUSE_CODE_USER_AGENT, ...extra };
}

/** True for the durable device-client token, which is not an inference key. */
export function isMuseDcaToken(token) {
  return isString(token) && token.trim().startsWith("dca:");
}
