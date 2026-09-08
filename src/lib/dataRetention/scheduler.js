import { runDataRetentionIfEnabled } from "./runner.js";

export const DATA_RETENTION_INTERVAL_MS = 60 * 60 * 1000;
export const DATA_RETENTION_INITIAL_DELAY_MS = 60 * 1000;

async function tick() {
  try {
    const result = await runDataRetentionIfEnabled({ trigger: "scheduled" });
    if (!result) return;
    const summary = Object.entries(result.deleted)
      .map(([store, count]) => `${store}=${count}`)
      .join(" ");
    console.log(`[data-retention] pruned data older than ${result.days}d: ${summary}`);
    if (result.errors) console.error("[data-retention] partial failure:", result.errors);
  } catch (error) {
    console.error("[data-retention] run failed:", error?.message || error);
  }
}

/**
 * Hourly retention sweep. The global guard keeps dev-mode module reloads from
 * stacking timers; `unref` keeps the timer from holding the process open.
 */
export function startDataRetentionScheduler({
  intervalMs = DATA_RETENTION_INTERVAL_MS,
  initialDelayMs = DATA_RETENTION_INITIAL_DELAY_MS,
} = {}) {
  if (global._dataRetentionScheduler) return global._dataRetentionScheduler;
  const initial = setTimeout(tick, initialDelayMs);
  initial.unref?.();
  const interval = setInterval(tick, intervalMs);
  interval.unref?.();
  global._dataRetentionScheduler = { initial, interval };
  console.log(`[data-retention] scheduler started (every ${Math.round(intervalMs / 60000)} min)`);
  return global._dataRetentionScheduler;
}

export function stopDataRetentionScheduler() {
  const handle = global._dataRetentionScheduler;
  if (!handle) return;
  clearTimeout(handle.initial);
  clearInterval(handle.interval);
  global._dataRetentionScheduler = null;
}
