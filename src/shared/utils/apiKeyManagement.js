import { isString } from "./typeChecks.js"; /** Return a stable management label without returning the credential itself. */
export function maskApiKeySecret(secret) {
  if (!isString(secret) || !secret.startsWith("sk-")) return "***";
  // Do not expose suffix bytes: legacy sk-<8 hex> credentials have too little
  // entropy for partial revelation to be a safe management identifier.
  return "sk-••••••••";
}

/**
 * Project a stored API-key record into the list/detail/update response shape.
 * The creation response is intentionally the only route allowed to return the
 * literal secret.
 */
export function toApiKeyManagementView(record) {
  if (!record) return null;
  const { key, ...safe } = record;
  return {
    ...safe,
    maskedKey: maskApiKeySecret(key)
  };
}