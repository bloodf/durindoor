import {
  assertOutboundUrlAllowed,
  OutboundUrlGuardError,
} from "open-sse/utils/outboundUrlGuard.js";

export const RELAY_PROXY_TYPES = new Set(["vercel", "cloudflare"]);
export const RELAY_URL_GUARD = "public-only";

export function isRelayProxyType(type) {
  return RELAY_PROXY_TYPES.has(type);
}

/**
 * Validate a Vercel/Cloudflare relay URL against the public-only SSRF policy
 * (same policy as operator webhooks: public hosts only, HTTPS only, no
 * embedded credentials).
 *
 * @param {string} rawUrl
 * @returns {{ url: string } | { error: string }}
 */
export function validateRelayProxyUrl(rawUrl) {
  let url;
  try {
    url = assertOutboundUrlAllowed(rawUrl, RELAY_URL_GUARD);
  } catch (error) {
    return {
      error: error instanceof OutboundUrlGuardError ? error.message : "Invalid relay URL",
    };
  }
  if (url.protocol !== "https:") {
    return { error: "Relay URL must use https" };
  }
  return { url: rawUrl };
}
