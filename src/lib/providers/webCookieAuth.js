/**
 * Static browser headers the www.kimi.com web app sends on its model-discovery
 * and chat endpoints. Shared by the model-discovery route (modelsConfig.js) and
 * the connection-validation probe (providerProbe.js) so both present the same
 * web-app fingerprint; Kimi accepts some valid cookies only with this set.
 * Auth (`Authorization` / `Cookie`) is added per-request, not here.
 */
export const KIMI_WEB_DISCOVERY_HEADERS = {
  accept: "*/*",
  "Content-Type": "application/json",
  "connect-protocol-version": "1",
  Origin: "https://www.kimi.com",
  Referer: "https://www.kimi.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
};

/**
 * Cookie / session helpers for web-session providers.
 *
 * All functions are fail-open: invalid/missing input returns an empty string.
 */

/**
 * Strip accidental prefixes from pasted credential blobs.
 * @param {string} rawValue
 * @returns {string}
 */
export function stripCookieInputPrefix(rawValue) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) return "";

  const withoutBearer = trimmed.replace(/^bearer\s+/i, "");
  return withoutBearer.replace(/^cookie:/i, "").trim();
}

/**
 * Extract the value of a single named cookie from a pasted blob.
 * Handles bare values, single pairs, and full DevTools cookie strings.
 * @param {string} rawValue
 * @param {string} cookieName
 * @returns {string}
 */
export function extractCookieValue(rawValue, cookieName) {
  const trimmed = stripCookieInputPrefix(rawValue);
  if (!trimmed) return "";

  if (trimmed.includes(";")) {
    const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = trimmed.match(new RegExp("(?:^|;\\s*)" + escaped + "=([^;\\s]+)"));
    return match ? match[1] : "";
  }

  const prefix = `${cookieName}=`;
  if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);

  return "";
}

/**
 * Pull the `kimi-auth` JWT out of whatever the user pasted for the
 * international Kimi consumer chat (www.kimi.com).
 *
 * Accepts:
 *   - bare JWT
 *   - full Cookie header (`_ga=...; kimi-auth=eyJ...; theme=dark`)
 *   - `Cookie:` / `Authorization: Bearer` prefixed forms
 *
 * Returns "" if no JWT can be located.
 * @param {string} rawValue
 * @returns {string}
 */
export function extractKimiJwt(rawValue) {
  const trimmed = stripCookieInputPrefix(rawValue);
  if (!trimmed) return "";

  // Bare JWT — three base64url segments separated by dots.
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed;
  }

  // Cookie-style pair: pull `kimi-auth=<value>` out of the blob.
  const match = trimmed.match(/(?:^|[\s;])kimi-auth=([^;\s]+)/);
  if (match) return match[1];

  // Last resort: a `Bearer <jwt>` pasted without the header label.
  const bearer = trimmed.match(/bearer\s+(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i);
  if (bearer) return bearer[1];

  return "";
}

export const NEXT_AUTH_SESSION_COOKIE = "__Secure-next-auth.session-token";
const NEXT_AUTH_SESSION_FAMILY_RE = /^__Secure-next-auth\.session-token(?:\.(\d+))?$/;

/**
 * Build the Cookie header for a NextAuth session (chatgpt.com, perplexity.ai)
 * from whatever the user pasted.
 *
 * NextAuth splits a session cookie larger than ~4KB into chunks named
 * `__Secure-next-auth.session-token.0`, `.1`, ... The server reassembles them
 * itself, so each chunk is sent back under its own name, ordered by index.
 *
 * Accepts:
 *   - a bare token value (sent as the unchunked cookie)
 *   - `name=value` for the unchunked cookie or any chunk
 *   - a full Cookie header (`Cookie:` prefix optional), chunks in any order
 *
 * When chunks are present a stale unchunked cookie is dropped. Other pasted
 * cookies (cf_clearance, __cf_bm, ...) are kept after the session cookies.
 * Returns "" when no session cookie can be found.
 * @param {string} rawValue
 * @returns {string}
 */
export function buildNextAuthSessionCookie(rawValue) {
  const trimmed = stripCookieInputPrefix(rawValue);
  if (!trimmed) return "";

  const pairs = trimmed.split(";").map((part) => {
    const eq = part.indexOf("=");
    return eq < 0 ? null : [part.slice(0, eq).trim(), part.slice(eq + 1).trim()];
  }).filter((pair) => pair && pair[0] && pair[1]);

  const chunks = [];
  let single = "";
  const others = [];
  for (const [name, value] of pairs) {
    const match = name.match(NEXT_AUTH_SESSION_FAMILY_RE);
    if (!match) others.push(`${name}=${value}`);
    else if (match[1] === undefined) single = value;
    else chunks.push([Number(match[1]), value]);
  }

  // No session cookie by name: a single opaque value is the bare token (kept
  // verbatim, `=` padding included, as stored connections always were); a
  // multi-cookie header without one is unusable.
  if (!chunks.length && !single) {
    if (trimmed.includes(";") || /\s/.test(trimmed)) return "";
    return `${NEXT_AUTH_SESSION_COOKIE}=${trimmed}`;
  }

  const session = chunks.length
    ? chunks.sort((a, b) => a[0] - b[0]).map(([i, v]) => `${NEXT_AUTH_SESSION_COOKIE}.${i}=${v}`)
    : [`${NEXT_AUTH_SESSION_COOKIE}=${single}`];
  return [...session, ...others].join("; ");
}

/**
 * Merge rotated session-token cookies from a Set-Cookie response into the
 * stored cookie blob. Every other stored cookie (cf_clearance, __cf_bm, ...)
 * is kept, since Cloudflare needs them on later requests.
 *
 * Rotation can change the shape (unchunked to chunked or back), so every old
 * `__Secure-next-auth.session-token[.N]` entry is dropped before the refreshed
 * set is appended; keeping a stale variant beside the new one could make the
 * server read the old value.
 *
 * Returns the new blob, or null when nothing rotated.
 * @param {string} originalCookie
 * @param {string|null|undefined} setCookieHeader
 * @returns {string|null}
 */
export function mergeRefreshedCookie(originalCookie, setCookieHeader) {
  if (!setCookieHeader) return null;
  const matches = Array.from(
    setCookieHeader.matchAll(/(__Secure-next-auth\.session-token(?:\.\d+)?)=([^;,\s]+)/g)
  );
  if (matches.length === 0) return null;

  const refreshed = new Map(matches.map((m) => [m[1], m[2]]));
  const blob = stripCookieInputPrefix(originalCookie);

  // A bare stored value was the session-token contents on their own.
  if (!blob.includes("=")) {
    return Array.from(refreshed, ([k, v]) => `${k}=${v}`).join("; ");
  }

  const result = [];
  let mutated = false;
  let droppedStale = false;
  for (const pair of blob.split(/;\s*/).filter(Boolean)) {
    const eq = pair.indexOf("=");
    if (eq < 0) {
      result.push(pair);
      continue;
    }
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1);
    if (NEXT_AUTH_SESSION_FAMILY_RE.test(name)) {
      if (refreshed.get(name) !== value) mutated = true;
      droppedStale = true;
      continue;
    }
    result.push(`${name}=${value}`);
  }
  for (const [name, value] of refreshed) result.push(`${name}=${value}`);
  if (!droppedStale) mutated = true;
  return mutated ? result.join("; ") : null;
}
