import { createHash } from "node:crypto";
import { ANTIGRAVITY_OAUTH_CLIENT } from "../providers/shared.js";

// Records which configured OAuth client issued an Antigravity/agy refresh
// token, so a token is never refreshed under a different client. Idea from
// OmniRoute src/lib/oauth/providers/antigravity.ts (9671192011), which stores
// the issuing client profile. Only a digest of the public client ID is kept;
// the client secret is never read here. Lives below open-sse so the gateway
// refresh path can use it without importing from src/.
export const CLIENT_BINDING_KEY = "oauthClientBinding";
const VERSION = "v1";

const isPlainObject = (value) => Object(value) === value && !Array.isArray(value);

/** `v1:<sha256 hex of the trimmed client ID>`, or null when no client ID is configured. */
export function clientBindingFor(clientId) {
  // The client ID comes from an environment string; absent values hash to nothing.
  const trimmed = clientId === undefined || clientId === null ? "" : String(clientId).trim();
  if (!trimmed) return null;
  return `${VERSION}:${createHash("sha256").update(trimmed, "utf8").digest("hex")}`;
}

/** Returns providerSpecificData with the binding for `clientId`. Unchanged when no client is configured. */
export function withClientBinding(providerSpecificData, clientId) {
  const binding = clientBindingFor(clientId);
  const base = isPlainObject(providerSpecificData) ? providerSpecificData : {};
  if (!binding) return base;
  return { ...base, [CLIENT_BINDING_KEY]: binding };
}

/**
 * "unmarked" for legacy rows (keep existing refresh behavior), "match" when the
 * stored binding equals the current client, otherwise "mismatch". An empty
 * current client ID never matches a marked row.
 */
export function clientBindingStatus(providerSpecificData, currentClientId) {
  const stored = providerSpecificData?.[CLIENT_BINDING_KEY];
  if (stored === undefined || stored === null || stored === "") return "unmarked";
  const current = clientBindingFor(currentClientId);
  return current && stored === current ? "match" : "mismatch";
}

/**
 * Refresh preflight: true when a marked antigravity/agy row was issued by a
 * client other than the one configured now (or no client is configured). The
 * caller must stop before any lease acquisition or outbound refresh and
 * report `reauth_required`. Unmarked legacy rows and other providers pass.
 * Reads the configured client at call time; the client itself is fixed when
 * open-sse/providers/shared.js first loads.
 */
export function antigravityClientBindingBlocks(provider, providerSpecificData, currentClientId = ANTIGRAVITY_OAUTH_CLIENT.clientId) {
  if (provider !== "antigravity" && provider !== "agy") return false;
  return clientBindingStatus(providerSpecificData, currentClientId) === "mismatch";
}

/** Error carrying the existing `reauth_required` category and reauth code. Touches no stored state. */
export function antigravityClientBindingError() {
  const error = new Error("This connection was authorized with a different OAuth client. Reconnect this account.");
  error.code = "PROVIDER_REAUTH_REQUIRED";
  error.category = "reauth_required";
  error.status = 409;
  return error;
}
