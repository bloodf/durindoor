export const OAUTH_CALLBACK_FRESHNESS_MS = 30_000;

/** Build the explicit browser-to-server routing contract for a new flow. */
export function oauthProxySelection(proxyPoolId) {
  return proxyPoolId
    ? { proxyMode: "strict-pool", proxyPoolId }
    : { proxyMode: "direct" };
}

/**
 * Owns the transient resources for one browser OAuth attempt.
 *
 * React components keep this object in a ref. Starting a new attempt cancels
 * the old AbortController, timers, and popup synchronously, which makes every
 * async continuation able to reject stale work with `isActive(flow)`.
 */
export function createOAuthFlowLifecycle({
  now = () => Date.now(),
  createAbortController = () => new AbortController(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
  createOwnerId = () => globalThis.crypto?.randomUUID?.() || `oauth-${Date.now()}-${Math.random()}`,
} = {}) {
  let generation = 0;
  let activeFlow = null;
  const ownerId = createOwnerId();

  function releaseResources(flow, reason) {
    if (!flow || flow.resourcesReleased) return;
    flow.resourcesReleased = true;
    flow.controller.abort(reason);
    for (const [timer, resolve] of flow.timers) {
      clearTimer(timer);
      resolve(false);
    }
    flow.timers.clear();
    try {
      if (flow.popup && !flow.popup.closed) flow.popup.close();
    } catch {
      // Cross-origin popup access can throw. Cancellation must remain fail-safe.
    }
    flow.popup = null;
  }

  function cancel(reason = "cancelled") {
    const previous = activeFlow;
    if (!previous) return null;
    activeFlow = null;
    releaseResources(previous, reason);
    return previous;
  }

  function begin(metadata = {}) {
    const previous = cancel("superseded");
    const flow = {
      ...metadata,
      ownerId,
      generation: ++generation,
      createdAt: now(),
      expectedState: null,
      callbackClaimed: false,
      settled: false,
      resourcesReleased: false,
      controller: createAbortController(),
      timers: new Map(),
      popup: null,
    };
    activeFlow = flow;
    return { flow, previous };
  }

  function current() {
    return activeFlow;
  }

  function isActive(flow) {
    return flow != null
      && activeFlow === flow
      && !flow.settled
      && !flow.controller.signal.aborted;
  }

  function bindState(flow, state) {
    if (!isActive(flow) || typeof state !== "string" || state.length === 0) return false;
    flow.expectedState = state;
    return true;
  }

  function bindPopup(flow, popup) {
    if (!isActive(flow)) {
      try {
        if (popup && !popup.closed) popup.close();
      } catch {
        // Best-effort cleanup for a popup created by stale work.
      }
      return false;
    }
    flow.popup = popup || null;
    return true;
  }

  function bindFlowId(flow, flowId) {
    if (!isActive(flow) || typeof flowId !== "string" || flowId.length === 0) return false;
    flow.flowId = flowId;
    return true;
  }

  function wait(flow, delay) {
    if (!isActive(flow)) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimer(() => {
        flow.timers.delete(timer);
        resolve(isActive(flow));
      }, delay);
      flow.timers.set(timer, resolve);
    });
  }

  function hasExactState(flow, data) {
    return isActive(flow)
      && typeof flow.expectedState === "string"
      && flow.expectedState.length > 0
      && data?.state === flow.expectedState;
  }

  function isFresh(flow, data, maxAgeMs = OAUTH_CALLBACK_FRESHNESS_MS) {
    const timestamp = Number(data?.timestamp);
    const receivedAt = now();
    return Number.isFinite(timestamp)
      && timestamp >= flow.createdAt
      && timestamp <= receivedAt
      && receivedAt - timestamp <= maxAgeMs;
  }

  function acceptsCallback(flow, data, { requireFresh = false, maxAgeMs } = {}) {
    if (!hasExactState(flow, data)) return false;
    return !requireFresh || isFresh(flow, data, maxAgeMs);
  }

  function acceptsPostMessage(flow, event, allowedOrigin) {
    return event?.origin === allowedOrigin
      && event?.source === flow?.popup
      && event?.data?.type === "oauth_callback"
      && acceptsCallback(flow, event.data.data);
  }

  function claimCallback(flow, data, options) {
    if (flow?.callbackClaimed || !acceptsCallback(flow, data, options)) return false;
    flow.callbackClaimed = true;
    return true;
  }

  function settle(flow, callback) {
    if (!isActive(flow)) return false;
    flow.settled = true;
    activeFlow = null;
    releaseResources(flow, "settled");
    callback?.();
    return true;
  }

  return {
    acceptsCallback,
    acceptsPostMessage,
    begin,
    bindFlowId,
    bindPopup,
    bindState,
    cancel,
    claimCallback,
    current,
    isActive,
    settle,
    wait,
  };
}
