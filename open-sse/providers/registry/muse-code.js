import { isString } from "../../../src/shared/utils/typeChecks.js";

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

// Muse Code (Meta), the agentic coding CLI. Wire format is the OpenAI Responses
// API. Dual auth, and the two credentials are not interchangeable:
//
// - The Muse device flow signs in the same way `muse login` does. Meta scopes
//   the subscription key it hands out to the Muse Code client, so that path
//   keeps the Muse Code client identity and the inference key is reminted from
//   the stored device token.
// - A pasted META_API_KEY is a Meta Model API key. Meta documents that key
//   for external clients on https://api.meta.ai/v1 with a bearer token, and
//   the documented request carries no Muse Code client fingerprint, so it
//   travels bare and is never reminted.
//
// The base URL is the same for both: it is Meta's documented Model API
// responses endpoint.
export default {
  id: "muse-code",
  priority: 285,
  alias: "mc",
  uiAlias: "mc",
  display: {
    name: "Muse Code (Meta)",
    icon: "auto_awesome",
    color: "#0866FF",
    textIcon: "MC",
    website: "https://dev.meta.ai/docs/muse-code/auth",
    notice: {
      text: "Sign in with the Muse Code device flow (same as `muse login`) to use a Muse subscription. The subscription key is scoped to the Muse Code client. Paste a Meta Model API key instead for the documented Model API.",
    },
  },
  category: "oauth",
  authModes: [
    "oauth",
    "apikey",
  ],
  hasOAuth: true,
  transport: {
    baseUrl: MUSE_CODE_RESPONSES_URL,
    format: "openai-responses",
    headers: {
      "User-Agent": MUSE_CODE_INFERENCE_USER_AGENT,
    },
  },
  models: [
    { id: "muse-spark-1.3", name: "Muse Spark 1.3" },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor" },
    { id: "muse-spark-1.2", name: "Muse Spark 1.2" },
    { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor" },
    { id: "muse-spark-1.1", name: "Muse Spark 1.1" },
    { id: "llama-4-maverick", name: "Llama 4 Maverick" },
    { id: "llama-4-scout", name: "Llama 4 Scout" },
    { id: "llama-3.3-70b", name: "Llama 3.3 70B" },
    { id: "llama-3.1-405b", name: "Llama 3.1 405B" },
    { id: "llama-3.1-70b", name: "Llama 3.1 70B" },
    { id: "llama-3.1-8b", name: "Llama 3.1 8B" },
    { id: "llama-3.2-90b-vision", name: "Llama 3.2 90B Vision" },
    { id: "llama-3.2-11b-vision", name: "Llama 3.2 11B Vision" },
  ],
  serviceKinds: ["llm"],
  passthroughModels: true,
  oauth: {
    // Public Muse Code CLI client id (device grant, no secret, no PKCE).
    clientId: "1031625952748946",
    deviceCodeUrl: MUSE_CODE_DEVICE_CODE_URL,
    tokenUrl: MUSE_CODE_TOKEN_URL,
    mintUrl: MUSE_CODE_MINT_URL,
  },
};
