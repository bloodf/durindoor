import { getProviderConnections } from "@/lib/localDb";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { getProviderCredentials } from "../auth.js";

/**
 * Whether a stored account outside `excludeConnectionIds` could serve this request
 * now. Nothing is selected: the probe runs the selector's own filters and stops
 * before the pick, so no account is stamped, counted or reserved. With no other
 * active row there is nothing to filter, and the selector is not run.
 */
export async function hasAlternateAccount(provider, excludeConnectionIds, model, options = {}) {
  const rows = await getProviderConnections({ provider: resolveProviderId(provider), isActive: true });
  if (!rows.some((row) => !excludeConnectionIds.has(row.id))) return false;
  const probe = await getProviderCredentials(provider, excludeConnectionIds, model, { ...options, probeOnly: true });
  return probe?.alternateAvailable === true;
}
