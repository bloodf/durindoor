// Dynamic client registration (RFC 7591) for upstream MCP OAuth.

import { guardedProbeFetch, OutboundUrlGuardError } from "open-sse/utils/outboundUrlGuard.js";
import { isRecord } from "./guards";

const TIMEOUT_MS = 10_000;
const MAX_REDIRECT_HOPS = 10;

// Guarded, DNS-pinned POST. Only same-origin redirects are followed (the same
// rule as doRefresh). Errors never carry upstream-chosen URLs or bodies.
async function postRegistration(endpoint, init) {
  let currentUrl;
  try {
    currentUrl = new URL(endpoint);
  } catch {
    throw new Error("registration endpoint is not a valid URL");
  }
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    let res;
    try {
      res = await guardedProbeFetch(currentUrl.toString(), init);
    } catch (err) {
      if (err instanceof OutboundUrlGuardError) {
        throw new Error("registration endpoint blocked by the outbound URL guard");
      }
      throw err;
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    const next = new URL(location, currentUrl);
    if (next.origin !== currentUrl.origin) {
      throw new Error("registration redirect crossed origin");
    }
    currentUrl = next;
  }
  throw new Error("registration exceeded the redirect limit");
}

/**
 * Register a public OAuth client with the upstream authorization server.
 * @param {string | null | undefined} registrationEndpoint
 * @param {string} redirectUri
 * @param {object} [opts]
 * @returns {Promise<{clientId: string, clientSecret: string | null, clientIdIssuedAt: number}>}
 */
export async function registerClient(registrationEndpoint, redirectUri, opts = {}) {
  if (!registrationEndpoint) {
    throw new Error("no registration_endpoint available");
  }
  const body = {
    client_name: opts.clientName || "9router-mcp-gateway",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await postRegistration(registrationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`registration failed with status ${res.status}`);
    }
    const doc = await res.json().catch(() => null);
    if (!isRecord(doc) || !doc.client_id) {
      throw new Error("registration response missing client_id");
    }
    return {
      clientId: String(doc.client_id),
      clientSecret: doc.client_secret ? String(doc.client_secret) : null,
      clientIdIssuedAt: doc.client_id_issued_at || Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}
