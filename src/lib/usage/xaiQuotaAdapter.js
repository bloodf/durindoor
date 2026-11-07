import { connectionCredential, connectionData, createProviderRequest, providerFailure } from "../../../open-sse/services/quota/providerHelpers.js";

const SOURCE_ID = "xai:management-prepaid:v1";

/** The documented total.val is a signed USD-cent ledger balance. Negative
 * purchases represent prepaid credit. This says nothing about postpaid limits
 * or inference readiness. Unknown response shapes never become a zero balance.
 */
export function normalizeXaiPrepaidBalance(payload) {
  const value = payload?.total?.val;
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return null;
  const cents = Number(value);
  if (!Number.isSafeInteger(cents)) return null;
  return Math.max(0, -cents / 100);
}

/** Management credentials are separate from inference credentials. Custom
 * endpoints are unsupported so neither key can be sent to an operator URL.
 */
export async function fetchXaiQuota(context) {
  const data = connectionData(context.connection);
  const key = connectionCredential(context.connection, "managementApiKey");
  const team = typeof data.teamId === "string" ? data.teamId.trim() : "";
  const unknown = {
    outcome: "unknown", sourceId: SOURCE_ID, reasonCode: "missing", rows: [], quotas: {},
    message: "xAI account quota is unknown. A separate management key and team ID can read prepaid credit."
  };
  if (!key || !team || data.quotaEndpoint) return unknown;
  const result = await createProviderRequest(context)(
    `https://management-api.x.ai/v1/billing/teams/${encodeURIComponent(team)}/prepaid/balance`,
    { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } }
  );
  if (!result.ok) return { ...unknown, ...providerFailure({ sourceId: SOURCE_ID }, result) };
  const balance = normalizeXaiPrepaidBalance(result.data);
  if (balance === null) return { ...unknown, outcome: "malformed" };
  return {
    outcome: "success", sourceId: SOURCE_ID,
    message: "Prepaid credit only. Postpaid allowance and inference readiness remain unknown.",
    quotas: {
      "Prepaid credit (USD)": {
        used: 0, total: balance, isCreditBalance: true, currency: "USD",
        remainingPercentage: balance > 0 ? 100 : 0, resetAt: null, unlimited: false
      }
    }
  };
}
