import {
  hasConflictingCodexAccountIds,
  resolveCodexAccountId,
} from "../../../shared/codexAccountId.js";
import {
  asArray,
  asRecord,
  parseQuotaTimestamp,
  quotaMetadata,
  quotaPercent,
  quotaScopedKey,
  ratioQuotaRow,
} from "../normalize.js";
import {
  connectionCredential,
  connectionData,
  createProviderRequest,
  futureResetAt,
  missingCredential,
  providerFailure,
  providerSuccess,
} from "../providerHelpers.js";

function resetAtForWindow(window, now) {
  const absolute = parseQuotaTimestamp(window?.reset_at ?? window?.resets_at ?? window?.resetAt);
  if (absolute) return futureResetAt(absolute, now);
  const seconds = Number(window?.reset_after_seconds ?? window?.resetAfterSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return futureResetAt(new Date(now + seconds * 1000).toISOString(), now);
}

function rateLimitBody(value) {
  const record = asRecord(value);
  if (!record) return null;
  return asRecord(record.rate_limit ?? record.rateLimit) || record;
}

function appendWindows(rows, value, {
  accountKey,
  resourceKey,
  plan,
  now,
} = {}) {
  if (value === null || value === undefined) return true;
  const body = rateLimitBody(value);
  if (!body) return false;
  const windows = [
    ["session", body.primary_window ?? body.primaryWindow ?? body.primary],
    ["weekly", body.secondary_window ?? body.secondaryWindow ?? body.secondary],
  ];
  for (const [name, rawWindow] of windows) {
    if (rawWindow === null || rawWindow === undefined) continue;
    const window = asRecord(rawWindow);
    if (!window) return false;
    const usedRatio = quotaPercent(window.used_percent ?? window.usedPercent ?? window.percent_used);
    if (usedRatio === null) return false;
    const row = ratioQuotaRow({
      accountKey,
      resourceKey,
      dimensionKey: quotaScopedKey("requests", name),
      remainingRatio: 1 - usedRatio,
      resetAt: resetAtForWindow(window, now),
      metadata: quotaMetadata({ plan, windowSeconds: name === "session" ? 5 * 60 * 60 : 7 * 24 * 60 * 60 }),
    });
    if (!row) return false;
    rows.push(row);
  }
  return true;
}

function rateLimitsById(data) {
  return asRecord(data.rate_limits_by_limit_id ?? data.rateLimitsByLimitId);
}

function additionalLimits(data) {
  return asArray(data.additional_rate_limits ?? data.additionalRateLimits);
}

function reviewLimit(data) {
  if (data.code_review_rate_limit || data.codeReviewRateLimit || data.review_rate_limit || data.reviewRateLimit) {
    return data.code_review_rate_limit || data.codeReviewRateLimit || data.review_rate_limit || data.reviewRateLimit;
  }
  const byId = rateLimitsById(data);
  const indexedReview = byId?.code_review || byId?.codeReview || byId?.codex_review || byId?.codexReview || byId?.review;
  if (indexedReview) return indexedReview;
  return additionalLimits(data).find((entry) => {
    const record = asRecord(entry) || {};
    const descriptor = [
      record.limit_name, record.limitName, record.metered_feature, record.meteredFeature,
      record.limit_id, record.limitId, record.id, record.name, record.title,
    ].filter((value) => typeof value === "string").join(" ").toLowerCase();
    return descriptor.includes("review");
  }) || null;
}

function sparkLimits(data) {
  return additionalLimits(data).filter((entry) => {
    const record = asRecord(entry) || {};
    const descriptor = [
      record.limit_name, record.limitName, record.metered_feature, record.meteredFeature,
      record.limit_id, record.limitId, record.id, record.name, record.title,
      record.model, record.model_id, record.modelId,
    ]
      .filter((value) => typeof value === "string")
      .join(" ")
      .toLowerCase();
    return descriptor.includes("spark");
  });
}

export function normalizeCodexQuota(data, { accountId = "", now = Date.now() } = {}) {
  const payload = asRecord(data);
  if (!payload) return null;
  for (const field of ["rate_limits_by_limit_id", "rateLimitsByLimitId"]) {
    if (!Object.hasOwn(payload, field)) continue;
    const byId = asRecord(payload[field]);
    if (!byId || Object.values(byId).some((entry) => entry !== null && entry !== undefined && !asRecord(entry))) return null;
  }
  for (const field of ["additional_rate_limits", "additionalRateLimits"]) {
    if (!Object.hasOwn(payload, field)) continue;
    if (!Array.isArray(payload[field]) || payload[field].some((entry) => !asRecord(entry))) return null;
  }
  const rawPlan = payload.plan_type ?? payload.planType;
  const plan = typeof rawPlan === "string"
    ? rawPlan
    : typeof payload.summary?.plan === "string" ? payload.summary.plan : null;
  const accountKey = accountId ? quotaScopedKey("account", accountId, { privateValue: true }) : null;
  const rows = [];
  const byId = rateLimitsById(payload);
  if (!appendWindows(rows, payload.rate_limit ?? payload.rateLimit ?? payload.rate_limits ?? payload.rateLimits ?? byId?.codex, {
    accountKey,
    resourceKey: null,
    plan,
    now,
  })) return null;
  if (!appendWindows(rows, reviewLimit(payload), {
    accountKey,
    resourceKey: quotaScopedKey("feature", "code-review"),
    plan,
    now,
  })) return null;
  for (const entry of sparkLimits(payload)) {
    if (!appendWindows(rows, entry, {
      accountKey,
      resourceKey: quotaScopedKey("model", "codex-spark"),
      plan,
      now,
    })) return null;
  }
  return rows.length > 0 ? rows : null;
}

export async function fetchCodexQuota(context) {
  const { config, connection } = context;
  const token = connectionCredential(connection, "accessToken");
  if (!token) return missingCredential(config);
  const providerData = connectionData(connection);
  if (hasConflictingCodexAccountIds(providerData)) {
    return providerFailure(config, { outcome: "malformed" });
  }
  const accountId = resolveCodexAccountId(providerData, connection?.idToken);
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    originator: "codex_cli_rs",
    "User-Agent": "codex_cli_rs/0.136.0",
  };
  if (accountId) headers["ChatGPT-Account-ID"] = accountId;
  const result = await createProviderRequest(context)(config.url, { method: "GET", headers });
  if (!result.ok) return providerFailure(config, result);
  const rows = normalizeCodexQuota(result.data, { accountId, now: new Date(result.attemptedAt).getTime() });
  if (rows === null) return providerFailure(config, { outcome: "malformed", attemptedAt: result.attemptedAt });
  return providerSuccess(config, rows, result.attemptedAt);
}
