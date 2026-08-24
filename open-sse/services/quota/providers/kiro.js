import {
  KIRO_DEFAULT_REGION,
  regionFromProfileArn,
  resolveKiroControlPlaneHost,
  resolveKiroRegion } from
"../../../config/kiroConstants.js";
import {
  asArray,
  asRecord,
  boundedQuotaRow,
  finiteQuotaNumber,
  parseQuotaTimestamp,
  quotaMetadata,
  quotaRow,
  quotaScopedKey } from
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

export function normalizeKiroQuota(payload, { accountKey = null, now = Date.now() } = {}) {
  const data = asRecord(payload);
  if (!data || !Array.isArray(data.usageBreakdownList) || data.usageBreakdownList.length === 0) return null;
  const plan = isString(data.subscriptionInfo?.subscriptionTitle) ?
  data.subscriptionInfo.subscriptionTitle :
  "Kiro";
  const commonReset = futureResetAt(parseQuotaTimestamp(data.nextDateReset ?? data.resetDate), now);
  const overage = data.overageEnabled === true ||
  data.overageConfiguration?.overageEnabled === true ||
  String(data.overageConfiguration?.overageStatus || "").toUpperCase() === "ENABLED";
  const rows = [];
  for (const raw of asArray(data.usageBreakdownList)) {
    const item = asRecord(raw);
    if (!item || !isString(item.resourceType) || !item.resourceType.trim()) return null;
    const used = finiteQuotaNumber(item.currentUsageWithPrecision);
    const limit = finiteQuotaNumber(item.usageLimitWithPrecision);
    if (used === null || limit === null) return null;
    const resourceKey = quotaScopedKey("resource", item.resourceType.toLowerCase());
    const row = overage ?
    quotaRow({
      accountKey,
      resourceKey,
      dimensionKey: quotaScopedKey("requests", "subscription"),
      limitKind: "unlimited",
      used,
      unit: "requests",
      resetAt: commonReset,
      metadata: quotaMetadata({ plan })
    }) :
    boundedQuotaRow({
      accountKey,
      resourceKey,
      dimensionKey: quotaScopedKey("requests", "subscription"),
      limit,
      used,
      unit: "requests",
      resetAt: commonReset,
      metadata: quotaMetadata({ plan })
    });
    if (!row) return null;
    rows.push(row);
    if (item.freeTrialInfo !== undefined) {
      const trial = asRecord(item.freeTrialInfo);
      const trialUsed = finiteQuotaNumber(trial?.currentUsageWithPrecision);
      const trialLimit = finiteQuotaNumber(trial?.usageLimitWithPrecision);
      if (!trial || trialUsed === null || trialLimit === null) return null;
      const trialRow = boundedQuotaRow({
        accountKey,
        resourceKey,
        dimensionKey: quotaScopedKey("requests", "free-trial"),
        limit: trialLimit,
        used: trialUsed,
        unit: "requests",
        resetAt: futureResetAt(parseQuotaTimestamp(trial.freeTrialExpiry), now) || commonReset,
        metadata: quotaMetadata({ plan, recurring: false })
      });
      if (!trialRow) return null;
      rows.push(trialRow);
    }
  }
  return rows;
}

/** Return false for Kiro credential modes whose quota contract is not accepted. */
export function isKiroQuotaConnectionEligible(connection) {
  const data = connectionData(connection);
  return !(
  ["api_key", "apikey"].includes(connection?.authType) ||
  ["api_key", "external_idp"].includes(data.authMethod));

}

function kiroHeaders(token, authMethod, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(authMethod === "api_key" ? { tokentype: "API_KEY" } : null),
    ...(authMethod === "external_idp" ? { TokenType: "EXTERNAL_IDP" } : null),
    ...extra
  };
}

export async function fetchKiroQuota(context) {
  const { config, connection } = context;
  // API-key/external-IdP usage variants remain research-only upstream. Batch 2
  // persists only the accepted access-token GetUsageLimits contract.
  const data = connectionData(connection);
  if (!isKiroQuotaConnectionEligible(connection)) return missingCredential(config);
  const token = connectionCredential(connection, "accessToken");
  if (!token) return missingCredential(config);
  let region;
  let host;
  try {
    region = regionFromProfileArn(data.profileArn) || resolveKiroRegion(data.region) || KIRO_DEFAULT_REGION;
    host = resolveKiroControlPlaneHost(region);
  } catch {
    return providerFailure(config, { outcome: "malformed" });
  }
  const request = createProviderRequest(context);
  let profileArn = isString(data.profileArn) && data.profileArn.trim() ? data.profileArn.trim() : null;
  if (!profileArn) {
    const profiles = await request(host, {
      method: "POST",
      headers: kiroHeaders(token, "builder-id", {
        "Content-Type": "application/x-amz-json-1.0",
        "x-amz-target": "AmazonCodeWhispererService.ListAvailableProfiles"
      }),
      body: JSON.stringify({ maxResults: 10 })
    });
    if (!profiles.ok) return providerFailure(config, profiles);
    const list = Array.isArray(profiles.data?.profiles) ? profiles.data.profiles : [];
    const match = list.find((profile) => isString(profile?.arn) && regionFromProfileArn(profile.arn) === region) || list[0];
    profileArn = isString(match?.arn) && match.arn.trim() ? match.arn.trim() : null;
  }
  if (!profileArn) return providerFailure(config, { outcome: "missing" });
  const profileRegion = regionFromProfileArn(profileArn);
  if (profileRegion) {
    try {
      host = resolveKiroControlPlaneHost(profileRegion);
    } catch {
      return providerFailure(config, { outcome: "malformed" });
    }
  }
  const result = await request(host, {
    method: "POST",
    headers: kiroHeaders(token, "builder-id", {
      "Content-Type": "application/x-amz-json-1.0",
      "x-amz-target": "AmazonCodeWhispererService.GetUsageLimits"
    }),
    body: JSON.stringify({ origin: "AI_EDITOR", profileArn, resourceType: "AGENTIC_REQUEST" })
  });
  if (!result.ok) return providerFailure(config, result);
  const accountRaw = profileArn ?? data.accountId ?? data.userId ?? null;
  const rows = normalizeKiroQuota(result.data, {
    accountKey: accountRaw ? quotaScopedKey("account", accountRaw, { privateValue: true }) : null,
    now: new Date(result.attemptedAt).getTime()
  });
  if (rows === null) return providerFailure(config, { outcome: "malformed", attemptedAt: result.attemptedAt });
  return providerSuccess(config, rows, result.attemptedAt);
}