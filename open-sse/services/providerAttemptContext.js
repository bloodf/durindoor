import { AsyncLocalStorage } from "node:async_hooks";

const providerAttemptStorage = new AsyncLocalStorage();

/** Run one executor invocation with a request-local physical-dispatch clock. */
export function runWithProviderAttemptContext(onProviderAttempt, callback) {
  if (typeof onProviderAttempt !== "function") return callback();
  return providerAttemptStorage.run({ onProviderAttempt, prepared: false, latest: null }, callback);
}

/**
 * Reserve the next physical dispatch clock for code that performs explicit
 * transport setup before calling proxyAwareFetch (notably BaseExecutor).
 */
export function prepareProviderAttemptDispatch() {
  const state = providerAttemptStorage.getStore();
  if (!state) return null;
  const allocated = state.onProviderAttempt();
  if (Number.isSafeInteger(allocated) && allocated > 0) {
    state.latest = allocated;
    state.prepared = true;
    return allocated;
  }
  return null;
}

/** Stamp an actual proxy-aware network dispatch, consuming a reservation once. */
export function markProviderAttemptDispatch() {
  const state = providerAttemptStorage.getStore();
  if (!state) return null;
  if (state.prepared) {
    state.prepared = false;
    return state.latest;
  }
  const allocated = state.onProviderAttempt();
  if (Number.isSafeInteger(allocated) && allocated > 0) state.latest = allocated;
  return state.latest;
}

export function getCurrentProviderAttemptTimestamp() {
  return providerAttemptStorage.getStore()?.latest || null;
}
