/**
 * Serializes writes per key while retaining only the newest queued intent.
 * Different keys can progress independently. Callbacks keep UI state outside
 * the queue so the helper is usable from multiple React surfaces.
 */
export function createLatestIntentQueue({ write, onOptimistic, onConfirmed, onRollback }) {
  const desired = new Map();
  const running = new Set();
  const confirmed = new Map();

  function hydrate(entries = []) {
    for (const [key, value] of entries) confirmed.set(key, value === true);
  }

  async function enqueue(key, value, context) {
    desired.set(key, { value: value === true, context });
    onOptimistic(key, value === true, context);
    if (running.has(key)) return;

    running.add(key);
    try {
      while (desired.has(key)) {
        const intent = desired.get(key);
        desired.delete(key);
        onOptimistic(key, intent.value, intent.context);
        try {
          const result = await write(key, intent.value, intent.context);
          const serverValue = result?.enabled === true;
          confirmed.set(key, serverValue);
          if (!desired.has(key)) onConfirmed?.(key, serverValue, intent.context);
        } catch (error) {
          if (!desired.has(key)) {
            onRollback(key, confirmed.get(key) === true, intent.context, error);
          }
        }
      }
    } finally {
      running.delete(key);
    }
  }

  return { enqueue, hydrate };
}
