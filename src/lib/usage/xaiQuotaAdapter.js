import { isString } from "../../shared/utils/typeChecks.js";
import { connectionData, createProviderRequest, providerFailure } from "../../../open-sse/services/quota/providerHelpers.js";
import { parseGrokCliBilling } from "../../../open-sse/services/usage/grok-cli.js";

const SOURCE_ID = "xai:management-prepaid:v1";

/** The documented total.val is a signed USD-cent ledger balance. Negative
 * purchases represent prepaid credit. This says nothing about postpaid limits
 * or inference readiness. Unknown response shapes never become a zero balance.
 */
export function normalizeXaiPrepaidBalance(payload) {
  const value = payload?.total?.val;
  if (!isString(value) || !/^-?\d+$/.test(value)) return null;
  const cents = Number(value);
  if (!Number.isSafeInteger(cents)) return null;
  return Math.max(0, -cents / 100);
}

/** Management credentials are separate from inference credentials. Custom
 * endpoints are unsupported so neither key can be sent to an operator URL.
 */
export async function fetchXaiQuota(context) {
  const data = connectionData(context.connection);
  const key = isString(context.connection?.managementApiKey) ? context.connection.managementApiKey.trim() : "";
  const team = isString(data.teamId) ? data.teamId.trim() : "";
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
    notice: "Prepaid credit only. Postpaid allowance and inference readiness remain unknown.",
    quotas: {
      "Prepaid credit (USD)": {
        used: 0, total: balance, isCreditBalance: true, currency: "USD",
        resetAt: null, unlimited: false
      }
    }
  };
}

/** Read the OAuth connection's weekly credit pool without using API-key credentials. */
export async function fetchXaiOAuthQuota(context) {
  const token = context.connection?.accessToken;
  const sourceId = "xai:oauth-billing:v1";
  if (!isString(token) || !token.trim()) return { outcome: "unknown", sourceId, quotas: {} };
  const result = await createProviderRequest(context)("https://cli-chat-proxy.grok.com/v1/billing?format=credits", {
    method: "GET", headers: { Authorization: `Bearer ${token.trim()}`, Accept: "application/json" }
  });
  if (!result.ok) return { ...providerFailure({ sourceId }, result), quotas: {} };
  const parsed = parseGrokCliBilling(result.data);
  if (!Object.keys(parsed.quotas || {}).length) return { outcome: "malformed", sourceId, quotas: {} };
  return { outcome: "success", sourceId, plan: parsed.plan, quotas: parsed.quotas };
}
