/**
 * Quota snapshot adapter for xAI connections (Issue #1110).
 *
 * Source Discovery & First-Party API Contract:
 * - xAI Inference API (api.x.ai) accepts standard inference keys (xai-...)
 *   for chat completions and embeddings, but exposes NO balance, quota, or
 *   account spending endpoint.
 * - Authoritative account billing and prepaid credit balances are managed exclusively
 *   via xAI's separate Management API (https://management-api.x.ai).
 * - Documented authoritative endpoint:
 *   GET https://management-api.x.ai/v1/billing/teams/{team_id}/prepaid/balance
 *   Requirements:
 *   - Management API key with Billing scope (Bearer <management_key>)
 *   - Team ID ({team_id})
 * - Standard inference requests return transient rate limits via HTTP response headers
 *   (x-ratelimit-*), which represent momentary local throttles, not account snapshots.
 *
 * Operational Boundary:
 * - Distinguishes authoritative provider snapshots from local usage estimates.
 * - When only a standard inference API key is present without Management API credentials
 *   (teamId + management key), returns outcome: "unknown" with reasonCode: "missing",
 *   refusing to guess undocumented endpoints or make unauthorized calls.
 * - When Management API credentials (teamId + management key) are configured in
 *   providerSpecificData, issues a bounded GET request to management-api.x.ai and
 *   normalizes the authoritative prepaid credit balance into canonical quota rows.
 * - Also supports operator-declared providerSpecificData.quotaEndpoint if provided.
 */

import {
  asRecord,
  finiteQuotaNumber,
  quotaMetadata,
  quotaScopedKey,
  quotaRow,
  remainingQuotaRow
} from "../../../open-sse/services/quota/normalize.js";
import {
  connectionCredential,
  connectionData,
  createProviderRequest,
  missingCredential,
  providerFailure,
  providerSuccess
} from "../../../open-sse/services/quota/providerHelpers.js";
import { isNumber, isObject, isString } from "../../shared/utils/typeChecks.js";

export const XAI_QUOTA_SOURCE_ID = "xai:management-prepaid:v1";
export const XAI_MANAGEMENT_API_BASE_URL = "https://management-api.x.ai";

/**
 * Normalizes an xAI Management API prepaid balance payload into canonical quota rows.
 *
 * @param {object} payload JSON response from management-api.x.ai
 * @param {object} options Context options including accountKey
 * @returns {Array<object>|null} Canonical quota rows or null if malformed
 */
export function normalizeXaiPrepaidBalance(payload, {
  accountKey = null,
  plan = "xAI Prepaid"
} = {}) {
  const data = asRecord(payload);
  if (!data) return null;

  // Extract numeric balance from documented and common xAI Management API shapes:
  // e.g. { balance: 150.0 }, { prepaid_balance: 150.0 }, { balance: { amount: 150.0, currency: "usd" } }
  let remaining = null;
  let unit = "usd";

  if (isNumber(data.balance)) {
    remaining = finiteQuotaNumber(data.balance);
  } else if (isObject(data.balance)) {
    const balObj = asRecord(data.balance);
    if (balObj) {
      remaining = finiteQuotaNumber(balObj.amount ?? balObj.balance ?? balObj.value);
      if (isString(balObj.currency) && /^[A-Za-z]{3}$/.test(balObj.currency.trim())) {
        unit = balObj.currency.trim().toLowerCase();
      }
    }
  } else if (data.prepaid_balance !== undefined) {
    remaining = finiteQuotaNumber(data.prepaid_balance);
  } else if (data.total_balance !== undefined) {
    remaining = finiteQuotaNumber(data.total_balance);
  } else if (data.credits !== undefined) {
    remaining = finiteQuotaNumber(data.credits);
    unit = "credits";
  }

  if (remaining === null) return null;

  const row = remainingQuotaRow({
    accountKey,
    resourceKey: quotaScopedKey("scope", "account"),
    dimensionKey: quotaScopedKey("balance", unit),
    remaining,
    unit,
    exhausted: remaining <= 0,
    metadata: quotaMetadata({
      displayName: "xAI Balance",
      plan
    })
  });

  return row ? [row] : null;
}

/**
 * Authoritative quota snapshot fetcher for xAI connections.
 *
 * @param {object} context Standard quota adapter execution context
 * @returns {Promise<object>} Outcome and canonical quota rows
 */
export async function fetchXaiQuota(context) {
  const { config = {}, connection } = context;
  const sourceId = config.sourceId || XAI_QUOTA_SOURCE_ID;
  const now = typeof context.now === "function" ? context.now() : Date.now();
  const attemptedAt = new Date(now).toISOString();

  const data = connectionData(connection);
  const teamId = isString(data.teamId) && data.teamId.trim() ? data.teamId.trim() : null;
  const managementApiKey = connectionCredential(connection, "managementApiKey", "managementKey") ||
    (isString(data.managementApiKey) && data.managementApiKey.trim() ? data.managementApiKey.trim() : null);

  const quotaEndpoint = isString(data.quotaEndpoint) && data.quotaEndpoint.trim() ? data.quotaEndpoint.trim() : null;

  // Case 1: Custom quota endpoint configured by operator
  if (quotaEndpoint) {
    const request = createProviderRequest(context);
    const secret = managementApiKey || connectionCredential(connection, "apiKey", "key");
    const headers = { Accept: "application/json" };
    if (secret) {
      headers.Authorization = `Bearer ${secret}`;
    }

    const lookup = await request(quotaEndpoint, {
      method: "GET",
      headers
    });

    if (!lookup.ok) {
      return providerFailure({ sourceId }, lookup);
    }

    const rows = normalizeXaiPrepaidBalance(lookup.data, {
      accountKey: quotaScopedKey("account", connection.id || "xai", { privateValue: true })
    });

    if (rows === null) {
      return providerFailure({ sourceId }, { outcome: "malformed", attemptedAt: lookup.attemptedAt });
    }

    return providerSuccess({ sourceId }, rows, lookup.attemptedAt);
  }

  // Case 2: Documented xAI Management API credentials provided
  if (teamId && managementApiKey) {
    const request = createProviderRequest(context);
    const balanceUrl = `${XAI_MANAGEMENT_API_BASE_URL}/v1/billing/teams/${encodeURIComponent(teamId)}/prepaid/balance`;

    const lookup = await request(balanceUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${managementApiKey}`,
        Accept: "application/json"
      }
    });

    if (!lookup.ok) {
      return providerFailure({ sourceId }, lookup);
    }

    const rows = normalizeXaiPrepaidBalance(lookup.data, {
      accountKey: quotaScopedKey("account", teamId, { privateValue: true })
    });

    if (rows === null) {
      return providerFailure({ sourceId }, { outcome: "malformed", attemptedAt: lookup.attemptedAt });
    }

    return providerSuccess({ sourceId }, rows, lookup.attemptedAt);
  }

  // Case 3: Missing required Management API credentials
  // Standard inference API keys on api.x.ai cannot read balance or quota.
  const inferenceApiKey = connectionCredential(connection, "apiKey", "key");
  if (!inferenceApiKey && !managementApiKey) {
    return missingCredential({ sourceId });
  }

  // An inference key exists, but xAI's inference API has no quota endpoint.
  // Return unknown with reasonCode: "missing" without guessing or making live calls.
  return {
    outcome: "unknown",
    sourceId,
    reasonCode: "missing",
    attemptedAt,
    retryAt: null,
    rows: []
  };
}
