import {
  asRecord,
  boundedQuotaRow,
  finiteQuotaNumber,
  parseQuotaTimestamp,
  quotaMetadata,
  quotaPercent,
  quotaRow,
  quotaScopedKey,
  ratioQuotaRow } from
"../normalize.js";
import {
  connectionCredential,
  connectionData,
  createProviderRequest,
  futureResetAt,
  missingCredential,
  providerFailure,
  providerSuccess } from
"../providerHelpers.js";
import { isString } from "@/shared/utils/typeChecks.js";

function githubAccountKey(connection) {
  const data = connectionData(connection);
  const raw = data.userId ?? data.user_id ?? data.login ?? data.accountId;
  return raw === null || raw === undefined || raw === "" ?
  null :
  quotaScopedKey("account", raw, { privateValue: true });
}

function paidRows(snapshots, { accountKey, plan, resetAt }) {
  const rows = [];
  for (const name of ["chat", "completions", "premium_interactions"]) {
    if (!(name in snapshots)) continue;
    const snapshot = asRecord(snapshots[name]);
    if (!snapshot) return null;
    const unlimited = snapshot.unlimited === true;
    const total = finiteQuotaNumber(snapshot.total ?? snapshot.entitlement);
    const reportedUsed = finiteQuotaNumber(snapshot.used);
    const reportedRemaining = finiteQuotaNumber(snapshot.remaining);
    const remainingRatio = quotaPercent(snapshot.percent_remaining ?? snapshot.percentRemaining);
    if (unlimited) {
      const row = quotaRow({
        accountKey,
        dimensionKey: quotaScopedKey("requests", name),
        limitKind: "unlimited",
        used: reportedUsed ?? (total !== null && reportedRemaining !== null ? Math.max(total - reportedRemaining, 0) : null),
        unit: "requests",
        resetAt,
        metadata: quotaMetadata({ plan })
      });
      if (!row) return null;
      rows.push(row);
      continue;
    }
    if ((total === null || total === 0) && remainingRatio !== null) {
      const row = ratioQuotaRow({
        accountKey,
        dimensionKey: quotaScopedKey("requests", name),
        remainingRatio,
        resetAt,
        metadata: quotaMetadata({ plan })
      });
      if (!row) return null;
      rows.push(row);
      continue;
    }
    if (total === null || total <= 0) return null;
    const remaining = reportedRemaining ?? (reportedUsed === null ? null : total - reportedUsed);
    const used = reportedUsed ?? (remaining === null ? null : total - remaining);
    if (remaining === null || used === null || remaining > total || used > total) return null;
    if (Math.abs(total - used - remaining) > Math.max(1e-9, total * 1e-9)) return null;
    if (remainingRatio !== null && Math.abs(remaining / total - remainingRatio) > 0.011) return null;
    const row = boundedQuotaRow({
      accountKey,
      dimensionKey: quotaScopedKey("requests", name),
      limit: total,
      used,
      remaining,
      unit: "requests",
      resetAt,
      metadata: quotaMetadata({ plan })
    });
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

function freeRows(monthly, remainingBuckets, { accountKey, plan, resetAt }) {
  const rows = [];
  for (const name of ["chat", "completions", "premium_interactions"]) {
    if (!(name in monthly)) continue;
    const limit = finiteQuotaNumber(monthly[name]);
    // GitHub's limited_user_quotas values are remaining, not used.
    const remaining = finiteQuotaNumber(remainingBuckets[name]);
    if (limit === null || remaining === null || remaining > limit) return null;
    const row = boundedQuotaRow({
      accountKey,
      dimensionKey: quotaScopedKey("requests", name),
      limit,
      remaining,
      unit: "requests",
      resetAt,
      metadata: quotaMetadata({ plan })
    });
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

export function normalizeGitHubQuota(payload, { accountKey = null, now = Date.now() } = {}) {
  const data = asRecord(payload);
  if (!data) return null;
  const plan = isString(data.copilot_plan) ?
  data.copilot_plan :
  isString(data.access_type_sku) ? data.access_type_sku : null;
  if (asRecord(data.quota_snapshots)) {
    const resetAt = futureResetAt(parseQuotaTimestamp(data.quota_reset_date), now);
    const rows = paidRows(data.quota_snapshots, { accountKey, plan, resetAt });
    return rows?.length ? rows : null;
  }
  const monthly = asRecord(data.monthly_quotas);
  const remainingBuckets = asRecord(data.limited_user_quotas);
  if (monthly && remainingBuckets) {
    const resetAt = futureResetAt(parseQuotaTimestamp(data.limited_user_reset_date), now);
    const rows = freeRows(monthly, remainingBuckets, { accountKey, plan, resetAt });
    return rows?.length ? rows : null;
  }
  return null;
}

export async function fetchGitHubQuota(context) {
  const { config, connection } = context;
  const token = connectionCredential(connection, "accessToken");
  if (!token) return missingCredential(config);
  const response = await createProviderRequest(context)(config.url, {
    method: "GET",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/json",
      "X-GitHub-Api-Version": config.apiVersion,
      "User-Agent": config.userAgent,
      "Editor-Version": config.editorVersion,
      "Editor-Plugin-Version": config.pluginVersion
    }
  });
  if (!response.ok) return providerFailure(config, response);
  const rows = normalizeGitHubQuota(response.data, {
    accountKey: githubAccountKey(connection),
    now: new Date(response.attemptedAt).getTime()
  });
  if (rows === null) return providerFailure(config, { outcome: "malformed", attemptedAt: response.attemptedAt });
  return providerSuccess(config, rows, response.attemptedAt);
}