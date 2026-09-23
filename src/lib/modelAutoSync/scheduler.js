import { getSettings } from "@/lib/localDb";
import { getModelAutoSyncIntervalHours } from "./catalog.js";
import { runModelAutoSync } from "./runner.js";

// The tick is hourly; each provider syncs once its last attempt is older than
// `modelAutoSyncIntervalHours`, so an interval change applies without restart.
export const MODEL_AUTO_SYNC_TICK_MS = 60 * 60 * 1000;
export const MODEL_AUTO_SYNC_INITIAL_DELAY_MS = 30 * 1000;

export async function modelAutoSyncTick() {
  try {
    const settings = await getSettings();
    if (getModelAutoSyncIntervalHours(settings) === 0) return [];
    return await runModelAutoSync();
  } catch (error) {
    console.error("[model-auto-sync] run failed:", error?.message || error);
    return [];
  }
}

/**
 * Start the model auto-sync timer: one run shortly after boot, then hourly.
 * The global guard keeps dev-mode module reloads from stacking timers; `unref`
 * keeps the timer from holding the process open.
 */
export function startModelAutoSyncScheduler({
  intervalMs = MODEL_AUTO_SYNC_TICK_MS,
  initialDelayMs = MODEL_AUTO_SYNC_INITIAL_DELAY_MS,
} = {}) {
  if (global._modelAutoSyncScheduler) return global._modelAutoSyncScheduler;
  const initial = setTimeout(modelAutoSyncTick, initialDelayMs);
  initial.unref?.();
  const interval = setInterval(modelAutoSyncTick, intervalMs);
  interval.unref?.();
  global._modelAutoSyncScheduler = { initial, interval };
  return global._modelAutoSyncScheduler;
}

export function stopModelAutoSyncScheduler() {
  const handle = global._modelAutoSyncScheduler;
  if (!handle) return;
  clearTimeout(handle.initial);
  clearInterval(handle.interval);
  global._modelAutoSyncScheduler = null;
}
