import { isString } from "../../src/shared/utils/typeChecks.js";

export const SYSTEMONE_COMPATIBLE_PREFIX = "systemone-compatible-";

/** Accept an API base or the complete native endpoint, without URL credentials. */
export function normalizeSystemoneBaseUrl(value) {
  if (!isString(value) || !value.trim()) throw new Error("System One base URL is required");
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("Invalid System One base URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("System One base URL must use HTTP(S) without credentials, query, or fragment");
  }
  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/systemone")) pathname = pathname.slice(0, -"/systemone".length);
  url.pathname = pathname || "/v1";
  return url.toString().replace(/\/$/, "");
}

export function systemoneEndpoint(value) {
  return `${normalizeSystemoneBaseUrl(value)}/systemone`;
}
