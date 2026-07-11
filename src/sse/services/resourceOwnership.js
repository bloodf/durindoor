import { getApiKeyByKey, getSettings } from "@/lib/localDb";
import { isApiKeyExpired } from "@/shared/utils/apiKeyExpiry";
import { extractApiKey, hasValidCliToken } from "./auth.js";

/** Resolve the stable owner used by local Files/Batches resources. */
export async function resolveResourceOwner(request) {
  if (await hasValidCliToken(request)) {
    return { authorized: true, ownerId: "operator", allowAllOwners: true };
  }
  const secret = extractApiKey(request);
  if (!secret) {
    const settings = await getSettings();
    return settings.requireApiKey === true
      ? { authorized: false, ownerId: null, allowAllOwners: false }
      : { authorized: true, ownerId: "local", allowAllOwners: false };
  }
  const record = await getApiKeyByKey(secret);
  if (!record) {
    // Match the rest of the API surface: local placeholder credentials remain
    // compatible only while global key enforcement is disabled. Remote
    // unknown credentials are rejected by the dashboard proxy before routing.
    const settings = await getSettings();
    return settings.requireApiKey === true
      ? { authorized: false, ownerId: null, allowAllOwners: false }
      : { authorized: true, ownerId: "local", allowAllOwners: false };
  }
  if (record.isActive !== true || isApiKeyExpired(record.expiresAt)) {
    return { authorized: false, ownerId: null, allowAllOwners: false };
  }
  return { authorized: true, ownerId: record.id, allowAllOwners: false };
}
