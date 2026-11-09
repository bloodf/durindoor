/**
 * Quota snapshot adapter for Gemini API-key connections (Issue #1110).
 *
 * Source Discovery & First-Party API Contract:
 * - Google AI Studio / Gemini Developer API (generativelanguage.googleapis.com)
 *   does not provide a public REST endpoint to query account quota or remaining
 *   balance using a standard Gemini API key.
 * - Quotas for Generative Language API keys are enforced at the Google Cloud Project
 *   level and can only be inspected via Google Cloud Quotas API (cloudquotas.googleapis.com)
 *   or Google Cloud Monitoring, which require Google Cloud IAM/OAuth credentials.
 * - Internal Code Assist endpoints (cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota)
 *   used by Gemini CLI and Antigravity require Google user OAuth access tokens
 *   (Bearer ya29...), not Gemini API keys.
 * - Exhaustion on Gemini API-key connections is signaled reactively via HTTP 429
 *   RESOURCE_EXHAUSTED responses.
 *
 * Operational Boundary:
 * - Distinguishes authoritative provider snapshots from local usage estimates.
 * - Does not guess undocumented endpoints or make unauthenticated network calls.
 * - If no authoritative custom endpoint is declared, returns outcome: "unknown",
 *   keeping quota state UNKNOWN and producing no synthetic quota rows.
 * - If an operator provides a documented custom quota endpoint via
 *   providerSpecificData.quotaEndpoint, queries it over bounded HTTPS.
 */

import {
  asRecord,
  asArray,
  finiteQuotaNumber,
  parseQuotaTimestamp,
  quotaMetadata,
  quotaRatio,
  quotaScopedKey,
  ratioQuotaRow,
  quotaRow
} from "../../../open-sse/services/quota/normalize.js";
import {
  connectionCredential,
  connectionData,
  createProviderRequest,
  futureResetAt,
  missingCredential,
  providerFailure,
  providerSuccess
} from "../../../open-sse/services/quota/providerHelpers.js";
import { isObject, isString } from "../../shared/utils/typeChecks.js";

export const GEMINI_API_KEY_SOURCE_ID = "gemini:api-key-quota:v1";

/**
 * Normalizes an authoritative Gemini API-key quota payload into canonical rows.
 * Returns null if the payload is malformed or invalid.
 */
export function normalizeGeminiApiKeyQuota(payload, {
  accountKey = null,
  plan = "Google AI Studio",
  now = Date.now()
} = {}) {
  const record = asRecord(payload);
  if (!record) return null;

  // Case A: Structured bucket entries (e.g. from a custom proxy or GCP quota export)
  if (Array.isArray(record.buckets)) {
    const rows = [];
    for (const bucket of record.buckets) {
      const item = asRecord(bucket);
      if (!item) return null;
      const modelId = item.modelId ?? item.model_id;
      if (!isString(modelId) || !modelId.trim()) return null;

      const remainingRatio = quotaRatio(item.remainingFraction ?? item.remaining_fraction);
      if (remainingRatio === null) return null;

      const parsedReset = parseQuotaTimestamp(item.resetTime ?? item.reset_time, { now });
      const row = ratioQuotaRow({
        accountKey,
        resourceKey: quotaScopedKey("model", modelId.trim()),
        dimensionKey: quotaScopedKey("requests", "quota"),
        remainingRatio,
        resetAt: futureResetAt(parsedReset, now),
        metadata: quotaMetadata({
          displayName: isString(item.displayName) ? item.displayName : modelId.trim(),
          plan
        })
      });
      if (!row) return null;
      rows.push(row);
    }
    return rows.length > 0 ? rows : null;
  }

  // Case B: Explicit request/token limits object
  if (record.limits && isObject(record.limits)) {
    const rows = [];
    for (const [key, rawLimit] of Object.entries(record.limits)) {
      const limitObj = asRecord(rawLimit);
      if (!limitObj) continue;
      const limitVal = finiteQuotaNumber(limitObj.limit ?? limitObj.max);
      const usedVal = finiteQuotaNumber(limitObj.used ?? limitObj.current);
      const remainingVal = finiteQuotaNumber(limitObj.remaining);
      if (limitVal === null && remainingVal === null) continue;

      const parsedReset = parseQuotaTimestamp(limitObj.resetAt ?? limitObj.resetTime, { now });
      const row = quotaRow({
        accountKey,
        resourceKey: quotaScopedKey("limit", key),
        dimensionKey: quotaScopedKey("requests", key),
        limitKind: limitVal !== null ? "bounded" : "unknown",
        limit: limitVal,
        used: usedVal,
        remaining: remainingVal,
        resetAt: futureResetAt(parsedReset, now),
        metadata: quotaMetadata({ displayName: key, plan })
      });
      if (row) rows.push(row);
    }
    return rows.length > 0 ? rows : null;
  }

  return null;
}

/**
 * Authoritative quota snapshot fetcher for Gemini API-key connections.
 *
 * @param {object} context Standard quota adapter execution context
 * @returns {Promise<object>} Outcome and canonical quota rows
 */
export async function fetchGeminiApiKeyQuota(context) {
  const { config = {}, connection } = context;
  const sourceId = config.sourceId || GEMINI_API_KEY_SOURCE_ID;
  const now = typeof context.now === "function" ? context.now() : Date.now();
  const attemptedAt = new Date(now).toISOString();

  const apiKey = connectionCredential(connection, "apiKey", "key");
  if (!apiKey) {
    return missingCredential({ sourceId });
  }

  const data = connectionData(connection);
  const quotaEndpoint = data.quotaEndpoint;

  // If a dedicated operator-configured custom quota endpoint is provided, query it
  if (isString(quotaEndpoint) && quotaEndpoint.trim()) {
    const request = createProviderRequest(context);
    const lookup = await request(quotaEndpoint.trim(), {
      method: "GET",
      headers: {
        "x-goog-api-key": apiKey,
        Accept: "application/json"
      }
    });

    if (!lookup.ok) {
      return providerFailure({ sourceId }, lookup);
    }

    const rows = normalizeGeminiApiKeyQuota(lookup.data, {
      accountKey: quotaScopedKey("account", connection.id || "gemini-apikey", { privateValue: true }),
      now
    });

    if (rows === null) {
      return providerFailure({ sourceId }, { outcome: "malformed", attemptedAt: lookup.attemptedAt });
    }

    return providerSuccess({ sourceId }, rows, lookup.attemptedAt);
  }

  // First-party Gemini API key has NO public authenticated account quota API.
  // We strictly refuse to guess undocumented endpoints or synthesize fake data.
  // Return outcome: "unknown" with reasonCode: "missing" to preserve the UNKNOWN state.
  return {
    outcome: "unknown",
    sourceId,
    reasonCode: "missing",
    attemptedAt,
    retryAt: null,
    rows: []
  };
}
