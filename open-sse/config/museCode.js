/**
 * Muse Code (Meta) endpoints and CLI identity.
 *
 * Login is an RFC 8628 device grant against auth.meta.com. The device grant
 * returns a durable `dca:` token; the subscription inference key is minted from
 * it at api.meta.ai/muse-code/key and reminted when it is rejected. Meta
 * requires the Muse CLI User-Agent on the auth calls.
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

/** Headers for Meta auth endpoints (device, token, mint). */
export function museCodeHeaders(extra = {}) {
  return { Accept: "application/json", "User-Agent": MUSE_CODE_USER_AGENT, ...extra };
}

/** True for the durable device-client token, which is not an inference key. */
export function isMuseDcaToken(token) {
  return isString(token) && token.trim().startsWith("dca:");
}
