import { ANTHROPIC_API_VERSION } from "../../../providers/shared.js";
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
  createProviderRequest,
  futureResetAt,
  missingCredential,
  providerFailure,
  providerSuccess } from
"../providerHelpers.js";
import { isString } from "@/shared/utils/typeChecks.js";

function appendClaudeWindow(rows, raw, {
  name,
  resourceKey = null,
  accountKey = null,
  plan = null,
  now,
  windowSeconds
} = {}) {
  if (raw === null || raw === undefined) return true;
  const window = asRecord(raw);
  if (!window) return false;
  const usedRatio = quotaPercent(window.utilization);
  if (usedRatio === null) return false;
  const row = ratioQuotaRow({
    accountKey,
    resourceKey,
    dimensionKey: quotaScopedKey("requests", name),
    remainingRatio: 1 - usedRatio,
    resetAt: futureResetAt(parseQuotaTimestamp(window.resets_at ?? window.resetAt), now),
    metadata: quotaMetadata({ plan, windowSeconds })
  });
  if (!row) return false;
  rows.push(row);
  return true;
}

export function normalizeClaudeQuota(payload, {
  accountId = null,
  plan = "Claude Code",
  now = Date.now()
} = {}) {
  const data = asRecord(payload);
  if (!data) return null;
  const accountKey = accountId ? quotaScopedKey("organization", accountId, { privateValue: true }) : null;
  const rows = [];
  if (!appendClaudeWindow(rows, data.five_hour, { name: "session", accountKey, plan, now, windowSeconds: 5 * 60 * 60 })) return null;
  if (!appendClaudeWindow(rows, data.seven_day, { name: "weekly", accountKey, plan, now, windowSeconds: 7 * 24 * 60 * 60 })) return null;
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("seven_day_") || key === "seven_day") continue;
    const codename = key.slice("seven_day_".length);
    const model = codename === "omelette" ? "designer" : codename;
    if (!appendClaudeWindow(rows, value, {
      name: "weekly",
      accountKey,
      resourceKey: quotaScopedKey("model", model),
      plan,
      now,
      windowSeconds: 7 * 24 * 60 * 60
    })) return null;
  }
  return rows.length > 0 ? rows : null;
}

export function normalizeClaudeLegacyQuota(payload, {
  accountId = null,
  plan = "Claude Code",
  now = Date.now()
} = {}) {
  const data = asRecord(payload);
  if (!data || Object.keys(data).length === 0) return null;
  const accountKey = accountId ? quotaScopedKey("organization", accountId, { privateValue: true }) : null;
  const rows = [];
  for (const [name, raw] of Object.entries(data)) {
    const quota = asRecord(raw);
    if (!quota) return null;
    const limit = finiteQuotaNumber(quota.total ?? quota.limit);
    const used = finiteQuotaNumber(quota.used);
    const remaining = finiteQuotaNumber(quota.remaining);
    if ((Object.hasOwn(quota, "total") || Object.hasOwn(quota, "limit")) && limit === null) return null;
    if (Object.hasOwn(quota, "used") && used === null) return null;
    if (Object.hasOwn(quota, "remaining") && remaining === null) return null;
    if (limit === null && used === null && remaining === null) return null;
    const resetAt = futureResetAt(parseQuotaTimestamp(quota.reset_at ?? quota.resetAt), now);
    const options = {
      accountKey,
      dimensionKey: quotaScopedKey("requests", name),
      used,
      remaining,
      unit: "requests",
      resetAt,
      metadata: quotaMetadata({ plan })
    };
    let row;
    if (limit !== null) {
      if (limit <= 0 || used === null && remaining === null) return null;
      const effectiveUsed = used ?? limit - remaining;
      const effectiveRemaining = remaining ?? limit - used;
      if (
      effectiveUsed < 0 ||
      effectiveRemaining < 0 ||
      Math.abs(limit - effectiveUsed - effectiveRemaining) > Math.max(1e-9, limit * 1e-9))
      return null;
      row = boundedQuotaRow({ ...options, limit, used: effectiveUsed, remaining: effectiveRemaining });
    } else {
      row = quotaRow({ ...options, limitKind: "unknown" });
    }
    if (!row) return null;
    rows.push(row);
  }
  return rows.length > 0 ? rows : null;
}

async function fetchLegacy(context, token, request, oauthResult, { apiKey = false } = {}) {
  const { config } = context;
  if (!apiKey && (oauthResult?.outcome !== "provider_error" || ![404, 405].includes(oauthResult.status))) {
    return providerFailure(config, oauthResult);
  }
  const headers = {
    ...(apiKey ? { "x-api-key": token } : { Authorization: `Bearer ${token}` }),
    Accept: "application/json",
    "anthropic-version": ANTHROPIC_API_VERSION
  };
  const settings = await request(config.settingsUrl, { method: "GET", headers });
  if (!settings.ok) return providerFailure(config, settings);
  const settingsBody = asRecord(settings.data);
  const organizationId = isString(settingsBody?.organization_id) ? settingsBody.organization_id : null;
  if (!organizationId) return providerFailure(config, { outcome: "missing", attemptedAt: settings.attemptedAt });
  const usage = await request(config.orgUsageUrl.replace("{org_id}", encodeURIComponent(organizationId)), { method: "GET", headers });
  if (!usage.ok) return providerFailure(config, usage);
  const rows = normalizeClaudeLegacyQuota(usage.data, {
    accountId: organizationId,
    plan: isString(settingsBody.plan) ? settingsBody.plan : null,
    now: new Date(usage.attemptedAt).getTime()
  });
  if (rows === null) return providerFailure(config, { outcome: "malformed", attemptedAt: usage.attemptedAt });
  return providerSuccess(config, rows, usage.attemptedAt);
}

export async function fetchClaudeQuota(context) {
  const { config, connection } = context;
  const token = connectionCredential(connection, "accessToken", "apiKey");
  if (!token) return missingCredential(config);
  const request = createProviderRequest(context);
  const apiKeyAuth = ["apikey", "api_key"].includes(connection.authType);
  if (apiKeyAuth) return fetchLegacy(context, token, request, null, { apiKey: true });
  const response = await request(config.oauthUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "anthropic-beta": "oauth-2025-04-20",
      "anthropic-version": ANTHROPIC_API_VERSION
    }
  });
  if (!response.ok) return fetchLegacy(context, token, request, response);
  const rows = normalizeClaudeQuota(response.data, { now: new Date(response.attemptedAt).getTime() });
  if (rows === null) return providerFailure(config, { outcome: "malformed", attemptedAt: response.attemptedAt });
  return providerSuccess(config, rows, response.attemptedAt);
}