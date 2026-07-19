/** Runs polling only while the document is visible and spreads client load with jitter. */
export function createVisiblePoller({ callback, intervalMs, jitter = 0.1, documentRef = document, random = Math.random }) {
  let timer;
  const schedule = () => {
    clearTimeout(timer);
    if (documentRef.hidden) return;
    const delay = Math.round(intervalMs * (1 + (random() * 2 - 1) * jitter));
    timer = setTimeout(async () => {
      await callback();
      schedule();
    }, delay);
  };
  const onVisibility = () => {
    if (!documentRef.hidden) void callback();
    schedule();
  };
  return {
    start() {
      documentRef.addEventListener("visibilitychange", onVisibility);
      schedule();
    },
    stop() {
      clearTimeout(timer);
      documentRef.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
