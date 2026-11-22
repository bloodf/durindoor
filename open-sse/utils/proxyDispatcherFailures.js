// Per-proxy failure streaks. A pooled keep-alive dispatcher whose proxy was
// restarted or wedged keeps failing until it is replaced, so after
// PROXY_DISPATCHER_EVICT_THRESHOLD failures inside PROXY_DISPATCHER_FAILURE_WINDOW_MS
// the caller evicts that proxy's cached dispatcher. A success resets the streak.
// Port of OmniRoute #20877 (per-proxy dispatcher eviction).
export const PROXY_DISPATCHER_EVICT_THRESHOLD = 3;
export const PROXY_DISPATCHER_FAILURE_WINDOW_MS = 60_000;
export const MAX_PROXY_FAILURE_STREAKS = 1024;

const streaks = new Map();

export function __resetProxyDispatcherFailuresForTest() {
  streaks.clear();
}

export function __proxyFailureStreakSizeForTest() {
  return streaks.size;
}

export function recordProxyDispatcherSuccess(key) {
  if (key) streaks.delete(key);
}

/** Record a failure; returns true when the streak reached the eviction threshold. */
export function recordProxyDispatcherFailure(key, now = Date.now()) {
  if (!key) return false;
  for (const [k, stamps] of streaks) {
    const recent = stamps.filter((ts) => now - ts <= PROXY_DISPATCHER_FAILURE_WINDOW_MS);
    if (recent.length === 0) streaks.delete(k);
    else if (recent.length !== stamps.length) streaks.set(k, recent);
  }
  const recent = [...(streaks.get(key) ?? []), now];
  streaks.delete(key);
  if (recent.length >= PROXY_DISPATCHER_EVICT_THRESHOLD) return true;
  while (streaks.size >= MAX_PROXY_FAILURE_STREAKS) {
    const oldest = streaks.keys().next().value;
    if (oldest === undefined) break;
    streaks.delete(oldest);
  }
  streaks.set(key, recent);
  return false;
}
