import { getAdapter, getAdapterSync } from "../driver.js";

/** Aggregate attributed model usage and separately report unattributed usage within the requested window. */
export async function getComboUsageReport({ lower, upper, upperExclusive }) {
  const params = [];
  const bounds = [];
  if (lower) { bounds.push("timestamp >= ?"); params.push(lower.toISOString()); }
  bounds.push(`timestamp ${upperExclusive ? "<" : "<="} ?`);
  params.push(upper.toISOString());
  const boundsSql = `AND ${bounds.join(" AND ")}`;
  const db = await getAdapter();
  const groups = db.all(
    `SELECT comboId, comboName, connectionId, provider, model, COUNT(*) AS requests,
      COALESCE(SUM(promptTokens), 0) AS promptTokens,
      COALESCE(SUM(completionTokens), 0) AS completionTokens,
      COALESCE(SUM(cost), 0) AS cost
     FROM usageHistory
     WHERE comboId IS NOT NULL AND comboName IS NOT NULL ${boundsSql}
     GROUP BY comboId, comboName, connectionId, provider, model
     ORDER BY lower(comboName), connectionId, provider, model`, params,
  );
  const unattributed = db.get(
    `SELECT COUNT(*) AS requests,
      COALESCE(SUM(promptTokens), 0) AS promptTokens,
      COALESCE(SUM(completionTokens), 0) AS completionTokens,
      COALESCE(SUM(cost), 0) AS cost
     FROM usageHistory
     WHERE (comboId IS NULL OR comboName IS NULL) ${boundsSql}`, params,
  );
  return { groups, unattributed };
}

const LAST_RUN_META_KEY = "dataRetentionLastRun";

/** Read and write the retention job's last result in metadata. */
export async function getRetentionLastRun() {
  const db = await getAdapter();
  const row = db.get("SELECT value FROM _meta WHERE key = ?", [LAST_RUN_META_KEY]);
  return row?.value ? JSON.parse(row.value) : null;
}

export async function saveRetentionLastRun(result) {
  const db = await getAdapter();
  db.run("INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [LAST_RUN_META_KEY, JSON.stringify(result)]);
}

/** Resolve an event's secret to its stable key id without changing synchronous event handling. */
export function findApiKeyIdSync(apiKey) {
  return getAdapterSync().get("SELECT id FROM apiKeys WHERE key = ?", [apiKey])?.id || null;
}

/** Check the job's billing epoch inside the adapter transaction. */
export async function assertVideoBillingEpoch(epoch) {
  const db = await getAdapter();
  const { assertBillingEpochSync } = await import("./usageRepo.js");
  db.transaction(() => assertBillingEpochSync(db, epoch));
}
