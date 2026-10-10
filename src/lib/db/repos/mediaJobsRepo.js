import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { isString } from "../../../shared/utils/typeChecks.js";
import { assertBillingEpochSync, getBillingEpochSync } from "./usageRepo.js";

const SCOPE = "mediaJobs";
const jobKey = ({ modality = "video", provider, connectionId, resourceId }) => {
  if (![provider, connectionId, resourceId].every((value) => isString(value) && value.trim())) {
    throw new TypeError("Media jobs require provider, connection and resource identity");
  }
  if (!["video", "music"].includes(modality)) throw new TypeError("Unsupported media job modality");
  return JSON.stringify([modality, provider, connectionId, resourceId]);
};

/** Canonical job state only; accounting belongs exclusively to usageHistory.
 * No caller secrets or provider credentials are persisted here. Missing ownership
 * fails closed, including legacy jobs created before durable ownership existed.
 * Music uses an explicit namespace; omitted modality preserves legacy video keys.
 */
export async function getMediaJob(identity, apiKeyId) {
  if (!apiKeyId) return null;
  const db = await getAdapter();
  const row = db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", [SCOPE, jobKey(identity)]);
  const job = row ? parseJson(row.value, null) : null;
  return job?.apiKeyId === apiKeyId && (job.billingEpoch ?? null) === getBillingEpochSync(db) ? job : null;
}

export async function createMediaJob({ modality = "video", provider, connectionId, resourceId, apiKeyId, model, endpoint, usageEventId, billingEpoch }) {
  if (![apiKeyId, model, endpoint, usageEventId].every((value) => isString(value) && value.trim())) {
    throw new TypeError("Media jobs require durable ownership and billing identity");
  }
  const job = { provider, connectionId, resourceId, apiKeyId, model, endpoint, usageEventId, billingEpoch: billingEpoch ?? null, createdAt: new Date().toISOString() };
  if (modality === "music") job.modality = modality;
  const db = await getAdapter();
  const key = jobKey(job);
  db.transaction(() => {
    assertBillingEpochSync(db, billingEpoch);
    db.run("INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO NOTHING", [SCOPE, key, stringifyJson(job)]);
  });
  const stored = await getMediaJob(job, apiKeyId);
  if (!stored || stored.model !== model || stored.endpoint !== endpoint) throw new Error("Conflicting media job identity");
  return stored;
}

/** First terminal observation wins using a cross-process compare-and-swap.
 * Persist evidence and its client response before ledger commit so interrupted
 * polls replay the same result without upstream access. Never consume this state:
 * it is not a paid flag, and every successful poll retries the idempotent ledger.
 */
export async function finishMediaJob(identity, apiKeyId, terminal) {
  const db = await getAdapter();
  const key = jobKey(identity);
  db.transaction(() => {
    // The caller carries the job read before upstream polling, not a fresh stamp.
    assertBillingEpochSync(db, identity.billingEpoch);
    const row = db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", [SCOPE, key]);
    const job = row ? parseJson(row.value, null) : null;
    if (!apiKeyId || job?.apiKeyId !== apiKeyId) throw new Error("Media job ownership is unavailable");
    assertBillingEpochSync(db, job.billingEpoch);
    if (!job.terminal) {
      if (!["succeeded", "failed"].includes(terminal?.status)) throw new TypeError("Invalid media terminal state");
      db.run("UPDATE kv SET value = ? WHERE scope = ? AND key = ? AND value = ?", [
        stringifyJson({ ...job, terminal: { ...terminal, timestamp: new Date().toISOString() } }), SCOPE, key, row.value,
      ]);
    }
  });
  return getMediaJob(identity, apiKeyId);
}
