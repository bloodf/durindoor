import { isObject } from "@/shared/utils/typeChecks.js"; /**
 * A WAL checkpoint can return successfully while reporting `busy > 0`.
 * Safety backups must treat that as a failure because copying data.sqlite at
 * that point may omit committed pages still held in the WAL file.
 */
export function assertCheckpointComplete(result, driver = "sqlite") {
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || !isObject(row)) {
    throw new Error(`[DB][checkpoint] ${driver} returned no status row`);
  }
  const busy = Number(row.busy ?? row.BUSY ?? Object.values(row)[0]);
  if (!Number.isFinite(busy)) {
    throw new Error(`[DB][checkpoint] ${driver} returned an invalid busy status`);
  }
  if (busy !== 0) {
    throw new Error(`[DB][checkpoint] ${driver} WAL checkpoint is busy`);
  }
  return row;
}