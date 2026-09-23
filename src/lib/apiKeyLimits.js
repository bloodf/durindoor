// Per-API-key windowed limits, stored in the key's policy (see
// API_KEY_LIMIT_FIELDS in src/lib/db/helpers/apiKeyPolicy.js).
//
// - RPM and TPM are in-memory sliding 60s windows per process, so they are
//   exact for one instance and per-instance behind a balancer. RPM counts a
//   request when it is admitted; TPM counts tokens when usage is recorded.
// - Token, request and cost windows sum usageHistory, which already holds one
//   row per request with its cost, so it doubles as the per-request cost
//   ledger. It is written after a response completes, so requests already in
//   flight can overshoot these limits and TPM.
// - Day and month follow server local time, like usageDaily and the
//   existing daily token limit.
import { getApiKeyWindowUsageTotals, statsEmitter } from "@/lib/db/index.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

const RPM_WINDOW_MS = 60 * 1000;
const USAGE_CACHE_TTL_MS = 10 * 1000;

const METRICS = {
  tokens: { label: "tokens", read: (u) => u.inputTokens + u.outputTokens },
  inputTokens: { label: "input tokens", read: (u) => u.inputTokens },
  outputTokens: { label: "output tokens", read: (u) => u.outputTokens },
  requests: { label: "requests", read: (u) => u.requests },
  cost: { label: "budget", read: (u) => u.cost, money: true },
};

// `enforce: false` rows are shown on the dashboard only. The daily total is
// the older `dailyLimitTokens` column, which the chat handler enforces with
// committed-token accounting.
export const USAGE_LIMITS = [
  { field: "dailyLimitTokens", period: "day", metric: "tokens", label: "Tokens today", always: true, enforce: false },
  { field: "dailyInputTokenLimit", period: "day", metric: "inputTokens", label: "Input tokens today" },
  { field: "dailyOutputTokenLimit", period: "day", metric: "outputTokens", label: "Output tokens today" },
  { field: "monthlyTokenLimit", period: "month", metric: "tokens", label: "Tokens this month" },
  { field: "monthlyInputTokenLimit", period: "month", metric: "inputTokens", label: "Input tokens this month" },
  { field: "monthlyOutputTokenLimit", period: "month", metric: "outputTokens", label: "Output tokens this month" },
  { field: "monthlyRequestLimit", period: "month", metric: "requests", label: "Requests this month" },
  { field: "monthlyBudget", period: "month", metric: "cost", label: "Cost this month", always: true },
];

const PERIOD_TEXT = { day: "daily", month: "monthly" };
const RESET_TEXT = { day: "Resets at local midnight.", month: "Resets on the 1st of next month." };

// Shared across Next.js module instances, like usageRepo's emitter.
if (!global._apiKeyLimitState) {
  global._apiKeyLimitState = { usage: new Map(), hits: new Map(), tokens: new Map(), checked: new WeakSet(), listening: false };
}
const state = global._apiKeyLimitState;
if (!state.listening) {
  statsEmitter.on("apiKeyUsage", (apiKey, tokens = 0) => {
    state.usage.delete(apiKey);
    if (tokens > 0) state.tokens.set(apiKey, [...recentTokens(apiKey), { at: Date.now(), tokens }]);
  });
  state.listening = true;
}

function limitOf(record, field) {
  const value = field === "dailyLimitTokens" ? record?.dailyLimitTokens : record?.policy?.[field];
  return Number.isFinite(value) && value > 0 ? value : null;
}

function periodBounds(now = new Date()) {
  return {
    day: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    nextDay: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
    month: new Date(now.getFullYear(), now.getMonth(), 1),
    nextMonth: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

const resetOf = (period, bounds) => (period === "day" ? bounds.nextDay : bounds.nextMonth);

async function getUsage(apiKey, bounds, { fresh = false } = {}) {
  const dayKey = bounds.day.toISOString();
  const cached = state.usage.get(apiKey);
  if (!fresh && cached && cached.dayKey === dayKey && Date.now() - cached.ts < USAGE_CACHE_TTL_MS) return cached.totals;
  const totals = await getApiKeyWindowUsageTotals(apiKey, dayKey, bounds.month.toISOString());
  state.usage.set(apiKey, { totals, dayKey, ts: Date.now() });
  return totals;
}

function recentHits(apiKey, now = Date.now()) {
  const hits = (state.hits.get(apiKey) || []).filter((t) => now - t < RPM_WINDOW_MS);
  if (hits.length) state.hits.set(apiKey, hits);
  else state.hits.delete(apiKey);
  return hits;
}

function recentTokens(apiKey, now = Date.now()) {
  const entries = (state.tokens.get(apiKey) || []).filter((e) => now - e.at < RPM_WINDOW_MS);
  if (entries.length) state.tokens.set(apiKey, entries);
  else state.tokens.delete(apiKey);
  return entries;
}

const sumTokens = (entries) => entries.reduce((total, e) => total + e.tokens, 0);

function format(value, money) {
  return money ? `$${value.toFixed(2)}` : Math.round(value).toLocaleString("en-US");
}

/**
 * Check a key's windowed limits and count the request toward its RPM window.
 * @param {object|null} record API key record (from getApiKeyByKey)
 * @returns {Promise<null | { message: string, retryAfter: number }>} null when allowed
 */
export async function checkApiKeyLimits(record, now = new Date()) {
  if (!record?.key) return null;
  const bounds = periodBounds(now);
  const active = USAGE_LIMITS.filter((def) => def.enforce !== false && limitOf(record, def.field) != null);
  if (active.length) {
    const usage = await getUsage(record.key, bounds);
    for (const def of active) {
      const metric = METRICS[def.metric];
      const used = metric.read(usage[def.period]);
      const limit = limitOf(record, def.field);
      if (used >= limit) {
        return {
          message: `API key ${PERIOD_TEXT[def.period]} ${metric.label} limit reached (${format(used, metric.money)}/${format(limit, metric.money)}). ${RESET_TEXT[def.period]}`,
          retryAfter: Math.max(1, Math.ceil((resetOf(def.period, bounds).getTime() - now.getTime()) / 1000)),
        };
      }
    }
  }

  const nowMs = now.getTime();
  const tpmLimit = limitOf(record, "tpmLimit");
  if (tpmLimit) {
    const entries = recentTokens(record.key, nowMs);
    const used = sumTokens(entries);
    if (used >= tpmLimit) {
      return {
        message: `API key token rate limit exceeded (${format(used)}/${format(tpmLimit)} tokens/minute).`,
        retryAfter: Math.max(1, Math.ceil((entries[0].at + RPM_WINDOW_MS - nowMs) / 1000)),
      };
    }
  }

  const rpmLimit = limitOf(record, "rpmLimit");
  const hits = recentHits(record.key, nowMs);
  if (rpmLimit && hits.length >= rpmLimit) {
    return {
      message: `API key rate limit exceeded (${rpmLimit} requests/minute).`,
      retryAfter: Math.max(1, Math.ceil((hits[0] + RPM_WINDOW_MS - nowMs) / 1000)),
    };
  }
  hits.push(nowMs);
  state.hits.set(record.key, hits);
  return null;
}

/**
 * Return a 429 with Retry-After when a limit is hit, otherwise null.
 *
 * A request is checked and counted once: chat checks at the top of the
 * request, then its per-model policy checks (combo members, vision reroute)
 * skip this step for the same Request object.
 */
export async function enforceApiKeyLimits(request, record) {
  if (!record?.key) return null;
  if (request) {
    if (state.checked.has(request)) return null;
    state.checked.add(request);
  }
  let limited;
  try {
    limited = await checkApiKeyLimits(record);
  } catch (error) {
    // Fail open: a broken usage query must not take the gateway down.
    console.warn("[apiKeyLimits] check failed:", error?.message);
    return null;
  }
  if (!limited) return null;
  return errorResponse(HTTP_STATUS.RATE_LIMITED, limited.message, null, limited.retryAfter);
}

/** Current usage against every limit, for the dashboard. */
export async function getApiKeyLimitStatus(record, now = new Date()) {
  const bounds = periodBounds(now);
  const usage = await getUsage(record.key, bounds, { fresh: true });
  return {
    rpm: { used: recentHits(record.key, now.getTime()).length, limit: limitOf(record, "rpmLimit") },
    tpm: { used: sumTokens(recentTokens(record.key, now.getTime())), limit: limitOf(record, "tpmLimit") },
    limits: USAGE_LIMITS.map((def) => ({
      field: def.field,
      label: def.label,
      money: !!METRICS[def.metric].money,
      always: !!def.always,
      used: METRICS[def.metric].read(usage[def.period]),
      limit: limitOf(record, def.field),
      resetAt: resetOf(def.period, bounds).toISOString(),
    })),
    today: usage.day,
    month: usage.month,
  };
}
