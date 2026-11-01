import { getSettings } from "@/lib/localDb";
import { resolveClientApiKey } from "./auth.js";

/**
 * Resolve Files/Batches ownership from the accepted authentication principal.
 * Native handlers pass their already-resolved auth; callers without one use the
 * same credential precedence. The optional auth is internal, never request data.
 */
export async function resolveResourceOwner(request, auth) {
  if (auth === undefined) {
    const settings = await getSettings();
    ({ auth } = await resolveClientApiKey(request, { required: settings.requireApiKey === true }));
  }
  if (!auth.ok) return { authorized: false, ownerId: null, allowAllOwners: false };
  if (auth.operator) return { authorized: true, ownerId: "operator", allowAllOwners: true };
  return { authorized: true, ownerId: auth.stored ? auth.apiKeyId : "local", allowAllOwners: false };
}
