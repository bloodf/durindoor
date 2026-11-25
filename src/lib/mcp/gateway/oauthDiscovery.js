// OAuth 2.0 discovery helpers for upstream MCP servers (RFC 9728 + 8414).

import { guardedProbeFetch } from "open-sse/utils/outboundUrlGuard.js";
import { isRecord } from "./guards";
import { isString } from "../../../shared/utils/typeChecks.js";

const META_PATHS = [
"/.well-known/oauth-protected-resource",
"/.well-known/oauth-authorization-server"];

const MAX_REDIRECT_HOPS = 5;


function safeParse(s) {
  if (!s) return null;
  try {return JSON.parse(s);} catch {return null;}
}

// The upstream server picks every discovery URL, so each hop (redirects
// included) goes through the guarded, DNS-pinned fetch.
async function tryFetchJson(url, timeoutMs = 8000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let current = new URL(url);
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const res = await guardedProbeFetch(current.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: ac.signal
      });
      if (!(res.status >= 300 && res.status < 400)) {
        return res.ok ? await res.json() : null;
      }
      const location = res.headers.get("location");
      if (!location) return null;
      current = new URL(location, current);
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse a `WWW-Authenticate` Bearer challenge for the
 * `resource_metadata="<url>"` parameter.
 * @param {unknown} wwwAuth
 * @returns {string | null}
 */
export function parseResourceMetadataFromChallenge(wwwAuth) {
  if (!wwwAuth || !isString(wwwAuth)) return null;
  const m = wwwAuth.match(/resource_metadata\s*=\s*"([^"]+)"/i);
  if (m) return m[1];
  const m2 = wwwAuth.match(/resource_metadata\s*=\s*([^\s,]+)/i);
  return m2 ? m2[1] : null;
}

/**
 * Resolve the well-known metadata URL for an authorization server.
 * If the AS URL already targets a well-known endpoint, returns it as-is.
 * Otherwise constructs the standard well-known path from the AS origin.
 * @param {string} asUrl
 * @returns {string | null}
 */
export function resolveWellKnownUrl(asUrl) {
  try {
    const u = new URL(asUrl);
    if (u.pathname.includes("/.well-known/oauth-authorization-server")) return asUrl;
    return new URL("/.well-known/oauth-authorization-server", asUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Walk the OAuth discovery chain.
 * @param {string | undefined} instanceUrl
 * @param {object} [opts]
 * @returns {Promise<object | null>}
 */

export async function discoverAuth(instanceUrl, opts = {}) {
  const challengeUrl = opts.wwwAuthenticate ? parseResourceMetadataFromChallenge(opts.wwwAuthenticate) : null;
  const candidates = [];
  if (challengeUrl) candidates.push(challengeUrl);
  for (const p of META_PATHS) {
    try {candidates.push(new URL(p, instanceUrl).toString());} catch {/* bad base */}
  }

  let resourceDoc = null;
  for (const url of candidates) {
    const j = await tryFetchJson(url);
    if (isRecord(j) && (Array.isArray(j.authorization_servers) || j.authorization_endpoint)) {
      resourceDoc = { ...j, _source: url };
      break;
    }
  }
  if (!resourceDoc) return null;

  const authServers = resourceDoc.authorization_servers;
  const asList = Array.isArray(authServers) && authServers.length > 0 ?
  authServers :
  [new URL("/.well-known/oauth-authorization-server", instanceUrl).toString()];

  for (const asUrl of asList) {
    const wellKnown = resolveWellKnownUrl(asUrl);
    if (!wellKnown) continue;
    const meta = await tryFetchJson(wellKnown);
    if (isRecord(meta) && (meta.authorization_endpoint || meta.token_endpoint)) {
      return {
        ...meta,
        // Preserve registration_endpoint from the protected-resource doc if the
        // AS well-known doc does not advertise one (RFC 8414 does not require it).
        registration_endpoint: meta.registration_endpoint || resourceDoc.registration_endpoint,
        resource: resourceDoc.resource || instanceUrl,
        authorization_servers: asList,
        _discovery: { protectedResource: resourceDoc._source, as: wellKnown }
      };
    }
  }
  return null;
}

export { safeParse };