import { getAdapter } from "../driver.js";

const ERROR_CASE = "CASE WHEN LOWER(COALESCE(status, 'ok')) IN ('', 'ok', 'success', '200') THEN 0 ELSE 1 END";
const TOTALS = `COUNT(*) AS requests, COALESCE(SUM(promptTokens), 0) AS prompt,
  COALESCE(SUM(completionTokens), 0) AS completion, COALESCE(SUM(cost), 0) AS cost`;

function successRate(requests, errors) {
  return requests > 0 ? Number((((requests - errors) / requests) * 100).toFixed(1)) : null;
}

/** Only scalar totals and the 50 providers rendered by Monitoring leave SQL. */
export async function getMonitoringUsage({ activityStart, healthStart, now = new Date().toISOString() }) {
  const db = await getAdapter();
  const activity = db.get(`SELECT ${TOTALS}, COALESCE(SUM(cachedTokens), 0) AS cachedTokens,
    COALESCE(SUM(${ERROR_CASE}), 0) AS errors,
    COUNT(DISTINCT COALESCE(provider, '')) AS providers
    FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`, [activityStart, now]);
  const models = db.get(`SELECT COUNT(*) AS count FROM (
    SELECT provider, model FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?
    GROUP BY provider, model) AS models`, [activityStart, now]);
  const health = db.all(`SELECT COALESCE(provider, '') AS id, ${TOTALS},
    SUM(${ERROR_CASE}) AS errors, MAX(timestamp) AS lastUsed
    FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?
    GROUP BY provider ORDER BY requests DESC, provider ASC LIMIT 50`, [healthStart, now]);
  const requests = Number(activity.requests);
  return {
    today: {
      requests, promptTokens: Number(activity.prompt), completionTokens: Number(activity.completion),
      cachedTokens: Number(activity.cachedTokens), cost: Number(activity.cost),
      providers: Number(activity.providers), models: Number(models.count),
    },
    successRate: successRate(requests, Number(activity.errors)),
    health: health.map((row) => ({
      id: row.id, name: row.id, requests: Number(row.requests), errors: Number(row.errors),
      successRate: successRate(Number(row.requests), Number(row.errors)),
      lastUsed: row.lastUsed || "", cost: Number(row.cost),
    })),
  };
}

/** Local quota cards render per-model totals, never individual request rows. */
export async function getConnectionUsageSummary({ provider, connectionId, startDate }) {
  const db = await getAdapter();
  const params = [provider, startDate];
  let where = "provider = ? AND timestamp >= ?";
  if (connectionId) { where += " AND connectionId = ?"; params.push(connectionId); }
  const totals = db.get(`SELECT ${TOTALS} FROM usageHistory WHERE ${where}`, params);
  const models = db.all(`SELECT model, COALESCE(SUM(promptTokens), 0) +
    COALESCE(SUM(completionTokens), 0) AS used FROM usageHistory WHERE ${where}
    GROUP BY model ORDER BY model`, params);
  return {
    requests: Number(totals.requests), prompt: Number(totals.prompt),
    completion: Number(totals.completion), cost: Number(totals.cost),
    byModel: Object.fromEntries(models.map((row) => [row.model, Number(row.used)])),
  };
}
