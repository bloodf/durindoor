import {
  asArray,
  asRecord,
  finiteQuotaNumber,
  quotaMetadata,
  quotaScopedKey,
  quotaRow,
  remainingQuotaRow } from
"../normalize.js";
import {
  connectionCredential,
  connectionData,
  createProviderRequest,
  missingCredential,
  providerFailure,
  providerSuccess } from
"../providerHelpers.js";
import { isBoolean, isString } from "@/shared/utils/typeChecks.js";

export function normalizeVercelQuota(payload, { accountKey = null } = {}) {
  const data = asRecord(payload);
  if (!data) return null;
  const remaining = finiteQuotaNumber(data.balance);
  const used = finiteQuotaNumber(data.total_used ?? data.totalUsed);
  if (remaining === null || used === null) return null;
  return [quotaRow({
    accountKey,
    dimensionKey: quotaScopedKey("balance", "usd"),
    limitKind: "unknown",
    used,
    remaining,
    unit: "usd",
    exhausted: remaining === 0,
    metadata: quotaMetadata({ plan: "Pay-as-you-go" })
  })].filter(Boolean);
}

export function normalizeCrofQuota(payload, { accountKey = null } = {}) {
  const data = asRecord(payload);
  if (!data) return null;
  const rows = [];
  if (data.usable_requests !== null && data.usable_requests !== undefined) {
    const remaining = finiteQuotaNumber(data.usable_requests);
    if (remaining === null) return null;
    rows.push(remainingQuotaRow({
      accountKey,
      dimensionKey: quotaScopedKey("requests", "daily"),
      remaining,
      unit: "requests",
      exhausted: remaining === 0,
      metadata: quotaMetadata({ recurring: true, windowSeconds: 24 * 60 * 60 })
    }));
  }
  if (data.credits !== null && data.credits !== undefined) {
    const remaining = finiteQuotaNumber(data.credits);
    if (remaining === null) return null;
    rows.push(remainingQuotaRow({
      accountKey,
      dimensionKey: quotaScopedKey("balance", "usd"),
      remaining,
      unit: "usd",
      exhausted: remaining === 0
    }));
  }
  const normalized = rows.filter(Boolean);
  return normalized.length > 0 ? normalized : null;
}

export function normalizeDeepSeekQuota(payload, { accountKey = null } = {}) {
  const data = asRecord(payload);
  if (!data || !isBoolean(data.is_available ?? data.isAvailable)) return null;
  const available = data.is_available ?? data.isAvailable;
  const balances = data.balance_infos ?? data.balanceInfos;
  if (!Array.isArray(balances)) return null;
  const rows = [];
  for (const raw of asArray(balances)) {
    const balance = asRecord(raw);
    if (!balance || !isString(balance.currency) || !/^[A-Za-z]{3}$/.test(balance.currency.trim())) return null;
    const currency = balance.currency.trim().toLowerCase();
    const remaining = finiteQuotaNumber(balance.total_balance ?? balance.totalBalance);
    if (remaining === null) return null;
    rows.push(remainingQuotaRow({
      accountKey,
      resourceKey: quotaScopedKey("currency", currency),
      dimensionKey: quotaScopedKey("balance", "available"),
      remaining,
      unit: currency,
      exhausted: !available || remaining === 0
    }));
  }
  const normalized = rows.filter(Boolean);
  return normalized.length > 0 ? normalized : null;
}

function accountKey(connection) {
  const data = connectionData(connection);
  const raw = data.accountId ?? data.userId ?? data.organizationId;
  return raw ? quotaScopedKey("account", raw, { privateValue: true }) : null;
}

async function fetchBalance(context, normalize) {
  const { config, connection } = context;
  const key = connectionCredential(connection, "apiKey", "accessToken");
  if (!key) return missingCredential(config);
  const result = await createProviderRequest(context)(config.url, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }
  });
  if (!result.ok) return providerFailure(config, result);
  const rows = normalize(result.data, { accountKey: accountKey(connection) });
  if (rows === null) return providerFailure(config, { outcome: "malformed", attemptedAt: result.attemptedAt });
  return providerSuccess(config, rows, result.attemptedAt);
}

export const fetchVercelQuota = (context) => fetchBalance(context, normalizeVercelQuota);
export const fetchCrofQuota = (context) => fetchBalance(context, normalizeCrofQuota);
export const fetchDeepSeekQuota = (context) => fetchBalance(context, normalizeDeepSeekQuota);