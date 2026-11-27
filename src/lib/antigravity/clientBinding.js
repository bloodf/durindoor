import { createHash } from "node:crypto";
import { isObject, isString } from "../../shared/utils/typeChecks.js";

// Records which configured OAuth client issued an Antigravity/agy refresh
// token, so a token is never refreshed under a different client. Idea from
// OmniRoute src/lib/oauth/providers/antigravity.ts (9671192011), which stores
// the issuing client profile. Only a digest of the public client ID is kept;
// the client secret is never read here.
export const CLIENT_BINDING_KEY = "oauthClientBinding";
const VERSION = "v1";

/** `v1:<sha256 hex of the trimmed client ID>`, or null when no client ID is configured. */
export function clientBindingFor(clientId) {
  const trimmed = isString(clientId) ? clientId.trim() : "";
  if (!trimmed) return null;
  return `${VERSION}:${createHash("sha256").update(trimmed, "utf8").digest("hex")}`;
}

/** Returns providerSpecificData with the binding for `clientId`. Unchanged when no client is configured. */
export function withClientBinding(providerSpecificData, clientId) {
  const binding = clientBindingFor(clientId);
  const base = isObject(providerSpecificData) && !Array.isArray(providerSpecificData) ? providerSpecificData : {};
  if (!binding) return base;
  return { ...base, [CLIENT_BINDING_KEY]: binding };
}

/**
 * "unmarked" for legacy rows (keep existing refresh behavior), "match" when the
 * stored binding equals the current client, otherwise "mismatch". An empty
 * current client ID never matches a marked row.
 */
export function clientBindingStatus(providerSpecificData, currentClientId) {
  const stored = isObject(providerSpecificData) ? providerSpecificData[CLIENT_BINDING_KEY] : undefined;
  if (stored === undefined || stored === null || stored === "") return "unmarked";
  const current = clientBindingFor(currentClientId);
  return current && stored === current ? "match" : "mismatch";
}
