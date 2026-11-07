import { isString } from "./typeChecks.js";

/** Freshness of the stored discovery snapshot at render time, not provider health.
 * No timestamp/interval evidence means UNKNOWN, never an assumed fresh catalog.
 */
export function catalogDiscoveryStatus(status, now = Date.now()) {
  const syncedAt = isString(status.syncedAt) ? Date.parse(status.syncedAt) : NaN;
  if (!Number.isFinite(syncedAt) || syncedAt > now) return "UNKNOWN";
  if (status.error) return "STALE. The last discovery attempt failed; the previous snapshot is retained.";
  if (!Number.isFinite(status.intervalHours) || status.intervalHours <= 0) return "UNKNOWN";
  return now - syncedAt >= status.intervalHours * 3600000 ?
    "STALE. The stored snapshot is older than the configured sync interval." :
    "Within the configured sync interval. Availability is not verified.";
}
