// Header allowlist for caller-supplied MCP instance headers.
import { isObject, isString } from "../../../shared/utils/typeChecks.js";
//
// Background: an attacker who can create or update an MCP instance can
// supply arbitrary headers that are then forwarded to the upstream on
// every JSON-RPC POST. Two risks:
//   1. The header is sensitive (Authorization, Cookie, Proxy-Authorization)
//      and would be echoed to the upstream AND, worse, to whatever host a
//      3xx redirect points at (see mcpRequest redirect handling).
//   2. The header is a transport/protocol header that conflicts with the
//      JSON-RPC shape (Content-Type, MCP-Protocol-Version, mcp-session-id).
//
// Only an explicit, small allowlist is forwarded. Everything else is
// dropped at the API boundary (route.js) so the value never reaches the
// httpClient at all.

const ALLOWED_HEADER_NAMES = new Set([
"x-trace-id",
"accept",
"accept-language"]
);

// Names that are ALWAYS stripped even if a future change tries to add
// them to the allowlist. Belt-and-braces for the sensitive-forwards case.
const BLOCKED_HEADER_NAMES = new Set([
"authorization",
"cookie",
"cookie2",
"set-cookie",
"proxy-authorization",
"proxy-authenticate",
"www-authenticate",
"content-type",
"content-length",
"transfer-encoding",
"connection",
"host",
"upgrade",
"expect",
"te",
"trailer"]
);

/**
 * Filter a caller-supplied `instance.headers` object against the
 * allowlist. Returns a NEW object; never mutates the input. Unknown /
 * blocked keys are silently dropped (this is called from a route, the
 * user can re-add them via the UI if they actually need one we allow).
 *
 * Header names are matched case-insensitively per RFC 9110 §5.1.
 *
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function sanitizeInstanceHeaders(raw) {
  if (!raw || !isObject(raw) || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!isString(k)) continue;
    const kl = k.trim().toLowerCase();
    if (!kl) continue;
    if (BLOCKED_HEADER_NAMES.has(kl)) continue;
    if (!ALLOWED_HEADER_NAMES.has(kl)) continue;
    if (v === undefined || v === null) continue;
    const s = isString(v) ? v : String(v);
    // CR/LF injection guard — even on allowlisted names.
    if (/[\r\n]/.test(s)) continue;
    out[kl] = s;
  }
  return out;
}

export const INSTANCE_HEADERS_ALLOWLIST = ALLOWED_HEADER_NAMES;
export const INSTANCE_HEADERS_BLOCKLIST = BLOCKED_HEADER_NAMES;