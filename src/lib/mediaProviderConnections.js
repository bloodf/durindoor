import { getApiKeyByKey, getApiKeyProviderConnectionIds, getProviderConnections } from "@/lib/localDb";
import { extractApiKeyCandidates } from "@/sse/services/auth.js";
import { hasValidCliToken } from "@/dashboardGuard";
import { isApiKeyExpired } from "@/shared/utils/apiKeyExpiry";

/**
 * Active provider connections a media-provider read may use. A key limited to
 * provider accounts sees only those accounts; admin-scoped header keys, the CLI and
 * callers without a key (dashboard session, open local dashboard) see all.
 */
export async function readableProviderConnections(request, provider) {
  const connections = await getProviderConnections({ provider, isActive: true });
  if (await hasValidCliToken(request)) return connections;
  const queryKey = new URL(request.url).searchParams.get("key");
  for (const secret of extractApiKeyCandidates(request)) {
    const key = await getApiKeyByKey(secret);
    if (key?.isActive !== true || isApiKeyExpired(key.expiresAt)) continue;
    // The admin scope counts only for a key sent in a header.
    if (key.isAdmin === true && secret !== queryKey) return connections;
    const allowed = await getApiKeyProviderConnectionIds(key.id);
    return allowed.length ? connections.filter((connection) => allowed.includes(connection.id)) : connections;
  }
  return connections;
}
