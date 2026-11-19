/**
 * Bound in-flight async work for LAN discovery probes (#2025).
 */

export const MAX_IN_FLIGHT = 32;

/**
 * Run `tasks` with at most `limit` promises in flight at once.
 * Results keep input order; a rejected task rejects the whole batch.
 *
 * @template T
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} [limit]
 * @returns {Promise<T[]>}
 */
export async function mapWithConcurrency(tasks, limit = MAX_IN_FLIGHT) {
  const max = Math.max(1, Number(limit) || 1);
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from({ length: Math.min(max, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
