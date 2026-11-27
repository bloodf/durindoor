import { refreshWithRetry } from "../services/tokenRefresh.js";
import { raceCallerAbort } from "../executors/base.js";
import { requestAbortError } from "../executors/sendRequest.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

/**
 * Reactive 401/403 credential refresh for media handlers.
 *
 * A caller-injected `refreshCredentials` owns dispatch and persistence (the
 * Antigravity connection-bound lease, #2313) and is used as-is. Without one,
 * Antigravity is never refreshed here: a direct executor refresh would bypass
 * the lease. Every other provider keeps the executor refresh with retries.
 *
 * An optional `signal` makes caller waits abort-responsive without cancelling
 * an already-started refresh or its persistence.
 *
 * @returns {Promise<object|null>} Credentials to merge before retrying, or null.
 */
export async function refreshMediaCredentials({ provider, executor, credentials, refreshCredentials, log, proxyOptions, signal = null }) {
  if (signal?.aborted) throw requestAbortError(signal.reason);
  if (isFunction(refreshCredentials)) {
    return signal ? raceCallerAbort(refreshCredentials({ signal }), signal) : refreshCredentials();
  }
  if (provider === "antigravity" || provider === "agy") return null;
  if (!isFunction(executor?.refreshCredentials)) return null;
  const run = () => executor.refreshCredentials(credentials, log, proxyOptions);
  return signal ? refreshWithRetry(run, 3, log, { signal }) : refreshWithRetry(run, 3, log);
}
