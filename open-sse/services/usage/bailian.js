/**
 * Bailian / Alibaba Coding Plan usage handler.
 *
 * The personal Token Plan has no official OpenAPI — the only quota surface is
 * the console gateway, which is cookie-authenticated. The inference API key
 * never authenticates that gateway, so this handler routes through the same
 * quota adapter the preflight dispatcher uses and reports an explicit message
 * when only a key is available (the key may still authorize the retained
 * enterprise Coding Plan endpoint, surfaced separately as
 * "Coding Plan (API key)").
 */
import { getProviderQuotaAdapter } from "../quota/providers/index.js";

function rowsToQuotas(rows) {
  const quotas = {};
  for (const row of rows) {
    const [, , dimension] = row.dimensionKey.split(":");
    quotas[dimension] = {
      total: row.amounts.limit,
      used: row.amounts.used,
      remaining: row.amounts.remaining,
      resetAt: row.resetAt,
      unlimited: false,
    };
  }
  return quotas;
}

export async function getBailianCodingPlanUsage(connection, proxyOptions = null) {
  const adapter = getProviderQuotaAdapter(connection.provider || "bailian-coding-plan");
  if (!adapter) return { message: "Bailian Coding Plan quota adapter is not registered." };

  const { fetchQuota } = adapter;
  const ctx = {
    config: adapter.config,
    connection,
    fetchImpl: globalThis.fetch,
    proxyOptions,
    signal: new AbortController().signal,
    now: Date.now,
  };

  const result = await fetchQuota(ctx);

  if (result.outcome === "success") {
    const plan = result.rows[0]?.metadata?.plan || "Personal";
    const label = result.sourceId === adapter.config.tokenPlanSourceId
      ? `Alibaba Token Plan (${plan})`
      : `Alibaba Coding Plan (${plan})`;
    return { plan: label, quotas: rowsToQuotas(result.rows), displayMessage: result.rows.length ? null : "No quota windows reported." };
  }
  if (result.outcome === "missing") {
    return {
      message: "Alibaba Token Plan quota requires a signed-in Qwen/Alibaba console cookie; an inference API key cannot read personal plan quota.",
      displayMessage: "Personal Token Plan quota unavailable.",
      quotas: {},
    };
  }
  if (result.outcome === "malformed") {
    return { message: "Alibaba quota API returned a malformed response.", displayMessage: "Quota unavailable." };
  }
  if (result.outcome === "forbidden" || result.outcome === "unauthenticated") {
    return { message: "Alibaba console session rejected the quota request. Re-sign-in to the Qwen/Alibaba console.", displayMessage: "Quota unavailable." };
  }
  return { message: "Alibaba quota request failed.", displayMessage: "Quota unavailable." };
}
