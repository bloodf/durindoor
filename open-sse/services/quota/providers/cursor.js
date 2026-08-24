import {
  asRecord,
  boundedQuotaRow,
  finiteQuotaNumber,
  parseQuotaTimestamp,
  quotaMetadata,
  quotaPercent,
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

function decodeCursorUserId(token) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return isString(decoded.sub) && decoded.sub.trim() ? decoded.sub.trim() : null;
  } catch {
    return null;
  }
}

function safeCursorUserId(value) {
  return isString(value) && /^[A-Za-z0-9._|:-]{1,256}$/.test(value.trim()) ? value.trim() : null;
}

function cursorSession(connection, storedToken) {
  const separator = storedToken.indexOf("::");
  const legacyUserId = separator > 0 ? safeCursorUserId(storedToken.slice(0, separator)) : null;
  const token = separator > 0 ? storedToken.slice(separator + 2) : storedToken;
  if (!token || /[\u0000-\u001f\u007f]/.test(token)) return null;
  const data = connectionData(connection);
  const userId = safeCursorUserId(data.userId) ||
  safeCursorUserId(data.accountId) ||
  legacyUserId ||
  safeCursorUserId(decodeCursorUserId(token));
  if (!userId) return null;
  return {
    token,
    userId,
    accountKey: quotaScopedKey("account", userId, { privateValue: true })
  };
}

function centsWindow({ used, limit, name, accountKey, resetAt, plan }) {
  const usedCents = finiteQuotaNumber(used);
  const limitCents = finiteQuotaNumber(limit);
  if (usedCents === null || limitCents === null || limitCents <= 0 || usedCents > limitCents) return null;
  return boundedQuotaRow({
    accountKey,
    dimensionKey: quotaScopedKey("spend", name),
    limit: limitCents / 100,
    used: usedCents / 100,
    unit: "usd",
    resetAt,
    metadata: quotaMetadata({ plan })
  });
}

export function normalizeCursorDashboardQuota(payload, {
  accountKey = null,
  plan = null,
  now = Date.now()
} = {}) {
  const data = asRecord(payload);
  if (!data) return null;
  const resetAt = futureResetAt(parseQuotaTimestamp(data.billingCycleEnd), now);
  const planUsage = asRecord(data.planUsage);
  if (!planUsage) return null;
  if (Object.hasOwn(data, "spendLimitUsage") && !asRecord(data.spendLimitUsage)) return null;
  const spend = asRecord(data.spendLimitUsage) || {};
  const rows = [];

  const total = centsWindow({
    used: planUsage.totalSpend,
    limit: planUsage.limit,
    name: "total",
    accountKey,
    resetAt,
    plan
  });
  if (!total) return null;
  rows.push(total);
  for (const [field, name] of [["autoPercentUsed", "auto-composer"], ["apiPercentUsed", "api"]]) {
    if (planUsage[field] === undefined) return null;
    const usedRatio = quotaPercent(planUsage[field]);
    if (usedRatio === null) return null;
    const row = ratioQuotaRow({
      accountKey,
      dimensionKey: quotaScopedKey("requests", name),
      remainingRatio: 1 - usedRatio,
      resetAt,
      metadata: quotaMetadata({ plan })
    });
    if (!row) return null;
    rows.push(row);
  }
  for (const [limitField, usedField, name] of [
  ["individualLimit", "individualUsed", "on-demand-individual"],
  ["pooledLimit", "pooledUsed", "on-demand-team"]])
  {
    if (spend[limitField] === undefined) continue;
    const row = centsWindow({ used: spend[usedField], limit: spend[limitField], name, accountKey, resetAt, plan });
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

export function normalizeCursorFallbackQuota(payload, { accountKey = null, now = Date.now() } = {}) {
  const data = asRecord(payload);
  if (!data) return null;
  const resetAt = futureResetAt(parseQuotaTimestamp(data.startOfMonth), now);
  const rows = [];
  for (const [model, raw] of Object.entries(data)) {
    if (model === "startOfMonth") continue;
    const bucket = asRecord(raw);
    if (!bucket) return null;
    const used = finiteQuotaNumber(bucket.numRequests);
    const limit = finiteQuotaNumber(bucket.maxRequestUsage);
    if (used === null || limit === null || limit <= 0 || used > limit) return null;
    rows.push(boundedQuotaRow({
      accountKey,
      resourceKey: quotaScopedKey("model", model),
      dimensionKey: quotaScopedKey("requests", "billing-cycle"),
      limit,
      used,
      unit: "requests",
      resetAt
    }));
  }
  return rows.filter(Boolean);
}

export async function fetchCursorQuota(context) {
  const { config, connection } = context;
  const storedToken = connectionCredential(connection, "accessToken");
  if (!storedToken) return missingCredential(config);
  const session = cursorSession(connection, storedToken);
  if (!session) return providerFailure(config, { outcome: "missing" });
  const result = await createProviderRequest(context)(config.url, {
    method: "POST",
    headers: {
      Cookie: `WorkosCursorSessionToken=${session.userId}::${session.token}`,
      Origin: config.origin,
      Referer: config.referer,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": config.userAgent
    },
    body: "{}"
  });
  if (!result.ok) return providerFailure(config, result);
  const rows = normalizeCursorDashboardQuota(result.data, {
    accountKey: session.accountKey,
    plan: "Cursor Pro",
    now: new Date(result.attemptedAt).getTime()
  });
  if (rows === null) return providerFailure(config, { outcome: "malformed", attemptedAt: result.attemptedAt });
  return providerSuccess(config, rows, result.attemptedAt);
}