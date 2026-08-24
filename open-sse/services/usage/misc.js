/**
 * Misc usage handlers (Qwen, iFlow, Ollama, GLM, Vercel AI Gateway, Qoder)
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";

// GLM quota endpoints (region-aware) — url from registry transport.usage
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
const GLM_QUOTA_URLS = {
  international: U("glm").url,
  china: U("glm-cn").url
};

// Vercel AI Gateway credits endpoint
// Returns { balance: "95.50", total_used: "4.50" } (USD as decimal strings).
const VERCEL_AI_GATEWAY_CREDITS_URL = U("vercel-ai-gateway").url;

/**
 * Qwen Usage
 */
export async function getQwenUsage(accessToken, providerSpecificData) {
  try {
    const resourceUrl = providerSpecificData?.resourceUrl;
    if (!resourceUrl) {
      return { message: "Qwen connected. No resource URL available." };
    }

    // Qwen may have usage endpoint at resource URL
    return { message: "Qwen connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch Qwen usage." };
  }
}

/**
 * iFlow Usage
 */
export async function getIflowUsage(accessToken) {
  try {
    // iFlow may have usage endpoint
    return { message: "iFlow connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch iFlow usage." };
  }
}

/**
 * Ollama Cloud usage.
 *
 * GET https://ollama.com/api/usage — session (5h) + weekly (7d) `usage` is a
 *   0..1 ratio (1.0 = limit reached). No reset timestamp is exposed.
 * POST https://ollama.com/api/me — plan label, fail-open.
 * Auth: `Authorization: Bearer <apiKey>`.
 */
export async function getOllamaUsage(apiKey, providerSpecificData, proxyOptions = null) {
  if (!apiKey) return { message: "Ollama Cloud API key not available." };

  try {
    const response = await proxyAwareFetch("https://ollama.com/api/usage", {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "Ollama Cloud API key invalid or expired." };
    }
    if (!response.ok) {
      return { message: `Ollama Cloud usage API error (${response.status}).` };
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return { message: "Ollama Cloud usage response was not JSON." };
    }

    // Plan label is cosmetic — never fail the usage read over it.
    const me = await proxyAwareFetch("https://ollama.com/api/me", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Length": "0"
      }
    }, proxyOptions).then((r) => r.ok ? r.json() : null).catch(() => null);

    const planRaw = isString(me?.Plan) ? me.Plan : "";
    const plan = planRaw ?
    planRaw.charAt(0).toUpperCase() + planRaw.slice(1).toLowerCase() :
    "Ollama Cloud";

    const limits = data?.limits && isObject(data.limits) ? data.limits : {};

    // `usage` is a 0..1 ratio (1.0 = limit reached), so convert to a 0..100 bar.
    // Deliberately no absolute `remaining`: QuotaTable reads remainingPercentage.
    const ratioQuota = (usageRatio, resetAt = null) => {
      const ratio = Math.max(0, Math.min(1, Number(usageRatio) || 0));
      const usedPct = Math.round(ratio * 100);
      return { used: usedPct, total: 100, remainingPercentage: 100 - usedPct, resetAt, unlimited: false };
    };

    const sessionRaw = limits.session?.usage;
    const weeklyRaw = limits.weekly?.usage;
    const sessionNum = Number(sessionRaw);
    const weeklyNum = Number(weeklyRaw);
    const hasSession = sessionRaw !== undefined && sessionRaw !== null && !Number.isNaN(sessionNum);
    const hasWeekly = weeklyRaw !== undefined && weeklyRaw !== null && !Number.isNaN(weeklyNum);

    if (!hasSession && !hasWeekly) {
      return { plan, message: "Ollama Cloud connected. No usage limits reported.", quotas: {} };
    }

    const quotas = {};
    if (hasSession) quotas["Session (5h)"] = ratioQuota(sessionNum);
    if (hasWeekly) quotas["Weekly (7d)"] = ratioQuota(weeklyNum);

    return { plan, quotas };
  } catch (error) {
    return { message: `Ollama Cloud error: ${error.message}` };
  }
}

/**
 * GLM Coding Plan usage (international + China regions)
 */
export async function getGlmUsage(apiKey, provider, proxyOptions = null) {
  if (!apiKey) {
    return { message: "GLM API key not available." };
  }

  const region = provider === "glm-cn" ? "china" : "international";
  const quotaUrl = GLM_QUOTA_URLS[region];

  try {
    const response = await proxyAwareFetch(quotaUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json"
      }
    }, proxyOptions);

    if (!response.ok) {
      if (response.status === 401) {
        return { message: "GLM API key invalid or expired." };
      }
      return { message: `GLM quota API error (${response.status}).` };
    }

    const json = await response.json();
    const data = json?.data && isObject(json.data) ? json.data : {};
    const limits = Array.isArray(data.limits) ? data.limits : [];
    const quotas = {};

    for (const limit of limits) {
      if (!limit || limit.type !== "TOKENS_LIMIT") continue;
      const usedPercent = Number(limit.percentage) || 0;
      const resetMs = Number(limit.nextResetTime) || 0;
      const remaining = Math.max(0, 100 - usedPercent);

      quotas["session"] = {
        used: usedPercent,
        total: 100,
        remaining,
        remainingPercentage: remaining,
        resetAt: resetMs > 0 ? new Date(resetMs).toISOString() : null,
        unlimited: false
      };
    }

    const levelRaw = isString(data.level) ? data.level : "";
    const plan = levelRaw ?
    levelRaw.charAt(0).toUpperCase() + levelRaw.slice(1).toLowerCase() :
    "Unknown";

    return { plan, quotas };
  } catch (error) {
    return { message: `GLM error: ${error.message}` };
  }
}

/**
 * Vercel AI Gateway usage — credit balance for the API key
 *
 * Calls GET /v1/credits which returns:
 *   { "balance": "95.50", "total_used": "4.50" }   (USD as decimal strings)
 *
 * We surface this as a single "Balance ($)" quota row so the existing
 * QuotaTable / progress-bar UI can render it. used = total_used,
 * total = balance + total_used (the original credit allotment), so the
 * remaining percentage equals balance / total.
 *
 * Docs: https://vercel.com/docs/ai-gateway/usage
 */
export async function getVercelAiGatewayUsage(apiKey, proxyOptions = null) {
  if (!apiKey) {
    return { message: "Vercel AI Gateway API key not available." };
  }

  try {
    const response = await proxyAwareFetch(VERCEL_AI_GATEWAY_CREDITS_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json"
      }
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "Vercel AI Gateway API key invalid or expired." };
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const trimmed = errorText ? `: ${errorText.slice(0, 200)}` : "";
      return { message: `Vercel AI Gateway credits API error (${response.status})${trimmed}` };
    }

    const data = await response.json();

    // Vercel returns numeric strings; coerce safely.
    const balance = Number(data?.balance) || 0;
    const totalUsed = Number(data?.total_used) || 0;

    // Vercel gives $5/month free credit. The API doesn't return the
    // monthly allocation so we use the known constant as the denominator.
    const MONTHLY_CREDIT = 5;
    const remainingPercentage = balance / MONTHLY_CREDIT * 100;

    if (balance <= 0 && totalUsed <= 0) {
      return {
        plan: "Pay-as-you-go",
        message: "Vercel AI Gateway connected. No credit allocation found (BYOK or unfunded account).",
        quotas: {}
      };
    }

    // "Used (USD)": how much has been spent this month (no fixed cap → unlimited).
    // "Remaining (USD)": balance remaining out of the $5 monthly allocation.
    return {
      plan: "Pay-as-you-go",
      quotas: {
        "Used (USD)": {
          used: totalUsed,
          total: 0,
          remaining: 0,
          remainingPercentage: 100,
          unlimited: true
        },
        "Remaining (USD)": {
          used: balance,
          total: MONTHLY_CREDIT,
          remaining: balance,
          remainingPercentage,
          unlimited: false
        }
      }
    };
  } catch (error) {
    return { message: `Vercel AI Gateway error: ${error.message}` };
  }
}

export async function getQoderUsage(accessToken, proxyOptions = null) {
  if (!accessToken) {
    return { message: "Qoder usage unavailable: no access token" };
  }
  try {
    const response = await proxyAwareFetch(
      U("qoder").url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      },
      proxyOptions
    );
    if (!response.ok) {
      return { message: `Qoder connected. Usage fetch returned ${response.status}.` };
    }
    const body = await response.json().catch(() => null);
    if (!body) {
      return { message: "Qoder connected. Usage response was not JSON." };
    }
    // Quota records live under `quotas`; scalar metadata
    // (totalUsagePercentage, isQuotaExceeded, expiresAt) are surfaced as
    // siblings so the dashboard parser doesn't try to render them as rows.
    const userQuota = body.userQuota || {};
    const orgQuota = body.orgResourcePackage || {};
    // Qoder publishes a single absolute reset timestamp (`expiresAt` in ms);
    // surface it on every quota record as ISO so the table can render
    // "resets at" alongside used/total.
    const expiresAtMs = Number.isFinite(Number(body.expiresAt)) && Number(body.expiresAt) > 0 ?
    Number(body.expiresAt) :
    null;
    const resetAt = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;
    const quotas = {
      user: {
        total: Number(userQuota.total) || 0,
        used: Number(userQuota.used) || 0,
        remaining: Number(userQuota.remaining) || 0,
        unit: userQuota.unit || "credits",
        resetAt
      },
      organization: {
        total: Number(orgQuota.total) || 0,
        used: Number(orgQuota.used) || 0,
        remaining: Number(orgQuota.remaining) || 0,
        unit: orgQuota.unit || "credits",
        resetAt
      }
    };
    return {
      quotas,
      totalUsagePercentage: Number(body.totalUsagePercentage) || 0,
      isQuotaExceeded: !!body.isQuotaExceeded,
      expiresAt: expiresAtMs
    };
  } catch (error) {
    return { message: `Qoder connected. Unable to fetch usage: ${error.message}` };
  }
}

/**
 * Aggregate xAI usage from local usageHistory scoped to a connection.
 * xAI does not currently expose a stable usage API for consumer accounts, so
 * the quota view falls back to per-request totals captured by the proxy.
 */
export async function getXaiUsage(connectionId) {
  const plan = "xAI / Grok Build";
  if (!connectionId) {
    return {
      message: "xAI usage requires a connection id.",
      plan,
      quotas: {}
    };
  }

  let rows = [];
  try {
    const { getUsageHistory } = await import("../../../src/lib/db/index.js");
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    rows = await getUsageHistory({ provider: "xai", connectionId, startDate });
  } catch {
    rows = [];
  }

  if (rows.length === 0) {
    return {
      message: "No requests recorded for this xAI connection in the last 30 days.",
      plan,
      quotas: {}
    };
  }

  let totalTokens = 0;
  let totalCost = 0;
  const perModel = new Map();
  for (const r of rows) {
    const prompt = Number(r.promptTokens || 0);
    const completion = Number(r.completionTokens || 0);
    const tokens = prompt + completion;
    const cost = Number(r.cost || 0);
    totalTokens += tokens;
    totalCost += cost;
    const bucket = perModel.get(r.model) || { used: 0, cost: 0 };
    bucket.used += tokens;
    bucket.cost += cost;
    perModel.set(r.model, bucket);
  }

  const quotas = {
    "Total tokens (30d)": { used: totalTokens, limit: null, unit: "tokens" },
    "Total spend (30d)": { used: totalCost, limit: null, unit: "usd" }
  };
  for (const [model, agg] of perModel) {
    quotas[`${model} (30d)`] = { used: agg.used, limit: null, unit: "tokens" };
  }
  return {
    message: `Aggregated ${rows.length} request${rows.length === 1 ? "" : "s"} for this xAI connection.`,
    plan,
    quotas
  };
}

export async function getGrokWebUsage() {
  return {
    message: "Grok Web connected. Subscription quota is not exposed by a stable usage API; local request usage is tracked by DurinDoor.",
    quotas: {}
  };
}