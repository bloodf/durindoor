/**
 * Cursor usage handler
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { readBoundedResponseText } from "../../utils/error.js";
import { buildCursorHeaders } from "../../utils/cursorChecksum.js";
import { parseResetTime, toFiniteNumber } from "./shared.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

const CURSOR_USAGE_CONFIG = {
  currentPeriodUsageUrl: "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
  planInfoUrl: "https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo",
  authUsageUrl: "https://api2.cursor.sh/auth/usage",
  summaryUrl: "https://api2.cursor.sh/api/usage/summary",
  aggregatedUsageUrl: "https://api2.cursor.sh/aiserver.v1.DashboardService/GetAggregatedUsageEvents"
};

function buildCursorUsageHeaders(accessToken, providerSpecificData = {}) {
  const machineId = providerSpecificData?.machineId || null;
  const headers = buildCursorHeaders(accessToken, machineId, providerSpecificData?.ghostMode !== false);
  return {
    ...headers,
    "content-type": "application/json",
    accept: "application/json"
  };
}

function formatCursorPercentWindow(percentUsed, resetAt) {
  const used = Math.max(0, Math.min(100, toFiniteNumber(percentUsed, 0)));
  return {
    used,
    total: 100,
    remaining: Math.max(0, 100 - used),
    resetAt,
    unlimited: false
  };
}

function formatCursorCentsWindow(spentCents, limitCents, resetAt) {
  const usedCents = toFiniteNumber(spentCents, 0);
  const totalCents = toFiniteNumber(limitCents, 0);
  if (totalCents <= 0) return null;

  const usedDollars = usedCents / 100;
  const totalDollars = totalCents / 100;
  const remainingDollars = Math.max(0, totalDollars - usedDollars);

  return {
    used: usedDollars,
    total: totalDollars,
    remaining: totalDollars > 0 ? Math.round(remainingDollars / totalDollars * 100) : 0,
    resetAt,
    unlimited: false,
    unit: "usd"
  };
}

function parseCursorDashboardUsage(data) {
  const quotas = {};
  const resetAt = parseResetTime(data?.billingCycleEnd);
  const planUsage = data?.planUsage || {};

  const included = formatCursorCentsWindow(
    planUsage.includedSpend ?? planUsage.totalSpend,
    planUsage.limit,
    resetAt
  );
  if (included) quotas["Included spend"] = included;

  if (Number.isFinite(Number(planUsage.autoPercentUsed))) {
    quotas["Auto mode"] = formatCursorPercentWindow(planUsage.autoPercentUsed, resetAt);
  }

  if (Number.isFinite(Number(planUsage.apiPercentUsed))) {
    quotas["API usage"] = formatCursorPercentWindow(planUsage.apiPercentUsed, resetAt);
  }

  const spendLimit = data?.spendLimitUsage || {};
  const individualLimit = toFiniteNumber(spendLimit.individualLimit, 0);
  if (individualLimit > 0) {
    const row = formatCursorCentsWindow(spendLimit.individualUsed, individualLimit, resetAt);
    if (row) quotas["On-demand (individual)"] = row;
  }

  const pooledLimit = toFiniteNumber(spendLimit.pooledLimit, 0);
  if (pooledLimit > 0) {
    const row = formatCursorCentsWindow(spendLimit.pooledUsed, pooledLimit, resetAt);
    if (row) quotas["On-demand (team pool)"] = row;
  }

  return quotas;
}

function parseCursorAuthUsage(data) {
  const quotas = {};
  if (!data || !isObject(data)) return quotas;

  const resetAt = parseResetTime(data.startOfMonth);

  for (const [modelKey, bucket] of Object.entries(data)) {
    if (modelKey === "startOfMonth" || !bucket || !isObject(bucket)) continue;

    const used = toFiniteNumber(bucket.numRequests, 0);
    const total = toFiniteNumber(bucket.maxRequestUsage, 0);
    if (total <= 0) continue;

    quotas[modelKey] = {
      used,
      total,
      remaining: Math.max(0, Math.round((total - used) / total * 100)),
      resetAt,
      unlimited: false
    };
  }

  return quotas;
}

/** Normalize Cursor's aggregated billing events; invalid rows do not affect quota reporting. */
export function mapCursorModelUsage(data) {
  if (!Array.isArray(data?.aggregations)) return [];
  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  };
  return data.aggregations.flatMap((row) => {
    const model = isString(row?.modelIntent) ? row.modelIntent.trim() : "";
    if (!model) return [];
    return [{
      model,
      inputTokens: Math.floor(number(row.inputTokens)),
      outputTokens: Math.floor(number(row.outputTokens)),
      cacheReadTokens: Math.floor(number(row.cacheReadTokens)),
      cacheWriteTokens: Math.floor(number(row.cacheWriteTokens)),
      costUsd: Math.round(number(row.totalCents) * 100) / 10000,
    }];
  }).sort((a, b) => b.costUsd - a.costUsd || a.model.localeCompare(b.model)).slice(0, 50);
}

async function readCursorUsageJson(response) {
  if (!response?.ok) {
    void response?.body?.cancel().catch(() => {});
    return null;
  }
  const text = await readBoundedResponseText(response, { maxBytes: 1024 * 1024 });
  return text ? JSON.parse(text) : null;
}

async function fetchCursorModelUsage(headers, proxyOptions) {
  try {
    const response = await proxyAwareFetch(CURSOR_USAGE_CONFIG.aggregatedUsageUrl,
      { method: "POST", headers, body: "{}" }, proxyOptions);
    return mapCursorModelUsage(await readCursorUsageJson(response));
  } catch {
    return [];
  }
}

export async function getCursorUsage(accessToken, providerSpecificData = {}, proxyOptions = null) {
  if (!accessToken) {
    return { message: "Cursor usage unavailable: no access token" };
  }

  const headers = buildCursorUsageHeaders(accessToken, providerSpecificData);

  try {
    const usageRes = await proxyAwareFetch(
      CURSOR_USAGE_CONFIG.currentPeriodUsageUrl,
      { method: "POST", headers, body: "{}" },
      proxyOptions
    );

    // Consume or cancel the first response before reusing the connection.
    const usageData = await readCursorUsageJson(usageRes).catch(() => null);
    if (usageRes.status === 401) {
      return { message: "Cursor token expired or invalid. Re-import from Cursor IDE." };
    }

    let planName = null;
    try {
      const planRes = await proxyAwareFetch(
        CURSOR_USAGE_CONFIG.planInfoUrl,
        { method: "POST", headers, body: "{}" },
        proxyOptions
      );
      const planData = await readCursorUsageJson(planRes);
      planName = planData?.planInfo?.planName || null;
    } catch {

      // Plan info is optional; usage data is the primary signal.
    }
    if (usageRes.ok) {
      const data = usageData;
      const quotas = parseCursorDashboardUsage(data || {});
      if (Object.keys(quotas).length > 0) {
        const modelUsage = await fetchCursorModelUsage(headers, proxyOptions);
        const result = {
          plan: planName,
          billingCycleStart: parseResetTime(data?.billingCycleStart),
          billingCycleEnd: parseResetTime(data?.billingCycleEnd),
          displayMessage: data?.displayMessage || null,
          quotas
        };
        if (modelUsage.length) result.modelUsage = modelUsage;
        return result;
      }
    }

    const fallbackRes = await proxyAwareFetch(
      CURSOR_USAGE_CONFIG.authUsageUrl,
      {
        method: "GET",
        headers: {
          authorization: headers.authorization,
          accept: "application/json"
        }
      },
      proxyOptions
    );

    const fallbackData = await readCursorUsageJson(fallbackRes).catch(() => null);
    if (fallbackRes.status === 401) {
      return { message: "Cursor token expired or invalid. Re-import from Cursor IDE." };
    }

    if (fallbackRes.ok) {
      const quotas = parseCursorAuthUsage(fallbackData || {});
      if (Object.keys(quotas).length > 0) {
        const modelUsage = await fetchCursorModelUsage(headers, proxyOptions);
        const result = { plan: planName, quotas };
        if (modelUsage.length) result.modelUsage = modelUsage;
        return result;
      }
    }

    // Newer accounts may expose usage only through the summary endpoint.
    try {
      const summary = await proxyAwareFetch(CURSOR_USAGE_CONFIG.summaryUrl, {
        method: "GET", headers: { authorization: headers.authorization, accept: "application/json" }
      }, proxyOptions);
      const data = await readCursorUsageJson(summary);
      if (data) {
        const plan = data?.individualUsage?.plan;
        const used = Number(plan?.used);
        const limit = Number(plan?.limit);
        const reported = Number(plan?.totalPercentUsed);
        if (plan && ((Number.isFinite(used) && Number.isFinite(limit) && limit > 0) || Number.isFinite(reported))) {
          const percent = Number.isFinite(reported) ? reported : used / limit * 100;
          return { plan: planName || "Cursor Pro", quotas: { Total: formatCursorPercentWindow(percent, parseResetTime(data.billingCycleEnd)) } };
        }
      }
    } catch { /* Summary is an optional fallback. */ }
    return {
      message: `Cursor connected. Usage API temporarily unavailable (${usageRes.status}).`
    };
  } catch (error) {
    throw new Error(`Failed to fetch Cursor usage: ${error.message}`);
  }
}