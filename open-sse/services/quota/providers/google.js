import {
  CLIENT_METADATA,
  LOAD_CODE_ASSIST_HEADERS,
  LOAD_CODE_ASSIST_METADATA } from
"../../../config/appConstants.js";
import {
  ANTIGRAVITY_IDE_USER_AGENT,
  ANTIGRAVITY_IDE_VERSION } from
"../../../providers/shared.js";
import {
  asArray,
  asRecord,
  parseQuotaTimestamp,
  quotaMetadata,
  quotaRatio,
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
import { isObject, isString } from "@/shared/utils/typeChecks.js";

function projectIdFromConnection(connection) {
  const data = connectionData(connection);
  const raw = connection?.projectId ?? data.projectId ?? data.cloudaicompanionProject;
  if (isString(raw)) return raw.trim() || null;
  if (raw && isObject(raw) && isString(raw.id)) return raw.id.trim() || null;
  return null;
}

function projectIdFromLookup(payload) {
  const record = asRecord(payload);
  if (!record) return null;
  const raw = record.cloudaicompanionProject ?? record.project;
  if (isString(raw)) return raw.trim() || null;
  if (raw && isObject(raw) && isString(raw.id)) return raw.id.trim() || null;
  return null;
}

function planFromLookup(payload) {
  const plan = payload?.currentTier?.name ?? payload?.plan;
  return isString(plan) ? plan : null;
}

function bucketEntries(payload) {
  const record = asRecord(payload);
  if (!record) return null;
  if (Array.isArray(record.buckets)) {
    return record.buckets.map((bucket) => {
      const item = asRecord(bucket) || {};
      return {
        modelId: item.modelId ?? item.model_id,
        displayName: item.displayName ?? item.display_name,
        remainingFraction: item.remainingFraction ?? item.remaining_fraction,
        resetTime: item.resetTime ?? item.reset_time
      };
    });
  }
  const models = asRecord(record.models);
  if (models) {
    return Object.entries(models).map(([modelId, value]) => {
      const item = asRecord(value) || {};
      const quota = asRecord(item.quotaInfo ?? item.quota_info) || {};
      return {
        modelId,
        displayName: item.displayName ?? item.display_name,
        remainingFraction: quota.remainingFraction ?? quota.remaining_fraction,
        resetTime: quota.resetTime ?? quota.reset_time
      };
    });
  }
  return null;
}

/** Returns null for a malformed authoritative set, [] for a valid empty set. */
export function normalizeGoogleQuota(payload, {
  projectId,
  plan = null,
  now = Date.now()
} = {}) {
  const entries = bucketEntries(payload);
  if (entries === null) return null;
  const accountKey = projectId ? quotaScopedKey("project", projectId, { privateValue: true }) : null;
  const rows = [];
  for (const entry of entries) {
    if (!isString(entry.modelId) || !entry.modelId.trim()) return null;
    const remainingRatio = quotaRatio(entry.remainingFraction);
    if (remainingRatio === null) return null;
    const parsedReset = parseQuotaTimestamp(entry.resetTime);
    const row = ratioQuotaRow({
      accountKey,
      resourceKey: quotaScopedKey("model", entry.modelId),
      dimensionKey: quotaScopedKey("requests", "quota"),
      remainingRatio,
      resetAt: futureResetAt(parsedReset, now),
      metadata: quotaMetadata({
        displayName: isString(entry.displayName) ? entry.displayName : entry.modelId,
        plan
      })
    });
    if (!row) return null;
    rows.push(row);
  }
  return rows.length > 0 ? rows : null;
}

export async function fetchGoogleQuota(context) {
  const { config, connection } = context;
  const token = connectionCredential(connection, "accessToken");
  if (!token) return missingCredential(config);
  const request = createProviderRequest(context);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  if (config.mode === "antigravity") {
    headers["User-Agent"] = ANTIGRAVITY_IDE_USER_AGENT;
    headers["X-Client-Name"] = "antigravity";
    headers["X-Client-Version"] = ANTIGRAVITY_IDE_VERSION;
  }

  let projectId = projectIdFromConnection(connection);
  let plan = null;
  if (!projectId) {
    const lookup = await request(config.projectUrl, {
      method: "POST",
      headers: config.mode === "antigravity" ?
      { ...LOAD_CODE_ASSIST_HEADERS, Authorization: `Bearer ${token}` } :
      headers,
      body: JSON.stringify({ metadata: config.mode === "antigravity" ? LOAD_CODE_ASSIST_METADATA : CLIENT_METADATA })
    });
    if (!lookup.ok) return providerFailure(config, lookup);
    projectId = projectIdFromLookup(lookup.data);
    plan = planFromLookup(lookup.data);
    if (!projectId) return providerFailure(config, { outcome: "missing", attemptedAt: lookup.attemptedAt });
  }

  const result = await request(config.quotaUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ project: projectId })
  });
  if (!result.ok) return providerFailure(config, result);
  const rows = normalizeGoogleQuota(result.data, {
    projectId,
    plan,
    now: new Date(result.attemptedAt).getTime()
  });
  if (rows === null) return providerFailure(config, { outcome: "malformed", attemptedAt: result.attemptedAt });
  return providerSuccess(config, rows, result.attemptedAt);
}