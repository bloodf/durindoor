import { getAdapter } from "@/lib/db/driver.js";
import { getSettings } from "@/lib/db/repos/settingsRepo.js";
import { pruneUsageOlderThan } from "@/lib/db/repos/usageRepo.js";
import { pruneRequestDetailsOlderThan } from "@/lib/db/repos/requestDetailsRepo.js";
import { pruneTimelineOlderThan } from "@/lib/db/repos/proxyTimelineRepo.js";
import { pruneProviderQuotaSnapshots } from "@/lib/db/repos/quotaSnapshotsRepo.js";

export const DATA_RETENTION_PRESET_DAYS = Object.freeze([7, 15, 30, 60, 90]);
export const DATA_RETENTION_MIN_DAYS = 1;
export const DATA_RETENTION_MAX_DAYS = 3650;
const LAST_RUN_META_KEY = "dataRetentionLastRun";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Integer day count within the supported window, or null. */
export function normalizeRetentionDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days)) return null;
  if (days < DATA_RETENTION_MIN_DAYS || days > DATA_RETENTION_MAX_DAYS) return null;
  return days;
}

export async function getDataRetentionLastRun() {
  try {
    const db = await getAdapter();
    const row = db.get("SELECT value FROM _meta WHERE key = ?", [LAST_RUN_META_KEY]);
    return row?.value ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

async function saveLastRun(result) {
  const db = await getAdapter();
  db.run(
    "INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [LAST_RUN_META_KEY, JSON.stringify(result)],
  );
}

/**
 * Delete every locally stored record older than `days`: usage history and
 * daily rollups, token-saver events, request details, proxy-timeline traces
 * and provider quota snapshots. Each store is pruned independently so one
 * failure never blocks the others; failures are reported per store.
 */
export async function runDataRetention({ days, now = Date.now(), trigger = "manual" } = {}) {
  const retentionDays = normalizeRetentionDays(days);
  if (retentionDays === null) throw new Error(`Invalid retention days: ${days}`);
  const cutoffMs = now - retentionDays * DAY_MS;
  const cutoffIso = new Date(cutoffMs).toISOString();
  const deleted = {};
  const errors = {};

  const steps = [
    ["usage", () => pruneUsageOlderThan(cutoffMs)],
    ["requestDetails", () => pruneRequestDetailsOlderThan(cutoffIso)],
    ["timeline", () => pruneTimelineOlderThan(cutoffIso)],
    ["quotaSnapshots", async () => {
      const result = await pruneProviderQuotaSnapshots({ now, retentionMs: retentionDays * DAY_MS });
      return Number.isFinite(result?.deleted) ? result.deleted : Number(result) || 0;
    }],
  ];
  for (const [name, step] of steps) {
    try {
      deleted[name] = await step();
    } catch (error) {
      errors[name] = error?.message || String(error);
    }
  }

  const result = {
    ranAt: new Date(now).toISOString(),
    trigger,
    days: retentionDays,
    cutoff: cutoffIso,
    deleted,
    errors: Object.keys(errors).length ? errors : undefined,
  };
  try {
    await saveLastRun(result);
  } catch (error) {
    console.error("[data-retention] failed to persist last run:", error?.message || error);
  }
  return result;
}

/** Run the retention job only when the operator enabled it in settings. */
export async function runDataRetentionIfEnabled({ now = Date.now(), trigger = "scheduled" } = {}) {
  const settings = await getSettings();
  if (settings?.dataRetentionEnabled !== true) return null;
  const days = normalizeRetentionDays(settings.dataRetentionDays);
  if (days === null) return null;
  return runDataRetention({ days, now, trigger });
}
