import { resolveCredentialProxyOptions } from "open-sse/services/oauthCredentialManager.js";
import { refreshAntigravityConnection } from "@/shared/services/providerCredentials.js";
import { isAntigravityProvider } from "@/lib/antigravity/refreshProtocol";
import { projectProviderCredentials } from "../../services/auth.js";

/**
 * Media-route refresher for a stored Antigravity connection. The refresh runs
 * and commits under the connection-bound lease (#2313); the core merges the
 * returned stored credentials and retries without persisting them again.
 * Other providers and unstored credentials get no injected refresher. A failed
 * lease or refresh leaves the original upstream authentication error intact.
 *
 * @param {object} credentials Credentials dispatched for this attempt.
 * @returns {(() => Promise<object|null>)|undefined}
 */
export function leasedAntigravityRefresher(credentials) {
  const connection = credentials?._connection;
  if (!connection || !isAntigravityProvider(connection.provider)) return undefined;
  return async () => {
    try {
      const current = await refreshAntigravityConnection(connection, resolveCredentialProxyOptions(credentials));
      return current ? await projectProviderCredentials(current, credentials._quotaPreflight ?? null) : null;
    } catch {
      return null;
    }
  };
}
