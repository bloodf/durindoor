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
 * an already-started refresh or its persistence. Fallback persistence is owned
 * by this helper via `onCredentialsRefreshed`; injected refreshers persist themselves.
 *
 * @returns {Promise<object|null>} Credentials to merge before retrying, or null.
 */
export async function refreshMediaCredentials({ provider, executor, credentials, refreshCredentials, log, proxyOptions, signal = null, onCredentialsRefreshed }) {
  if (signal?.aborted) throw requestAbortError(signal.reason);
  if (isFunction(refreshCredentials)) {
    return signal ? raceCallerAbort(refreshCredentials({ signal }), signal) : refreshCredentials();
  }
  if (provider === "antigravity" || provider === "agy") return null;
  if (!isFunction(executor?.refreshCredentials)) return null;
  // Persist inside the detached operation: a caller leaving must not discard rotation.
  let persistenceError;
  const run = async () => {
    const refreshed = await executor.refreshCredentials(credentials, log, proxyOptions);
    if ((refreshed?.accessToken || refreshed?.apiKey) && onCredentialsRefreshed) {
      try { await onCredentialsRefreshed(refreshed); }
      catch (error) { persistenceError = error; }
    }
    return refreshed;
  };
  const refreshed = await (signal ? refreshWithRetry(run, 3, log, { signal }) : refreshWithRetry(run, 3, log));
  // A failed save must not retry an already-successful token rotation.
  if (persistenceError) throw persistenceError;
  return refreshed;
}
