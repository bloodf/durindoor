/** Creates monotonic request tokens so only the newest async response may commit UI state. */
export function createLatestRequestGuard() {
  let sequence = 0;
  return {
    begin() {
      const id = ++sequence;
      return {
        isCurrent: () => id === sequence,
        cancel: () => { if (id === sequence) sequence += 1; },
      };
    },
  };
}

/** REST owns period totals; SSE owns these live fields even when it arrived first. */
export function mergeUsageResponse(previous, response, liveOverlay) {
  return { ...(previous || {}), ...(response || {}), ...(liveOverlay || {}) };
}
