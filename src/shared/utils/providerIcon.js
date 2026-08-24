import { isString } from "./typeChecks.js"; /**
 * rendered as an <img> src by ProviderIcon.js). Used by create/update
 * provider-node API routes. The browser never fetches a URL server-side;
 * validation confines persisted image sources to safe supported schemes.
 *
 * Accepted:
 *   - ""                          → no custom icon
 *   - http(s) URL, <= 2000 chars  → rendered directly, browser fetches it
 *   - data:image/<raster>;base64,<payload>, <= 256 KiB encoded
 *
 * Rejected:
 *   - any other scheme (javascript:, file:, data:text/*, ...)
 *   - image/svg+xml data URLs (script-capable — no sanitizer in this repo)
 *   - malformed / non-base64 / empty payloads
 *   - anything over the length or decoded-size bound
 */
export const MAX_PROVIDER_ICON_URL_LENGTH = 2000;
export const MAX_PROVIDER_ICON_DATA_URL_LENGTH = 256 * 1024;
export const MAX_PROVIDER_ICON_DATA_BYTES = Math.floor(MAX_PROVIDER_ICON_DATA_URL_LENGTH * 3 / 4);

const HTTP_SCHEME_RE = /^https?:\/\//i;
const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp|x-icon|vnd\.microsoft\.icon);base64,([a-z0-9+/]+={0,2})$/i;
const BASE64_RE = /^[a-z0-9+/]+={0,2}$/i;

export function isValidProviderIconUrl(value) {
  if (!isString(value)) return false;
  const trimmed = value.trim();

  if (trimmed === "") return true;

  if (/^data:/i.test(trimmed)) {
    if (trimmed.length > MAX_PROVIDER_ICON_DATA_URL_LENGTH) return false;
    const match = DATA_IMAGE_RE.exec(trimmed);
    if (!match) return false;
    const payload = match[2];
    if (!BASE64_RE.test(payload) || payload.length % 4 !== 0) return false;
    const decoded = Buffer.from(payload, "base64");
    return decoded.length > 0 &&
    decoded.length <= MAX_PROVIDER_ICON_DATA_BYTES &&
    decoded.toString("base64") === payload;
  }

  if (trimmed.length > MAX_PROVIDER_ICON_URL_LENGTH) return false;
  if (!HTTP_SCHEME_RE.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}