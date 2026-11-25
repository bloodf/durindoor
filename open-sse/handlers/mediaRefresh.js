import { refreshWithRetry } from "../services/tokenRefresh.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

/**
 * Reactive 401/403 credential refresh for media handlers.
 *
 * A caller-injected `refreshCredentials` owns dispatch and persistence (the
 * Antigravity connection-bound lease, #2313) and is used as-is. Without one,
 * Antigravity is never refreshed here: a direct executor refresh would bypass
 * the lease. Every other provider keeps the executor refresh with retries.
 *
 * @returns {Promise<object|null>} Credentials to merge before retrying, or null.
 */
export async function refreshMediaCredentials({ provider, executor, credentials, refreshCredentials, log, proxyOptions }) {
  if (isFunction(refreshCredentials)) return refreshCredentials();
  if (provider === "antigravity" || provider === "agy") return null;
  if (!isFunction(executor?.refreshCredentials)) return null;
  return refreshWithRetry(() => executor.refreshCredentials(credentials, log, proxyOptions), 3, log);
}
