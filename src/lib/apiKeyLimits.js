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
// - Day, week (Monday start) and month follow server local time, like usageDaily and the
//   existing daily token limit.
//
// Every window belongs to the key's stable id, not to the secret it stores.
// A secret is a credential that can change; the id is the account. Keying the
// windows by the id keeps a key's budget intact across a secret change, and
// keeps two keys that once shared a secret apart.
import { getApiKeyByKey, getApiKeyUsageLimitStatus, getApiKeyWindowUsageTotals, statsEmitter } from "@/lib/db/index.js";
import { findApiKeyIdSync } from "@/lib/db/repos/reportQueriesRepo.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { annotateClientAdmissionFailure } from "open-sse/services/operationalMetrics.js";

const RPM_WINDOW_MS = 60 * 1000;
const USAGE_CACHE_TTL_MS = 10 * 1000;
// Bound on the secret -> id alias table. One entry per key the process has
// admitted; a rotated secret adds an entry, an idle one is dropped.
const ALIAS_LIMIT = 512;

const METRICS = {
  tokens: { label: "tokens", read: (u) => u.inputTokens + u.outputTokens },
  inputTokens: { label: "input tokens", read: (u) => u.inputTokens },
  outputTokens: { label: "output tokens", read: (u) => u.outputTokens },
  requests: { label: "requests", read: (u) => u.requests },
  cost: { label: "budget", read: (u) => u.cost, money: true },
};

// `enforce: false` rows are skipped by checkApiKeyLimits and shown on the
// dashboard. The daily total is the older `dailyLimitTokens` column, which is
// enforced with committed-token accounting by the chat/native admission and by
// enforceApiKeyLimits (shared admission), so every billable route returns the
// same 429 once the cap is reached.
export const USAGE_LIMITS = [
  { field: "dailyLimitTokens", period: "day", metric: "tokens", label: "Tokens today", always: true, enforce: false },
  { field: "dailyInputTokenLimit", period: "day", metric: "inputTokens", label: "Input tokens today" },
  { field: "dailyOutputTokenLimit", period: "day", metric: "outputTokens", label: "Output tokens today" },
  { field: "dailyBudget", period: "day", metric: "cost", label: "Cost today", always: true },
  { field: "weeklyTokenLimit", period: "week", metric: "tokens", label: "Tokens this week" },
  { field: "weeklyInputTokenLimit", period: "week", metric: "inputTokens", label: "Input tokens this week" },
  { field: "weeklyOutputTokenLimit", period: "week", metric: "outputTokens", label: "Output tokens this week" },
  { field: "weeklyBudget", period: "week", metric: "cost", label: "Cost this week", always: true },
  { field: "monthlyTokenLimit", period: "month", metric: "tokens", label: "Tokens this month" },
  { field: "monthlyInputTokenLimit", period: "month", metric: "inputTokens", label: "Input tokens this month" },
  { field: "monthlyOutputTokenLimit", period: "month", metric: "outputTokens", label: "Output tokens this month" },
  { field: "monthlyRequestLimit", period: "month", metric: "requests", label: "Requests this month" },
  { field: "monthlyBudget", period: "month", metric: "cost", label: "Cost this month", always: true },
];

const PERIOD_TEXT = { day: "daily", week: "weekly", month: "monthly" };
const RESET_TEXT = {
  day: "Resets at local midnight.",
  week: "Resets at local midnight on Monday.",
  month: "Resets on the 1st of next month.",
};

// Shared across Next.js module instances, like usageRepo's emitter.
if (!global._apiKeyLimitState) {
  global._apiKeyLimitState = { usage: new Map(), hits: new Map(), tokens: new Map(), checked: new WeakSet(), listening: false, aliases: new Map() };
}
const state = global._apiKeyLimitState;
if (!state.aliases) state.aliases = new Map();
if (!state.listening) {
  // The usage event carries the key's stable id when the writer knows it.
  // Older writers and direct emitters only carry the secret, so the secret is
  // resolved back to its key: the alias table first, then the stored key row.
  statsEmitter.on("apiKeyUsage", (apiKey, tokens = 0, apiKeyId = null) => {
    const scope = apiKeyId || state.aliases.get(apiKey) || resolveKeyIdSync(apiKey) || apiKey;
    state.usage.delete(scope);
    if (tokens > 0) state.tokens.set(scope, [...recentTokens(scope), { at: Date.now(), tokens }]);
  });
  state.listening = true;
}

/**
 * The stable id of the key that stores a secret, read synchronously.
 *
 * Only used when a usage event carries no id of its own. A missing or
 * uninitialized database leaves the event scoped by its secret, which is the
 * behaviour of a process that never admitted the key.
 */
function resolveKeyIdSync(apiKey) {
  if (!apiKey) return null;
  try {
    return findApiKeyIdSync(apiKey);
  } catch {
    return null;
  }
}

/** Remember which key a secret belongs to, so usage events can be scoped. */
function rememberAlias(record) {
  if (!record?.id || !record?.key) return;
  if (state.aliases.get(record.key) === record.id) return;
  if (state.aliases.size >= ALIAS_LIMIT) {
    const oldest = state.aliases.keys().next().value;
    if (oldest !== undefined) state.aliases.delete(oldest);
  }
  state.aliases.set(record.key, record.id);
}

/**
 * The window scope of one key record, resolved to its stable id.
 *
 * A record that carries its id is already scoped. A record that carries only
 * a secret is a legacy caller shape; its secret is resolved to the key it
 * belongs to, so it reads the same window the usage writer charged. A secret
 * that belongs to no key keeps the old behaviour and scopes by itself.
 *
 * @returns {Promise<{ scope: string|null, apiKeyId: string|null }>}
 */
async function scopeForRecord(record) {
  if (!record?.key) return { scope: null, apiKeyId: null };
  if (record.id) {
    rememberAlias(record);
    return { scope: record.id, apiKeyId: record.id };
  }
  const known = state.aliases.get(record.key);
  if (known) return { scope: known, apiKeyId: known };
  const resolved = await resolveKeyId(record.key);
  if (resolved) {
    rememberAlias({ id: resolved, key: record.key });
    return { scope: resolved, apiKeyId: resolved };
  }
  return { scope: record.key, apiKeyId: null };
}

/** The stable id of the key that stores a secret. */
async function resolveKeyId(apiKey) {
  if (!apiKey) return null;
  try {
    const record = await getApiKeyByKey(apiKey);
    return record?.id || null;
  } catch {
    return null;
  }
}

function limitOf(record, field) {
  const value = field === "dailyLimitTokens" ? record?.dailyLimitTokens : record?.policy?.[field];
  return Number.isFinite(value) && value > 0 ? value : null;
}

function periodBounds(now = new Date()) {
  // The week starts on Monday (ISO-8601): Sunday is 6 days in, Monday is 0.
  const daysIntoWeek = (now.getDay() + 6) % 7;
  return {
    day: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    nextDay: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
    week: new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysIntoWeek),
    nextWeek: new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysIntoWeek + 7),
    month: new Date(now.getFullYear(), now.getMonth(), 1),
    nextMonth: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

const resetOf = (period, bounds) => (period === "day" ? bounds.nextDay : period === "week" ? bounds.nextWeek : bounds.nextMonth);

async function getUsage(record, scope, apiKeyId, bounds, { fresh = false } = {}) {
  const dayKey = bounds.day.toISOString();
  const cached = state.usage.get(scope);
  if (!fresh && cached && cached.dayKey === dayKey && cached.week && Date.now() - cached.ts < USAGE_CACHE_TTL_MS) return cached.totals;
  const totals = await getApiKeyWindowUsageTotals(record.key, dayKey, bounds.month.toISOString(), apiKeyId, bounds.week.toISOString());
  state.usage.set(scope, { totals, dayKey, week: true, ts: Date.now() });
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
  const { scope, apiKeyId } = await scopeForRecord(record);
  const bounds = periodBounds(now);
  const active = USAGE_LIMITS.filter((def) => def.enforce !== false && limitOf(record, def.field) != null);
  if (active.length) {
    const usage = await getUsage(record, scope, apiKeyId, bounds);
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
    const entries = recentTokens(scope, nowMs);
    const used = sumTokens(entries);
    if (used >= tpmLimit) {
      return {
        message: `API key token rate limit exceeded (${format(used)}/${format(tpmLimit)} tokens/minute).`,
        retryAfter: Math.max(1, Math.ceil((entries[0].at + RPM_WINDOW_MS - nowMs) / 1000)),
      };
    }
  }

  const rpmLimit = limitOf(record, "rpmLimit");
  const hits = recentHits(scope, nowMs);
  if (rpmLimit && hits.length >= rpmLimit) {
    return {
      message: `API key rate limit exceeded (${rpmLimit} requests/minute).`,
      retryAfter: Math.max(1, Math.ceil((hits[0] + RPM_WINDOW_MS - nowMs) / 1000)),
    };
  }
  hits.push(nowMs);
  state.hits.set(scope, hits);
  return null;
}

/**
 * The daily `dailyLimitTokens` cap, measured like the chat/native admission
 * (committed tokens since local midnight). Reads only; it never counts a hit.
 */
async function checkDailyTokenCap(record) {
  if (record.dailyLimitTokens == null) return null;
  const status = await getApiKeyUsageLimitStatus(record.key, new Date(), record.id || null);
  if (!status.exceeded) return null;
  const used = Math.round(status.usedTokens);
  const limit = Math.round(status.limitTokens);
  return {
    message: `API key daily token limit exceeded (${used}/${limit} tokens)`,
    retryAfter: Math.max(1, Math.ceil((new Date(status.resetAt).getTime() - Date.now()) / 1000)),
  };
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
    limited = await checkDailyTokenCap(record) || await checkApiKeyLimits(record);
  } catch (error) {
    console.warn("[apiKeyLimits] check failed:", error?.message);
    return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "API key usage temporarily unavailable");
  }
  if (!limited) return null;
  return annotateClientAdmissionFailure(
    errorResponse(HTTP_STATUS.RATE_LIMITED, limited.message, null, limited.retryAfter), "client_limit");
}

/** Current usage against every limit, for the dashboard. */
export async function getApiKeyLimitStatus(record, now = new Date()) {
  const { scope, apiKeyId } = await scopeForRecord(record);
  const bounds = periodBounds(now);
  const usage = await getUsage(record, scope, apiKeyId, bounds, { fresh: true });
  return {
    rpm: { used: recentHits(scope, now.getTime()).length, limit: limitOf(record, "rpmLimit") },
    tpm: { used: sumTokens(recentTokens(scope, now.getTime())), limit: limitOf(record, "tpmLimit") },
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
    week: usage.week,
    month: usage.month,
  };
}
