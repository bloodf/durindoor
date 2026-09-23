/**
 * Browser-TLS-impersonating HTTP client for chatgpt.com.
 *
 * Thin re-export over the shared `tlsClientBase.js` factory
 * (`createTlsClientModule`). All provider-agnostic logic (sidecar lifecycle,
 * streaming tail-file, proxy resolution, error classes, SSE detection) lives
 * in the base module; this file supplies only ChatGPT-specific config and
 * preserves the original public export surface.
 */

import { createTlsClientModule } from "./tlsClientBase.js";

const DEFAULT_TIMEOUT_MS =
  Number.parseInt(process.env.DURINDOOR_CHATGPT_TLS_TIMEOUT_MS || "", 10) || 60_000;
const HARD_TIMEOUT_GRACE_MS =
  Number.parseInt(process.env.DURINDOOR_CHATGPT_TLS_GRACE_MS || "", 10) || 10_000;
const STREAM_FIRST_BYTE_TIMEOUT_MS =
  Number.parseInt(process.env.DURINDOOR_CHATGPT_STREAM_FIRST_BYTE_TIMEOUT_MS || "", 10) || 30_000;

export const tlsClientModule = createTlsClientModule({
  providerName: "ChatGPT",
  tlsProfile: "firefox_148",
  domain: "https://chatgpt.com",
  tempDirPrefix: "cgpt-stream-",
  tailFileVariant: "A",
  responseValidation: "sse",
  exportCloudflareCheck: false,
  exposeStreamingForTesting: true,
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  hardTimeoutGraceMs: HARD_TIMEOUT_GRACE_MS,
  firstByteTimeoutMs: STREAM_FIRST_BYTE_TIMEOUT_MS,
});

export const tlsFetchChatGpt = (url, options = {}) => tlsClientModule.tlsFetch(url, options);
export const __tlsFetchStreamingForTesting = tlsClientModule.__tlsFetchStreamingForTesting;

export const __setTlsFetchOverrideForTesting = tlsClientModule.__setTlsFetchOverrideForTesting;

export { TlsClientHangError, TlsClientUnavailableError } from "./tlsClientBase.js";

export { looksLikeSse } from "./tlsClientBase.js";
