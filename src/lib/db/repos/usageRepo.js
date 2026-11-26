import { decodeUsdReceipt } from "../../usage/receipt.js";
import { MAX_ATTRIBUTION_VALUES, validAttributionValue } from "../../usageAttribution.js";
import { EventEmitter } from "events";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { addCostSplit, addLatency, addToCounter } from "../helpers/usageCounters.js";
import { incrementUsageDailyRollup, insertUsageDailyRollup, readUsageDailyRollups } from "../helpers/usageDailyRollups.js";
import { getMetaSync } from "../helpers/metaStore.js";
import {
  EMPTY_ALL_TIME_CHART_DAYS,
  MAX_USAGE_CHART_BUCKETS,
  addLocalCalendarDays,
  getChartDayBucketCount,
  getUsageCalendarCutoff,
  getUsagePeriodDays,
  localDateFromKey,
  toLocalDateKey,
  VALID_USAGE_STATS_PERIODS } from
"../../usagePeriods.js";
import { adjustApiKeyUsageSync, incrementApiKeyUsageSync } from "./apiKeyUsageTotalsRepo.js";
import {
  apiKeyUsageScope, hasStableApiKeyIdColumn, resolveUsageApiKeyIdSync,
  upsertUsageLastSeen, usageHistoryKeyColumnsSql, usageKeyIdentity, usageKeyStatsKey,
} from "../helpers/apiKeyAttribution.js";
import { QUOTA_WRITE_LOCK_SQL, QUOTA_WRITE_LOCK_SQL_PG } from "./quotaSql.js";
import { normalizeTokenSaverEvent, aggregateTokenSaverEvents, tokenSaverEventColumns } from "open-sse/rtk/index.js";
import { isNumber, isObject, isString } from "../../../shared/utils/typeChecks.js";
import { deriveLatencyRates } from "../../../shared/utils/usageFormat.js";
import { USAGE_COST_FIELDS } from "../../../shared/utils/usageCostAllocation.js";
import { usageTokenColumns } from "../migrations/usage-token-columns.js";
import { TOKEN_SAVER_SUM_COLUMNS, TOKEN_SAVER_DAILY_COLUMNS, TOKEN_SAVER_AGGREGATES, backfillTokenSaverDaily } from "../migrations/token-saver-daily-schema.js";

// Exception messages may contain credentials; keep fallback diagnostics safe.
function logFallback(context, error) {
  console.warn(`[usageRepo] ${context}`, error instanceof Error ? "Error" : "non-Error thrown");
}

function maskApiKey(key) {
  if (!key || !isString(key)) return null;
  // Legacy keys contain only 32 bits of secret material (`sk-<8 hex>`).
  // Revealing a prefix, or an unsalted digest that verifies guesses offline,
  // makes those keys practical to recover. Usage APIs therefore expose no
  // secret-derived characters at all.
  return "***";
}

const USAGE_IDENTITY_SALT_META_KEY = "usageIdentitySalt";

function getOrCreateUsageIdentitySalt(adapter) {
  const existing = getMetaSync(adapter, USAGE_IDENTITY_SALT_META_KEY);
  if (existing) return existing;
  const generated = randomBytes(32).toString("hex");
  adapter.run(`INSERT OR IGNORE INTO _meta(key, value) VALUES(?, ?)`, [USAGE_IDENTITY_SALT_META_KEY, generated]);
  return getMetaSync(adapter, USAGE_IDENTITY_SALT_META_KEY);
}

/**
 * Derives a stable installation-scoped identity without exposing API-key
 * material or an offline-verifiable unsalted digest.
 */
function fingerprintApiKey(key, salt) {
  if (!key || !isString(key)) return null;
  return `hmac-sha256:${createHmac("sha256", salt).update(key).digest("hex")}`;
}

export { addCostSplit, addLatency };

// Project key identities without exposing stored secrets, including deleted keys.
function createPublicApiKeyIdentity(apiKeyMap, gatewayKeyMap, identitySalt) {
  // API responses use database IDs for registered keys and salted HMACs for
  // deleted/unknown keys. Neither identity contains raw key material.
  const unknownApiKeyIds = new Map();
  return function getPublicApiKeyIdentity(apiKey, internalIdentity = apiKey, provider = null) {
    if (!apiKey && (!internalIdentity || String(internalIdentity).startsWith("local-no-key"))) {
      return { id: "local-no-key", keyName: "Local (No API Key)", apiKeyMasked: null };
    }
    // Gateway and API keys live in separate tables. Resolve MCP rows first
    // against gateway keys, with a separate ID namespace for cross-table collisions.
    const gatewayKey = provider === "mcp-gateway" && apiKey ? gatewayKeyMap[apiKey] : null;
    if (gatewayKey?.id) {
      return {
        id: `mcp-gateway-key:${gatewayKey.id}`,
        keyName: gatewayKey.name || "MCP Gateway Key",
        apiKeyMasked: maskApiKey(apiKey)
      };
    }
    // A shared secret cannot prove that old MCP history used an ordinary key.
    // Keep unmatched MCP rows opaque, including after gateway deletion, rather
    // than assigning a surviving/imported ordinary key's identity to them.
    const keyInfo = provider !== "mcp-gateway" && apiKey ? apiKeyMap[apiKey] : null;
    if (keyInfo?.id) {
      return {
        id: `api-key:${keyInfo.id}`,
        keyName: keyInfo.name || "API Key",
        apiKeyMasked: maskApiKey(apiKey)
      };
    }
    const lookup = apiKey || String(internalIdentity);
    if (!unknownApiKeyIds.has(lookup)) {
      unknownApiKeyIds.set(lookup, unknownApiKeyIds.size + 1);
    }
    const ordinal = unknownApiKeyIds.get(lookup);
    return {
      id: `api-key:${fingerprintApiKey(lookup, identitySalt)}`,
      keyName: `Deleted API key ${ordinal}`,
      apiKeyMasked: maskApiKey(apiKey || "unknown")
    };
  }

}

async function loadPublicApiKeyIdentity(db) {
  const [{ getApiKeys }, { getGatewayKeys }] = await Promise.all([import("./apiKeysRepo.js"), import("./mcpGatewayRepo.js")]);
  let keys = [];
  let gatewayKeys = [];
  try { keys = await getApiKeys(); } catch (error) { logFallback("API key identity lookup failed", error); }
  try { gatewayKeys = await getGatewayKeys(); } catch (error) { logFallback("gateway key identity lookup failed", error); }
  const apiKeyMap = Object.create(null);
  const gatewayKeyMap = Object.create(null);
  for (const key of keys) { apiKeyMap[key.key] = key; apiKeyMap[key.id] = key; }
  for (const key of gatewayKeys) { gatewayKeyMap[key.key] = key; gatewayKeyMap[usageKeyIdentity(null, key.key, "mcp-gateway")] = key; }
  return createPublicApiKeyIdentity(apiKeyMap, gatewayKeyMap, getOrCreateUsageIdentitySalt(db));
}

const PENDING_TIMEOUT_MS = 60 * 1000;
const RING_CAP = 50;
const CONN_CACHE_TTL_MS = 30 * 1000;
// Window durations in ms for history/reset queries. Calendar-day stats/charts use getUsagePeriodDays/getChartDayBucketCount from usagePeriods.js.
const PERIOD_MS = { "24h": 86400000 };
const ACTIVE_SESSION_TTL_MS = 120000;
const ACTIVE_SESSION_DONE_LINGER_MS = 20000;
const ACTIVE_SESSION_CAP = 200;

// In-memory state shared across Next.js modules
if (!global._pendingRequests) global._pendingRequests = { byModel: {}, byAccount: {}, byKey: {} };
global._pendingRequests.byKey ||= {};
if (!global._lastErrorProvider) global._lastErrorProvider = { provider: "", ts: 0 };
if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
if (!global._pendingTimers) global._pendingTimers = {};
if (!global._pendingCalls) global._pendingCalls = new Map();
if (!global._recentRing) global._recentRing = { items: [], initialized: false };
if (!global._connectionMapCache) global._connectionMapCache = { map: {}, ts: 0 };
if (!global._statsEmitTimers) global._statsEmitTimers = { pending: null, update: null, tokenSaver: null };
global._statsEmitTimers.tokenSaver ??= null;
if (!global._activeSessions) global._activeSessions = new Map();
if (!global._activeSessionTimers) global._activeSessionTimers = {};

const pendingRequests = global._pendingRequests;
const lastErrorProvider = global._lastErrorProvider;
const pendingCalls = global._pendingCalls;
const pendingTimers = global._pendingTimers;
const recentRing = global._recentRing;
const connCache = global._connectionMapCache;
const statsEmitTimers = global._statsEmitTimers;
const activeSessions = global._activeSessions;
const activeSessionTimers = global._activeSessionTimers;

export const statsEmitter = global._statsEmitter;

function scheduleStatsEvent(event, delayMs = 150) {
  const key = event === "update" ? "update" : event === "token-saver" ? "tokenSaver" : "pending";
  if (statsEmitTimers[key]) return;
  statsEmitTimers[key] = setTimeout(() => {
    statsEmitTimers[key] = null;
    statsEmitter.emit(event);
  }, delayMs);
  statsEmitTimers[key]?.unref?.();
}

// Model label for account days saved before counters were kept per model.
const LEGACY_ACCOUNT_MODEL = "Earlier usage (models not recorded)";

// One durable representation: numeric, nonnegative integer components. Fractional
// estimates round up before pricing and persistence. Conflicting totals cannot
// be allocated to input/output without inventing usage, so reject them.
function normalizeLedgerTokens(tokens = {}) {
  const count = (value) => {
    if (value == null) return undefined;
    if (!isNumber(value) || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.ceil(value))) {
      throw new TypeError("Usage token counts must be finite nonnegative numbers");
    }
    return Math.ceil(value);
  };
  const first = (...values) => values.map(count).find((value) => value !== undefined);
  const prompt = first(tokens.prompt_tokens, tokens.input_tokens, tokens.promptTokenCount) ?? 0;
  const completion = first(tokens.completion_tokens, tokens.output_tokens, tokens.candidatesTokenCount) ?? 0;
  const cached = first(tokens.cached_tokens, tokens.cache_read_input_tokens,
    tokens.prompt_tokens_details?.cached_tokens, tokens.input_tokens_details?.cached_tokens) ?? 0;
  const reasoning = first(tokens.reasoning_tokens, tokens.completion_tokens_details?.reasoning_tokens,
    tokens.output_tokens_details?.reasoning_tokens, tokens.thoughtsTokenCount) ?? 0;
  const creation = first(tokens.cache_creation_input_tokens,
    tokens.prompt_tokens_details?.cache_creation_tokens, tokens.input_tokens_details?.cache_creation_tokens) ?? 0;
  const oneHourCreation = count(tokens.cache_creation_1h_input_tokens);
  const total = first(tokens.total_tokens, tokens.totalTokenCount);
  if (!Number.isSafeInteger(prompt + completion) || (total !== undefined && total !== prompt + completion)) {
    throw new TypeError("Usage total_tokens must equal input and output components");
  }
  return {
    ...Object.fromEntries(["cost_usd", "cost_in_usd", "cost_in_usd_ticks", "kiro_credits", "kiro_credit_unit", "estimated"]
      .filter((key) => Object.hasOwn(tokens, key)).map((key) => [key, tokens[key]])),
    prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion,
    cached_tokens: cached, reasoning_tokens: reasoning, cache_creation_input_tokens: creation,
    ...(oneHourCreation > 0 ? { cache_creation_1h_input_tokens: oneHourCreation } : null),
  };
}

export function aggregateEntryToDay(day, entry) {
  const promptTokens = entry.tokens?.prompt_tokens ?? entry.tokens?.input_tokens ?? 0;
  const completionTokens = entry.tokens?.completion_tokens ?? entry.tokens?.output_tokens ?? 0;
  const { cachedTokens, reasoningTokens, cacheCreationTokens } = usageTokenColumns(entry.tokens);
  const cost = entry.cost ?? 0;
  // A numeric aggregate is known spend only; retain unpriced request counts
  // in every dimension, including buckets rebuilt from raw history.
  const unknownCostRequests = Number(entry.unknownCostRequests ?? (entry.cost === null ? entry.requests ?? 1 : 0));
  const vals = {
    requests: entry.requests ?? 1, promptTokens, completionTokens, cachedTokens, reasoningTokens, cacheCreationTokens, cost,
    unknownCostRequests,
    latencyMs: entry.latencyMs || 0, ttftMs: entry.ttftMs || 0,
    latencySamples: entry.latencySamples, ttftSamples: entry.ttftSamples,
    timedCompletionTokens: entry.timedCompletionTokens,
    ...Object.fromEntries(USAGE_COST_FIELDS.map((field) => [field, entry[field]]))
  };
  addLatency(day, vals, completionTokens);

  day.requests = (day.requests || 0) + (entry.requests ?? 1);
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cachedTokens = (day.cachedTokens || 0) + cachedTokens;
  day.reasoningTokens = (day.reasoningTokens || 0) + reasoningTokens;
  day.cacheCreationTokens = (day.cacheCreationTokens || 0) + cacheCreationTokens;
  day.cost = (day.cost || 0) + cost;
  day.unknownCostRequests = (day.unknownCostRequests || 0) + unknownCostRequests;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });

  if (entry.connectionId) {
    // One counter per connection and model, as the live path groups them.
    // Blobs saved before this used the bare connection id and mixed models.
    const accountKey = `${entry.connectionId}|${entry.model}|${entry.provider || ""}`;
    addToCounter(day.byAccount, accountKey, { ...vals, meta: { connectionId: entry.connectionId, rawModel: entry.model, provider: entry.provider } });
  }

  const keyIdentity = entry.keyIdentity ?? usageKeyIdentity(entry.apiKeyId, entry.apiKey, entry.provider);
  const akModelKey = usageKeyStatsKey(keyIdentity, entry.model, entry.provider);
  addToCounter(day.byApiKey, akModelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, apiKey: keyIdentity } });

  const endpoint = entry.endpoint || "Unknown";
  const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byEndpoint, epKey, { ...vals, meta: { endpoint, rawModel: entry.model, provider: entry.provider } });
}

function pushToRing(entry) {
  recentRing.items.push(entry);
  if (recentRing.items.length > RING_CAP) {
    recentRing.items = recentRing.items.slice(-RING_CAP);
  }
}

async function getConnectionMapCached() {
  if (Date.now() - connCache.ts < CONN_CACHE_TTL_MS) return connCache.map;
  try {
    const { getProviderConnections } = await import("./connectionsRepo.js");
    const all = await getProviderConnections();
    const map = {};
    for (const c of all) map[c.id] = c.name || c.email || c.id;
    connCache.map = map;
    connCache.ts = Date.now();
  } catch (error) { logFallback("cached connection lookup failed", error); }
  return connCache.map;
}

async function ensureRingInitialized() {
  if (recentRing.initialized) return;
  recentRing.initialized = true;
  try {
    const db = await getAdapter();
    const rows = db.all(`SELECT timestamp, provider, model, connectionId, apiKey, apiKeyId, endpoint, cost, status, tokens, meta, usageEventId FROM usageHistory ORDER BY id DESC LIMIT ?`, [RING_CAP]);
    recentRing.items = rows.reverse().map((r) => ({
      timestamp: r.timestamp, provider: r.provider, model: r.model, connectionId: r.connectionId,
      apiKey: usageKeyIdentity(r.apiKeyId, r.apiKey, r.provider), endpoint: r.endpoint, cost: r.cost, status: r.status,
      tokens: parseJson(r.tokens, {}), storedEventId: r.usageEventId,
      completedAt: parseJson(r.meta, {})?.completedAt
    }));
  } catch (error) { logFallback("recent usage initialization failed", error); }
}

/**
 * Connection ids that completed a SUCCESSFUL request within `withinMs`.
 *
 * The health probe fires an independent validation request that can disagree
 * with the live chat path (a 5xx/timeout on the probe host, or an OAuth token
 * the probe can't use), so a provider that is actively serving traffic can read
 * as "down". Real request success is the strongest liveness signal; the health
 * monitor overlays this set to avoid reporting a working account as down.
 *
 * @param {number} withinMs lookback window in milliseconds
 * @param {number} [now] epoch ms (injectable for tests)
 * @returns {Promise<Set<string>>}
 */
export async function getRecentlyActiveConnectionIds(withinMs, now = Date.now()) {
  await ensureRingInitialized();
  const cutoff = now - withinMs;
  const ids = new Set();
  for (const item of recentRing.items) {
    if (!item.connectionId) continue;
    // status defaults to "ok"; anything explicitly "error" is not a success.
    if (item.status && item.status !== "ok") continue;
    // A settled job keeps its creation timestamp; liveness is when it finished.
    const finishedAt = item.completedAt || item.timestamp;
    const ts = finishedAt ? Date.parse(finishedAt) : NaN;
    if (Number.isFinite(ts) && ts >= cutoff) ids.add(item.connectionId);
  }
  return ids;
}

/**
 * Price one request, keeping the per-rate split next to the total.
 *
 * `split` is null when the components do not make up the total, which is the
 * case for a provider-reported cost: there are no rates to divide it with.
 *
 * @returns {Promise<{cost: number|null, split: object|null, costStatus: string, costSource: string}>}
 */
async function calculateCost(provider, model, tokens) {
  const unknown = { cost: null, split: null, costStatus: "unknown", costSource: "unavailable" };
  if (!tokens) return unknown;
  for (const field of ["cost_usd", "cost_in_usd", "cost_in_usd_ticks"]) {
    if (tokens[field] == null) continue;
    // Receipts are numeric USD, never JavaScript-coerced booleans/strings/arrays.
    const cost = decodeUsdReceipt(tokens[field], field);
    if (cost === null) throw new TypeError(`Invalid usage ${field}`);
    return { cost, split: null, costStatus: "known", costSource: "provider" };
  }
  const { calculateCostBreakdown } = await import("open-sse/providers/pricing.js");
  const { resolvePricingForModel } = await import("./pricingRepo.js");
  const resolved = provider && model ? await resolvePricingForModel(provider, model) : null;
  if (!resolved) return unknown;
  const { pricing, provenance } = resolved;

  // Delegate to the shared cache-inclusive token pricing calculation.
  const breakdown = calculateCostBreakdown(tokens, pricing, { provider, model });
  const componentSum = USAGE_COST_FIELDS.reduce((sum, field) => sum + breakdown[field], 0);
  const split = componentSum === breakdown.totalCost ?
  Object.fromEntries(USAGE_COST_FIELDS.map((field) => [field, breakdown[field]])) : null;
  return { cost: breakdown.totalCost, split, costStatus: "estimated", costSource: "pricing", pricing: provenance };
}

function evictActiveSession(requestId) {
  activeSessions.delete(requestId);
  clearTimeout(activeSessionTimers[requestId]);
  delete activeSessionTimers[requestId];
}

function scheduleActiveSessionEviction(requestId, delayMs) {
  clearTimeout(activeSessionTimers[requestId]);
  activeSessionTimers[requestId] = setTimeout(() => {
    evictActiveSession(requestId);
    scheduleStatsEvent("pending");
  }, delayMs);
  activeSessionTimers[requestId].unref?.();
}

/** Track one request identity for the live Sessions tab without affecting dispatch. */
function startActiveSession({ requestId = randomUUID(), clientId, sessionId, model, provider, connectionId }) {
  if (activeSessions.size >= ACTIVE_SESSION_CAP) evictActiveSession(activeSessions.keys().next().value);
  activeSessions.set(requestId, {
    requestId,
    clientId: clientId || "unknown",
    sessionId: sessionId || "",
    model: model || "unknown",
    provider: (provider || "unknown").toLowerCase(),
    connectionId: connectionId || null,
    startedAt: Date.now(),
    completedAt: null,
    durationMs: 0,
    promptTokens: null,
    completionTokens: null,
    status: "active"
  });
  scheduleActiveSessionEviction(requestId, ACTIVE_SESSION_TTL_MS);
  return requestId;
}

/** Finish one dashboard session by request id without mutating aggregate pending counters. */
export function finishActiveSession({ requestId, promptTokens, completionTokens, status }) {
  const target = requestId ? activeSessions.get(requestId) : null;
  if (!target) return;
  target.promptTokens = promptTokens ?? target.promptTokens;
  target.completionTokens = completionTokens ?? target.completionTokens;
  target.completedAt = Date.now();
  target.durationMs = target.completedAt - target.startedAt;
  target.status = status || "done";
  scheduleActiveSessionEviction(target.requestId, ACTIVE_SESSION_DONE_LINGER_MS);
}

async function getActiveSessions() {
  const connectionMap = await getConnectionMapCached();
  return [...activeSessions.values()].map((session) => ({
    requestId: session.requestId,
    clientId: session.clientId,
    sessionId: session.sessionId,
    model: session.model,
    provider: session.provider,
    account: session.connectionId ? connectionMap[session.connectionId] || `Account ${session.connectionId.slice(0, 8)}...` : "Unknown",
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    durationMs: session.status === "active" ? Date.now() - session.startedAt : session.durationMs,
    promptTokens: session.promptTokens,
    completionTokens: session.completionTokens,
    status: session.status
  }));
}

function changePendingCount({ modelKey, connectionId, keyName }, delta) {
  pendingRequests.byModel[modelKey] = Math.max(0, (pendingRequests.byModel[modelKey] || 0) + delta);
  if (pendingRequests.byModel[modelKey] === 0) delete pendingRequests.byModel[modelKey];
  if (!connectionId) return;

  pendingRequests.byAccount[connectionId] ||= {};
  pendingRequests.byAccount[connectionId][modelKey] = Math.max(0, (pendingRequests.byAccount[connectionId][modelKey] || 0) + delta);
  if (pendingRequests.byAccount[connectionId][modelKey] === 0) {
    delete pendingRequests.byAccount[connectionId][modelKey];
    if (Object.keys(pendingRequests.byAccount[connectionId]).length === 0) delete pendingRequests.byAccount[connectionId];
  }

  pendingRequests.byKey[connectionId] ||= {};
  pendingRequests.byKey[connectionId][modelKey] ||= {};
  pendingRequests.byKey[connectionId][modelKey][keyName] = Math.max(
    0,
    (pendingRequests.byKey[connectionId][modelKey][keyName] || 0) + delta,
  );
  if (pendingRequests.byKey[connectionId][modelKey][keyName] === 0) {
    delete pendingRequests.byKey[connectionId][modelKey][keyName];
    if (Object.keys(pendingRequests.byKey[connectionId][modelKey]).length === 0) delete pendingRequests.byKey[connectionId][modelKey];
    if (Object.keys(pendingRequests.byKey[connectionId]).length === 0) delete pendingRequests.byKey[connectionId];
  }
}

export function finishPendingRequest(requestId, error = false) {
  const call = pendingCalls.get(requestId);
  if (!call) return false;
  pendingCalls.delete(requestId);
  clearTimeout(call.timer);
  delete pendingTimers[requestId];
  changePendingCount(call, -1);
  if (error && call.provider) {
    lastErrorProvider.provider = call.provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }
  scheduleStatsEvent("pending");
  return true;
}

export function trackPendingRequest(model, provider, connectionId, started, error = false, session = null, keyName = "Local (No API Key)") {
  const modelKey = provider ? `${model} (${provider})` : model;
  const safeKeyName = keyName || "Unknown API Key";
  if (!started) {
    if (session?.requestId) return finishPendingRequest(session.requestId, error);
    const match = [...pendingCalls.entries()].find(([, call]) =>
      call.modelKey === modelKey && call.connectionId === connectionId && call.keyName === safeKeyName
    );
    return match ? finishPendingRequest(match[0], error) : false;
  }

  const requestId = session?.requestId || randomUUID();
  const call = { requestId, modelKey, provider, connectionId, keyName: safeKeyName, timer: null };
  changePendingCount(call, 1);
  if (session) {
    try { startActiveSession({ ...session, requestId, model, provider, connectionId }); } catch (error) { logFallback("active session telemetry failed", error); }
  }
  call.timer = setTimeout(() => finishPendingRequest(requestId), PENDING_TIMEOUT_MS);
  call.timer.unref?.();
  pendingCalls.set(requestId, call);
  pendingTimers[requestId] = call.timer;
  scheduleStatsEvent("pending");
  return requestId;
}

function getPendingKeyGroups(connectionId, modelKey) {
  return Object.entries(pendingRequests.byKey?.[connectionId]?.[modelKey] || {})
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getActiveRequests() {
  const activeRequests = [];
  const connectionMap = await getConnectionMapCached();

  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName,
          count,
          keys: getPendingKeyGroups(connectionId, modelKey),
        });
      }
    }
  }

  await ensureRingInitialized();
  const getPublicApiKeyIdentity = await loadPublicApiKeyIdentity(await getAdapter());
  const seen = new Set();
  const recentRequests = [...recentRing.items].
  sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).
  map((e, index) => {
    const t = e.tokens || {};
    return {
      eventKey: e.storedEventId ? `event:${e.storedEventId}` : `row:${index}`,
      apiKeyId: getPublicApiKeyIdentity(e.apiKey, undefined, e.provider).id,
      keyName: getPublicApiKeyIdentity(e.apiKey, undefined, e.provider).keyName,
      timestamp: e.timestamp, model: e.model, provider: e.provider || "",
      promptTokens: t.prompt_tokens || t.input_tokens || 0,
      completionTokens: t.completion_tokens || t.output_tokens || 0,
      cachedTokens: t.cached_tokens || t.cache_read_input_tokens || 0,
      status: e.status || "ok"
    };
  }).
  filter((e) => {
    if (e.promptTokens === 0 && e.completionTokens === 0) return false;
    const key = e.eventKey;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).
  slice(0, 20).map(({ eventKey, ...request }) => request);

  const errorProvider = Date.now() - lastErrorProvider.ts < 10000 ? lastErrorProvider.provider : "";
  return { activeRequests, activeSessions: await getActiveSessions(), recentRequests, errorProvider, pending: pendingRequests };
}

// Latency sums shared by the chart and stats windows. `latencySamples` counts
// only rows that were actually timed, and throughput tokens only rows with
// decode time, so the rate divides by the same subset whose tokens it multiplied. Portable across SQLite and PostgreSQL.
const LATENCY_SUM_SQL = `SUM(latencyMs) AS latencyMs, SUM(ttftMs) AS ttftMs,
  SUM(CASE WHEN latencyMs > 0 THEN 1 ELSE 0 END) AS latencySamples,
  SUM(CASE WHEN ttftMs > 0 THEN 1 ELSE 0 END) AS ttftSamples,
  SUM(CASE WHEN latencyMs > ttftMs THEN completionTokens ELSE 0 END) AS timedCompletionTokens`;

/** Coerce the driver-specific numeric types of {@link LATENCY_SUM_SQL} to numbers. */
function latencyFromRow(row) {
  return {
    latencyMs: Number(row.latencyMs || 0),
    ttftMs: Number(row.ttftMs || 0),
    latencySamples: Number(row.latencySamples || 0),
    ttftSamples: Number(row.ttftSamples || 0),
    timedCompletionTokens: Number(row.timedCompletionTokens || 0)
  };
}

function aggregateChartWindow(db, startTime, endTime, bucketMs, bucketCount) {
  const params = [];
  const cases = [];
  for (let i = 1; i < bucketCount; i++) {
    cases.push(`WHEN timestamp < ? THEN ${i - 1}`);
    params.push(new Date(startTime + i * bucketMs).toISOString());
  }
  params.push(new Date(startTime).toISOString(), new Date(endTime).toISOString());
  return db.all(`SELECT CASE ${cases.join(" ")} ELSE ${bucketCount - 1} END AS bucket,
    SUM(promptTokens) AS promptTokens, SUM(completionTokens) AS completionTokens,
    SUM(cachedTokens) AS cachedTokens, SUM(reasoningTokens) AS reasoningTokens,
    SUM(cacheCreationTokens) AS cacheCreationTokens, SUM(cost) AS cost,
    SUM(CASE WHEN cost IS NULL THEN 1 ELSE 0 END) AS unknownCostRequests,
    ${LATENCY_SUM_SQL}
    FROM usageHistory WHERE timestamp >= ? AND timestamp <= ? GROUP BY bucket`, params);
}

// Rows without a stored split group apart from rows with one, so every
// group's split sums are either complete or NULL, never a partial total.
function aggregateUsageWindow(db, start, end) {
  return db.all(`SELECT provider, model, connectionId, endpoint, ${usageHistoryKeyColumnsSql(db)},
      MAX(timestamp) AS timestamp, COUNT(*) AS requests,
      SUM(promptTokens) AS promptTokens, SUM(completionTokens) AS completionTokens,
      SUM(cachedTokens) AS cachedTokens, SUM(reasoningTokens) AS reasoningTokens,
      SUM(cacheCreationTokens) AS cacheCreationTokens, SUM(cost) AS cost,
      SUM(CASE WHEN cost IS NULL THEN 1 ELSE 0 END) AS unknownCostRequests,
      ${USAGE_COST_FIELDS.map((field) => `SUM(${field}) AS ${field}`).join(", ")},
      ${LATENCY_SUM_SQL}
    FROM usageHistory h WHERE timestamp >= ? AND timestamp <= ?
    GROUP BY 1, 2, 3, 4, 5, 6, (inputCost IS NULL) ORDER BY MIN(id) ASC`, [start, end]).map((row) => ({
      ...row, keyIdentity: usageKeyIdentity(row.usageKeyId, row.legacyKey, row.provider),
      ...latencyFromRow(row), requests: Number(row.requests), tokens: {
        prompt_tokens: Number(row.promptTokens), completion_tokens: Number(row.completionTokens),
        cached_tokens: Number(row.cachedTokens), reasoning_tokens: Number(row.reasoningTokens),
        cache_creation_input_tokens: Number(row.cacheCreationTokens),
      },
    }));
}

function aggregateRowsToDay(rows) {
  const day = {};
  for (const row of rows) aggregateEntryToDay(day, row);
  return day;
}

function upsertLastSeen(db, entry, apiKeyId = entry.apiKeyId || apiKeyIdForSync(db, entry.apiKey)) {
  upsertUsageLastSeen(db, [{
    dateKey: entry.timestamp.slice(0, 10),
    provider: entry.provider || "", model: entry.model || "", connectionId: entry.connectionId || "",
    apiKey: usageKeyIdentity(apiKeyId, entry.apiKey, entry.provider),
    endpoint: entry.endpoint || "", lastUsed: entry.timestamp,
  }]);
}

function historyLastSeen(db, where, params) {
  return db.all(`SELECT NULLIF(provider, '') AS provider, NULLIF(model, '') AS model,
    NULLIF(connectionId, '') AS connectionId, NULLIF(endpoint, '') AS endpoint,
    ${usageHistoryKeyColumnsSql(db)}, MAX(timestamp) AS timestamp
    FROM usageHistory h WHERE ${where} GROUP BY 1, 2, 3, 4, 5, 6`, params).map((row) => ({
    ...row, apiKey: usageKeyIdentity(row.usageKeyId, row.legacyKey, row.provider),
  }));
}

function readLastSeen(db, cutoff, end) {
  const endIso = end.toISOString();
  const endDay = endIso.slice(0, 10);
  const startIso = cutoff?.toISOString();
  const startDay = startIso?.slice(0, 10);
  const rows = db.all(`SELECT MAX(lastUsed) AS timestamp,
    NULLIF(provider, '') AS provider, NULLIF(model, '') AS model,
    NULLIF(connectionId, '') AS connectionId, apiKey, NULLIF(endpoint, '') AS endpoint
    FROM usageLastSeen WHERE dateKey < ?${startDay ? " AND dateKey > ?" : ""}
    GROUP BY provider, model, connectionId, apiKey, endpoint`, [endDay, ...(startDay ? [startDay] : [])]);
  // UTC interior days are summarized; only partial boundary days touch history.
  if (startDay && startDay < endDay) {
    for (const row of historyLastSeen(db, "timestamp >= ? AND timestamp < ?",
      [startIso, new Date(Date.parse(`${startDay}T00:00:00.000Z`) + 86400000).toISOString()])) rows.push(row);
  }
  for (const row of historyLastSeen(db, "timestamp >= ? AND timestamp <= ?",
    [startDay === endDay ? startIso : `${endDay}T00:00:00.000Z`, endIso])) rows.push(row);
  return rows;
}

/** Capture before dispatch, never in a completion callback. Null is the pre-cutover
 * generation. After cutover every producer must carry the captured billingEpoch;
 * missing or stale stamps fail closed, including events without idempotency IDs.
 */
export function getBillingEpochSync(db) {
  const row = db.get("SELECT value FROM kv WHERE scope = 'billing' AND key = 'epoch'");
  if (!row) return null;
  const epoch = parseJson(row.value, null);
  if (!isString(epoch) || !epoch.trim()) throw new Error("Invalid billing epoch storage");
  return epoch;
}

export async function getBillingEpoch() {
  return getBillingEpochSync(await getAdapter());
}

/** Call inside a transaction before any billing/job mutation. Shares the import
 * writer lock so a cutover cannot race between stamp validation and commit.
 */
export function assertBillingEpochSync(db, billingEpoch) {
  if (db.capabilities?.isPostgres) {
    if (!db.get(QUOTA_WRITE_LOCK_SQL_PG)) throw new Error("Usage storage is not initialized");
  } else {
    db.run(QUOTA_WRITE_LOCK_SQL);
  }
  const current = getBillingEpochSync(db);
  if ((billingEpoch ?? null) !== current) throw new Error("Stale or missing billing epoch");
}

// Event IDs already include their producer's scope. Hash the exact ID to
// preserve the existing global identity without retaining caller material.
const usageEventReceiptKey = (usageEventId) => createHash("sha256").update(usageEventId).digest("hex");

function claimUsageEventReceipt(db, usageEventId) {
  return db.run(`INSERT INTO kv(scope, key, value) VALUES('usageEventReceipts', ?, '1')
    ON CONFLICT(scope, key) DO NOTHING`, [usageEventReceiptKey(usageEventId)]).changes > 0;
}

/* An accepted-job receipt keeps the key row id so lifetime totals can still be
 * settled after history was pruned or reset. Settled receipts return to '1'. */
function setUsageEventReceiptSync(db, usageEventId, value) {
  db.run(`UPDATE kv SET value = ? WHERE scope = 'usageEventReceipts' AND key = ?`, [value, usageEventReceiptKey(usageEventId)]);
}

function acceptedReceiptSync(db, usageEventId) {
  const row = db.get(`SELECT value FROM kv WHERE scope = 'usageEventReceipts' AND key = ?`, [usageEventReceiptKey(usageEventId)]);
  const value = row ? parseJson(row.value, null) : null;
  return value?.state === "accepted" ? value : null;
}

// Re-derive one dimension's last-seen time after a row left it.
function refreshLastSeenSync(db, row) {
  const day = row.timestamp.slice(0, 10);
  const keyId = row.apiKeyId || apiKeyIdForSync(db, row.apiKey);
  const identity = usageKeyIdentity(keyId, row.apiKey, row.provider);
  const dims = [row.provider || "", row.model || "", row.connectionId || "", row.endpoint || ""];
  db.run(`DELETE FROM usageLastSeen WHERE dateKey = ? AND provider = ? AND model = ?
    AND connectionId = ? AND endpoint = ? AND apiKey = ?`, [day, ...dims, identity]);
  const groups = historyLastSeen(db, `timestamp >= ? AND timestamp < ? AND COALESCE(provider, '') = ?
    AND COALESCE(model, '') = ? AND COALESCE(connectionId, '') = ? AND COALESCE(endpoint, '') = ?`,
    [`${day}T00:00:00.000Z`, new Date(Date.parse(`${day}T00:00:00.000Z`) + 86400000).toISOString(), ...dims]);
  let previous = null;
  for (const group of groups) {
    if (group.apiKey === identity && (!previous || group.timestamp > previous)) previous = group.timestamp;
  }
  if (previous) upsertLastSeen(db, { ...row, timestamp: previous }, keyId);
}

// Apply a counter delta to the day that already holds an accepted row.
function addDayDeltaSync(db, row, delta) {
  const dateKey = toLocalDateKey(row.timestamp);
  const day = {};
  aggregateEntryToDay(day, {
    provider: row.provider, model: row.model, connectionId: row.connectionId, apiKey: row.apiKey, endpoint: row.endpoint,
    apiKeyId: row.apiKeyId || apiKeyIdForSync(db, row.apiKey), latencySamples: 0, ttftSamples: 0, timedCompletionTokens: 0, ...delta,
  });
  incrementUsageDailyRollup(db, dateKey, day);
}

// The stable key id of one usage row. The id carried from admission wins,
// because it survives a later secret change; the stored secret is the
// fallback for rows written before the stable id was recorded.
const apiKeyIdForSync = (db, apiKey, admittedApiKeyId = null) =>
  resolveUsageApiKeyIdSync(db, apiKey, admittedApiKeyId);

/* Upgrade an accepted row in place: one request, now with the terminal usage.
 * Accepted rows never carry tokens or cost, so the new values are the delta. */
function settleAcceptedRowSync(db, row, entry, costSplit) {
  const tokens = entry.tokens;
  // The row keeps its creation timestamp. Survives a restart for the health check.
  entry.meta = { ...entry.meta, completedAt: entry.timestamp };
  const columns = usageTokenColumns(tokens);
  db.run(`UPDATE usageHistory SET promptTokens = ?, completionTokens = ?, cost = ?, status = ?, tokens = ?, meta = ?,
    cachedTokens = ?, reasoningTokens = ?, cacheCreationTokens = ?, ${USAGE_COST_FIELDS.map((field) => `${field} = ?`).join(", ")}
    WHERE id = ? AND status = 'accepted'`, [
    tokens.prompt_tokens, tokens.completion_tokens, entry.cost, entry.status || "ok", stringifyJson(tokens), stringifyJson(entry.meta),
    columns.cachedTokens, columns.reasoningTokens, columns.cacheCreationTokens, ...USAGE_COST_FIELDS.map((field) => costSplit[field]), row.id,
  ]);
  const unknownCostRequests = (entry.cost === null ? 1 : 0) - 1;
  addDayDeltaSync(db, row, { tokens, cost: entry.cost, requests: 0, unknownCostRequests, ...costSplit });
  // The accepted row keeps its own attribution, so a request that started
  // before a secret change still settles against the same key.
  adjustApiKeyUsageSync(db, apiKeyIdForSync(db, row.apiKey, row.apiKeyId), { tokens: tokens.total_tokens, cost: entry.cost ?? 0, unknownCostRequests });
}

/** Preserve legacy event identities before history removal or portable export.
 * Call inside the same transaction as the purge/export. Receipts contain no
 * accounting data and are retained independently of dashboard history.
 */
export function backfillUsageEventReceiptsSync(db, cutoffIso = null, op = "<") {
  if (db.capabilities?.isPostgres && !db.get(QUOTA_WRITE_LOCK_SQL_PG)) {
    throw new Error("Usage storage is not initialized");
  }
  // Retained analytics may include events newer than restored accounting.
  // After a cutover, receipts already commit with every new event; importing
  // old history identities would mix snapshots and resurrect discarded receipts.
  if (db.get("SELECT value FROM kv WHERE scope = 'billing' AND key = 'cutoverVersion'")?.value === "1") return;
  const where = cutoffIso === null ? "" : ` AND timestamp ${op === ">=" ? ">=" : "<"} ?`;
  for (const row of db.all(`SELECT usageEventId FROM usageHistory
    WHERE usageEventId IS NOT NULL AND usageEventId <> ''${where}`, cutoffIso === null ? [] : [cutoffIso])) {
    claimUsageEventReceipt(db, row.usageEventId);
  }
}

// Only identified best-effort events on better-sqlite3 may be replayed. Its
// transaction wrapper rolls back on failure; the durable receipt also protects
// against duplicate accounting. Other adapters and strict callers retain their
// existing failure behavior. Delays yield instead of blocking the event loop.
async function commitUsageTransaction(db, entry, write) {
  const delays = [25, 100, 250];
  for (let attempt = 0; ; attempt++) {
    try {
      return db.transaction(write);
    } catch (error) {
      if (entry.strict || !entry.usageEventId || db.driver !== "better-sqlite3" ||
          error?.code !== "SQLITE_BUSY" || attempt === delays.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

/**
 * Commit one event to history, daily aggregates and key totals atomically.
 * Explicit cost is USD: known finite nonnegative values (including zero) are
 * never repriced. Unknown/estimated native costs may use an operator tariff. costStatus is known (authoritative), estimated,
 * or unknown. Missing cost uses provider token charges, then configured pricing.
 * Metadata retains modality, nativeUnits and cost provenance. Aggregates sum
 * known numeric charges only; unknownCostRequests preserves unpriced daily and
 * dimension counts. Zero aggregate spend does not imply free usage.
 * usageEventId identifies retries, not identical payloads. Its durable kv receipt
 * commits with accounting and survives history resets. strict propagates
 * validation and storage errors; successful duplicates return true.
 *
 * apiKeyId is the stable id of the key that was admitted for this event. It
 * is authoritative over the stored secret: only the id survives a later
 * secret change, so the request stays attached to the key's budgets. The
 * secret is still stored, and legacy rows without an id keep their existing
 * scoped association through it.
 */
export async function saveRequestUsage(entry) {
  entry = { ...entry };
  try {
    // MCP records terminal tool calls only; accepted-job settlement is unsupported.
    if (entry.provider === "mcp-gateway" && entry.status === "accepted") {
      throw new TypeError("MCP usage must be terminal");
    }
    const db = await getAdapter();

    if (entry.usageEventId != null && (!isString(entry.usageEventId) || !entry.usageEventId.trim())) {
      throw new TypeError("Usage event ID must be a nonempty string");
    }
    if (entry.apiKeyId != null && (!isString(entry.apiKeyId) || !entry.apiKeyId.trim())) {
      throw new TypeError("Usage API key ID must be a nonempty string");
    }
    if (entry.timestamp === undefined) entry.timestamp = new Date().toISOString();
    if (!isString(entry.timestamp) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(entry.timestamp) ||
        !Number.isFinite(Date.parse(entry.timestamp)) ||
        new Date(`${entry.timestamp.slice(0, 10)}T00:00:00.000Z`).toISOString().slice(0, 10) !== entry.timestamp.slice(0, 10)) {
      throw new TypeError("Usage timestamp must be a valid ISO timestamp");
    }
    entry.timestamp = new Date(entry.timestamp).toISOString();
    if (entry.tokens != null && (!isObject(entry.tokens) || Array.isArray(entry.tokens))) {
      throw new TypeError("Usage tokens must be an object");
    }
    entry.tokens = normalizeLedgerTokens(entry.tokens ?? {});
    let priced;
    if (entry.cost !== undefined) {
      const costStatus = entry.costStatus ?? (entry.cost === null ? "unknown" : "known");
      if (!["known", "estimated", "unknown"].includes(costStatus) ||
          (costStatus === "unknown" ? entry.cost !== null :
            !isNumber(entry.cost) || !Number.isFinite(entry.cost) || entry.cost < 0)) {
        throw new TypeError("Usage cost must match known, estimated or unknown costStatus");
      }
      priced = { cost: entry.cost, split: null, costStatus, costSource: entry.costSource ?? (costStatus === "unknown" ? "unavailable" : "caller") };
    } else {
      if (entry.costStatus !== undefined || entry.costSource !== undefined) throw new TypeError("Usage cost provenance requires an explicit cost");
      priced = await calculateCost(entry.provider, entry.model, entry.tokens);
    }
    if (!isString(priced.costSource) || !priced.costSource.trim()) throw new TypeError("Usage costSource must be nonempty");
    if (entry.nativeUnits !== undefined && (entry.nativeUnits === null || !isObject(entry.nativeUnits) || Array.isArray(entry.nativeUnits) ||
        Object.values(entry.nativeUnits).some((value) => !isNumber(value) || !Number.isFinite(value) || value < 0))) {
      throw new TypeError("Usage nativeUnits must contain finite nonnegative numbers");
    }
    // A reported token-shaped USD receipt outranks a handler's provisional
    // native estimate (for example STT's builtin per-minute fallback).
    if (entry.modality && priced.costStatus !== "known") {
      const field = ["cost_usd", "cost_in_usd", "cost_in_usd_ticks"].find((name) => entry.tokens[name] != null);
      const receipt = field ? entry.tokens[field] : undefined;
      if (isNumber(receipt) && Number.isFinite(receipt) && receipt >= 0) {
        priced = await calculateCost(entry.provider, entry.model, entry.tokens);
      }
    }
    // Provider receipts are authoritative. An operator tariff can replace an
    // unavailable or estimated native valuation, never a known numeric charge.
    // Native tariffs never price chat, whose rows must not depend on them.
    if (entry.modality && entry.modality !== "chat" && priced.costStatus !== "known") {
      const { resolveNativePricing } = await import("./pricingRepo.js");
      const nativePrice = await resolveNativePricing(entry.provider, entry.model, entry.modality, entry.nativeUnits);
      // Both unknown: keep the caller's source, which says why (e.g. accepted-job).
      if (nativePrice && !(nativePrice.cost === null && priced.cost === null)) priced = nativePrice;
    }
    entry.cost = priced.cost;
    const accepted = entry.status === "accepted";
    if (accepted && (!entry.usageEventId || entry.cost !== null || entry.tokens.total_tokens > 0)) {
      throw new TypeError("Accepted usage needs an event id and no measured cost or tokens");
    }
    entry.requests = 1;
    entry.unknownCostRequests = entry.cost === null ? 1 : 0;
    entry.meta = { ...entry.meta, costStatus: priced.costStatus, costSource: priced.costSource };
    // Reserved ledger evidence must describe this valuation, not caller metadata.
    if (priced.pricing) entry.meta.pricing = priced.pricing;
    else delete entry.meta.pricing;
    if (entry.modality !== undefined) entry.meta.modality = entry.modality;
    if (entry.nativeUnits !== undefined) entry.meta.nativeUnits = entry.nativeUnits;
    const costSplit = priced.split || Object.fromEntries(USAGE_COST_FIELDS.map((field) => [field, null]));

    const tokens = entry.tokens || {};
    const promptTokens = tokens.prompt_tokens;
    const completionTokens = tokens.completion_tokens;
    // Stored on the usage row itself so throughput aggregates per model,
    // account and key without joining requestDetails. 0 means "not timed".
    for (const field of ["latencyMs", "ttftMs"]) {
      if (entry[field] != null && (!isNumber(entry[field]) || !Number.isFinite(entry[field]) || entry[field] < 0)) {
        throw new TypeError("Usage timing must contain finite nonnegative numbers");
      }
    }
    const latencyMs = Math.round(entry.latencyMs ?? 0);
    const ttftMs = Math.round(entry.ttftMs ?? 0);
    // The writer accepts one event, never caller-supplied aggregate samples.
    entry.latencySamples = latencyMs > 0 ? 1 : 0;
    entry.ttftSamples = ttftMs > 0 ? 1 : 0;
    entry.timedCompletionTokens = latencyMs > ttftMs ? completionTokens : 0;

    let inserted = false;
    let settled = false;
    // The key this event was charged to, resolved inside the transaction.
    let attributedApiKeyId = null;

    // Every request is a distinct event — never deduplicate on identical field
    // payloads, or parallel writes that share fields (same timestamp + provider +
    // model + connectionId + tokens) would silently clobber each other (write loss).
    // Only an explicit idempotency key (`usageEventId`) dedupes — that is a real
    // retry of the SAME logical event, not a coincidentally-identical new event.
    // All writes (receipt claim, history insert, daily upsert, lifetime counter) happen in ONE
    // transaction; better-sqlite3/node:sqlite are synchronous, so no JS yield
    // occurs mid-transaction and the writes remain atomic/serialized in-process.
    // Scope storage identity, not the caller's request ID used by live sessions.
    const usageEventId = entry.usageEventId && entry.billingEpoch != null ?
      JSON.stringify(["billing", entry.billingEpoch, entry.usageEventId]) : entry.usageEventId;
    await commitUsageTransaction(db, entry, () => {
      inserted = false;
      settled = false;
      attributedApiKeyId = null;
      // Reuse the quota writer lock: the schema row exists even when this day
      // and lifetime counter do not. PostgreSQL holds it until commit/rollback.
      // ponytail: global writer lock; use per-day locks if throughput demands it.
      assertBillingEpochSync(db, entry.billingEpoch);
      // Idempotency: only when the caller supplies a real event id.
      if (entry.usageEventId) {
        const claimed = claimUsageEventReceipt(db, usageEventId);
        const existing = db.get(`SELECT * FROM usageHistory WHERE usageEventId = ?`, [usageEventId]);
        if (existing) {
          // A terminal event with the job's identity settles its accepted row.
          if (existing.status === "accepted" && !accepted) {
            settleAcceptedRowSync(db, existing, entry, costSplit);
            attributedApiKeyId = apiKeyIdForSync(db, existing.apiKey, existing.apiKeyId);
            setUsageEventReceiptSync(db, usageEventId, "1");
            settled = true;
            return;
          }
          if (!existing.endpoint && entry.endpoint) {
            db.run(`UPDATE usageHistory SET endpoint = ? WHERE id = ?`, [entry.endpoint, existing.id]);
            // Endpoint enrichment moves a row between dimension groups.
            refreshLastSeenSync(db, existing);
            upsertLastSeen(db, { ...existing, endpoint: entry.endpoint });
          }
          return;
        }
        if (!claimed) {
          // History holding the accepted row was pruned or reset; lifetime totals were not.
          const receipt = !accepted && acceptedReceiptSync(db, usageEventId);
          if (receipt) {
            adjustApiKeyUsageSync(db, receipt.apiKeyId, { tokens: entry.tokens.total_tokens, cost: entry.cost ?? 0, unknownCostRequests: (entry.cost === null ? 1 : 0) - 1 });
            setUsageEventReceiptSync(db, usageEventId, "1");
            settled = true;
          }
          return;
        }
      }

      // The stable key id rides along with the row. It is the key's account,
      // not its credential, so the row stays attached to the key's budgets
      // even when the secret changes later.
      const apiKeyId = apiKeyIdForSync(db, entry.apiKey, entry.apiKeyId);
      attributedApiKeyId = apiKeyId;
      // The writer lock serializes admission of new labels across concurrent writes.
      // Existing labels continue to work at the cap; excess labels are discarded,
      // never the billable usage event. Only retained history counts toward the cap.
      const boundedLabel = (column, value) => {
        if (!apiKeyId || !validAttributionValue(value)) return null;
        const existing = db.get(`SELECT 1 AS found FROM usageHistory WHERE apiKeyId = ? AND ${column} = ? LIMIT 1`, [apiKeyId, value]);
        if (existing) return value;
        const count = db.get(`SELECT COUNT(DISTINCT ${column}) AS count FROM usageHistory WHERE apiKeyId = ?`, [apiKeyId]);
        return Number(count?.count || 0) < MAX_ATTRIBUTION_VALUES ? value : null;
      };
      const usageSessionId = boundedLabel("usageSessionId", entry.usageAttribution?.sessionId);
      const usageProjectId = boundedLabel("usageProjectId", entry.usageAttribution?.projectId);
      const historyColumns = [
        "timestamp", "provider", "model", "connectionId", "apiKey", "endpoint",
        "promptTokens", "completionTokens", "cost", "status", "tokens", "meta",
        "usageEventId", "comboId", "comboName", "usageSessionId", "usageProjectId",
        "cachedTokens", "reasoningTokens", "cacheCreationTokens",
        "latencyMs", "ttftMs", ...USAGE_COST_FIELDS,
      ];
      const historyValues = [
        entry.timestamp, entry.provider || null, entry.model || null,
        entry.connectionId || null, apiKeyId && entry.provider !== "mcp-gateway" ? null : (usageKeyIdentity(null, entry.apiKey, entry.provider) || null), entry.endpoint || null,
        promptTokens, completionTokens, entry.cost, entry.status || "ok",
        stringifyJson(tokens), stringifyJson(entry.meta), usageEventId || null,
        entry.comboId || null, entry.comboName || null, usageSessionId, usageProjectId, ...Object.values(usageTokenColumns(tokens)),
        latencyMs, ttftMs, ...USAGE_COST_FIELDS.map((field) => costSplit[field]),
      ];
      // A database that predates the stable id keeps its old shape; its rows
      // stay attributed through the secret association alone.
      if (hasStableApiKeyIdColumn(db)) {
        historyColumns.splice(5, 0, "apiKeyId");
        historyValues.splice(5, 0, apiKeyId);
      }
      const insert = db.run(
        `INSERT OR IGNORE INTO usageHistory(${historyColumns.join(", ")}) VALUES(${historyColumns.map(() => "?").join(", ")})`,
        historyValues
      );
      if ((insert?.changes ?? 0) === 0) return;
      upsertLastSeen(db, entry, apiKeyId);

      const dateKey = toLocalDateKey(entry.timestamp);
      const day = {};
      aggregateEntryToDay(day, { ...entry, apiKeyId, latencyMs, ttftMs, ...costSplit });
      incrementUsageDailyRollup(db, dateKey, day);

      // Atomic counter increment in same transaction
      db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', '1')
        ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(_meta.value AS BIGINT) + 1 AS TEXT)`);
      // Failed MCP calls remain attributed in history/daily stats, but do not
      // consume key policy totals. Other providers' errors still count.
      if (apiKeyId && !(entry.provider === "mcp-gateway" && entry.status === "error")) {
        incrementApiKeyUsageSync(db, apiKeyId, {
          tokens: tokens.total_tokens,
          cost: entry.cost
        });
      }
      if (accepted) setUsageEventReceiptSync(db, usageEventId, stringifyJson({ state: "accepted", apiKeyId }));
      inserted = true;
    });

    if (settled) {
      // Keep the accepted item's place and time, as the history row does.
      recentRing.items = recentRing.items.map((item) => item.storedEventId === usageEventId && item.status === "accepted" ?
        { ...item, cost: entry.cost, status: entry.status || "ok", tokens: entry.tokens, meta: entry.meta, completedAt: entry.timestamp } : item);
      scheduleStatsEvent("update", 250);
      if (entry.apiKey) statsEmitter.emit("apiKeyUsage", entry.apiKey, entry.provider === "mcp-gateway" && entry.status === "error" ? 0 : (Number(promptTokens) || 0) + (Number(completionTokens) || 0), attributedApiKeyId);
    }

    if (inserted) {
      pushToRing({ ...entry, apiKey: usageKeyIdentity(attributedApiKeyId, entry.apiKey, entry.provider), storedEventId: usageEventId });
      // Non-success usage remains billable history but must not overwrite the
      // request lifecycle's error/cancellation state with a completed session.
      if (!entry.status || entry.status === "ok") {
        finishActiveSession({ requestId: entry.usageEventId, promptTokens, completionTokens, status: "done" });
      }
      scheduleStatsEvent("update", 250);
      // Not debounced: per-key limit caches must see new usage immediately,
      // and the tokens-per-minute window is fed from this event.
      if (entry.apiKey) statsEmitter.emit("apiKeyUsage", entry.apiKey, entry.provider === "mcp-gateway" && entry.status === "error" ? 0 : (Number(promptTokens) || 0) + (Number(completionTokens) || 0), attributedApiKeyId);
    }
    return true;
  } catch (e) {
    console.error("Failed to save usage stats:", e);
    const msg = String(e && e.message || "");
    if (entry.strict || /syntax error|does not exist|collation/i.test(msg)) throw e;
    return false;
  }
}

/**
 * Remove an accepted job's row when the provider reported the job failed, so it
 * consumes no successful-use allowance. Idempotent; a settled or missing event is
 * left alone. The receipt stays claimed, so a later replay cannot add the event.
 * billingEpoch is the job's creation epoch.
 */
export async function retractAcceptedUsage({ usageEventId, billingEpoch }) {
  if (!isString(usageEventId) || !usageEventId.trim()) throw new TypeError("Usage event ID must be a nonempty string");
  const db = await getAdapter();
  const storageId = billingEpoch != null ? JSON.stringify(["billing", billingEpoch, usageEventId]) : usageEventId;
  let changed = false;
  db.transaction(() => {
    assertBillingEpochSync(db, billingEpoch);
    const receipt = acceptedReceiptSync(db, storageId);
    if (!receipt) return;
    const row = db.get(`SELECT * FROM usageHistory WHERE usageEventId = ? AND status = 'accepted'`, [storageId]);
    if (row) {
      db.run(`DELETE FROM usageHistory WHERE id = ?`, [row.id]);
      addDayDeltaSync(db, row, { tokens: {}, cost: 0, requests: -1, unknownCostRequests: -1 }, getOrCreateUsageIdentitySalt(db));
      refreshLastSeenSync(db, row);
      db.run(`UPDATE _meta SET value = CAST(CAST(value AS BIGINT) - 1 AS TEXT) WHERE key = 'totalRequestsLifetime'`);
    }
    adjustApiKeyUsageSync(db, receipt.apiKeyId, { requests: -1, unknownCostRequests: -1 });
    setUsageEventReceiptSync(db, storageId, "1");
    changed = true;
  });
  if (changed) {
    recentRing.items = recentRing.items.filter((item) => !(item.storedEventId === storageId && item.status === "accepted"));
    scheduleStatsEvent("update", 250);
  }
}

// Usage totals for one API key: today, optionally this week, and this month
// (used by per-key limits). One scan from the earliest window start covers all.
// COALESCE preserves historical NULL provider/status rows; only explicit MCP errors are exempt.
//
// The window belongs to the key, not to its secret. Rows carrying the stable
// key id are counted directly; legacy rows without one keep their existing
// scoped association through the stored secret. The two branches are disjoint,
// so a row is never counted twice, and a later secret change cannot empty a
// key's window.
export async function getApiKeyWindowUsageTotals(apiKey, dayStartIso, monthStartIso, apiKeyId = null, weekStartIso = null) {
  const empty = () => ({ inputTokens: 0, outputTokens: 0, requests: 0, cost: 0, unknownCostRequests: 0 });
  const withWeek = Boolean(weekStartIso);
  if (!apiKey && !apiKeyId) {
    const none = { day: empty() };
    if (withWeek) none.week = empty();
    none.month = empty();
    return none;
  }
  const db = await getAdapter();
  const resolvedId = apiKeyId || apiKeyIdForSync(db, apiKey);
  const scope = apiKeyUsageScope(db, { apiKeyId: resolvedId, apiKey });
  // One pass over the widest window; each period is a conditional sum. The
  // weekly window is optional so callers that never ask for it keep the
  // original { day, month } shape.
  const windows = [["day", dayStartIso], ...(withWeek ? [["week", weekStartIso]] : []), ["month", monthStartIso]];
  const columns = [];
  const columnParams = [];
  for (const [name, start] of windows) {
    const cap = name[0].toUpperCase() + name.slice(1);
    columns.push(
      `COALESCE(SUM(CASE WHEN timestamp >= ? THEN promptTokens ELSE 0 END), 0) AS in${cap}`,
      `COALESCE(SUM(CASE WHEN timestamp >= ? THEN completionTokens ELSE 0 END), 0) AS out${cap}`,
      `COALESCE(SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END), 0) AS req${cap}`,
      `COALESCE(SUM(CASE WHEN timestamp >= ? THEN cost ELSE 0 END), 0) AS cost${cap}`,
      `COALESCE(SUM(CASE WHEN timestamp >= ? AND cost IS NULL THEN 1 ELSE 0 END), 0) AS unk${cap}`
    );
    columnParams.push(start, start, start, start, start);
  }
  const earliest = windows.map(([, start]) => start).sort()[0];
  const row = db.get(
    `SELECT ${columns.join(",\n       ")}
     FROM usageHistory WHERE ${scope.clause} AND timestamp >= ?
       AND NOT (COALESCE(provider, '') = 'mcp-gateway' AND COALESCE(status, '') = 'error')`,
    [...columnParams, ...scope.params, earliest]
  );
  const n = (v) => Number(v) || 0;
  const read = (cap) => ({
    inputTokens: n(row?.[`in${cap}`]),
    outputTokens: n(row?.[`out${cap}`]),
    requests: n(row?.[`req${cap}`]),
    cost: n(row?.[`cost${cap}`]),
    unknownCostRequests: n(row?.[`unk${cap}`]),
  });
  const totals = { day: read("Day") };
  if (withWeek) totals.week = read("Week");
  totals.month = read("Month");
  return totals;
}

export async function getUsageHistory(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) {conds.push("provider = ?");params.push(filter.provider);}
  if (filter.model) {conds.push("model = ?");params.push(filter.model);}
  if (filter.connectionId != null) {conds.push("connectionId = ?");params.push(filter.connectionId);}
  if (filter.startDate) {conds.push("timestamp >= ?");params.push(new Date(filter.startDate).toISOString());}
  if (filter.endDate) {conds.push("timestamp <= ?");params.push(new Date(filter.endDate).toISOString());}

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db.all(
    `SELECT timestamp, provider, model, connectionId, apiKey, apiKeyId, endpoint, cost, status, tokens,
            promptTokens, completionTokens, comboId, comboName
       FROM usageHistory ${where} ORDER BY id ASC`,
    params
  );

  return rows.map(mapUsageHistoryRow);
}

function mapUsageHistoryRow(r) {
  return {
    timestamp: r.timestamp, provider: r.provider, model: r.model,
    connectionId: r.connectionId, apiKeyMasked: maskApiKey(r.apiKeyId || r.apiKey), endpoint: r.endpoint,
    cost: r.cost, status: r.status,
    promptTokens: Number(r.promptTokens ?? parseJson(r.tokens, {}).prompt_tokens ?? 0),
    completionTokens: Number(r.completionTokens ?? parseJson(r.tokens, {}).completion_tokens ?? 0),
    tokens: {
      prompt_tokens: Number(r.promptTokens ?? parseJson(r.tokens, {}).prompt_tokens ?? 0),
      completion_tokens: Number(r.completionTokens ?? parseJson(r.tokens, {}).completion_tokens ?? 0),
      ...parseJson(r.tokens, {})
    },
    comboId: r.comboId,
    comboName: r.comboName
  };
}

/** A bounded history page; both filtering and pagination stay in SQL. */
export async function listUsageHistoryPage({ limit = 50, offset = 0, filters = {} } = {}) {
  const db = await getAdapter();
  const pageLimit = Number.isFinite(Number(limit)) ? Math.min(200, Math.max(1, Math.trunc(Number(limit)))) : 50;
  const pageOffset = Number.isFinite(Number(offset)) ? Math.max(0, Math.trunc(Number(offset))) : 0;
  const conds = [];
  const params = [];
  for (const column of ["provider", "model", "status", "connectionId"]) {
    if (filters[column] != null && filters[column] !== "") {
      conds.push(`${column} = ?`);
      params.push(filters[column]);
    }
  }
  if (filters.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filters.startDate).toISOString()); }
  if (filters.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filters.endDate).toISOString()); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const total = Number(db.get(`SELECT COUNT(*) AS total FROM usageHistory ${where}`, params)?.total || 0);
  const rows = db.all(
    `SELECT timestamp, provider, model, connectionId, apiKey, apiKeyId, endpoint, cost, status, tokens,
            promptTokens, completionTokens, comboId, comboName
       FROM usageHistory ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageLimit, pageOffset]
  );
  return { rows: rows.map(mapUsageHistoryRow), total };
}

function* loadDaysInRange(adapter, maxDays, now = new Date(), totalsOnly = false) {
  const todayKey = toLocalDateKey(now);
  const params = [];
  let lowerBound = "";
  if (maxDays != null) {
    const cutoff = new Date(now);
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - maxDays + 1);
    lowerBound = "dateKey >= ? AND ";
    params.push(toLocalDateKey(cutoff));
  }
  params.push(todayKey);
  yield* readUsageDailyRollups(adapter, `${lowerBound}dateKey < ?`, params, totalsOnly);

  // The current day is reconstructed from bounded history so a future-dated
  // imported row cannot contaminate any calendar-period aggregate.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayRows = aggregateUsageWindow(adapter, startOfToday.toISOString(), now.toISOString());
  if (todayRows.length > 0) {
    const day = aggregateRowsToDay(todayRows);
    yield { dateKey: todayKey, day };
  }
}

// Like loadDaysInRange but bounded by explicit inclusive local date keys
// (YYYY-MM-DD) instead of a rolling day count. Used by the usage page's custom
// calendar range. `endKey` >= today reconstructs the current day from live
// history, matching loadDaysInRange.
function* loadDaysInDateRange(adapter, startKey, endKey, now = new Date()) {
  const todayKey = toLocalDateKey(now);
  yield* readUsageDailyRollups(adapter, "dateKey >= ? AND dateKey <= ? AND dateKey < ?", [startKey, endKey, todayKey]);
  if (endKey >= todayKey && startKey <= todayKey) {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const todayRows = aggregateUsageWindow(adapter, startOfToday.toISOString(), now.toISOString());
    if (todayRows.length > 0) {
      const day = aggregateRowsToDay(todayRows);
      yield { dateKey: todayKey, day };
    }
  }
}

export async function getUsageStats(period = "all", opts = {}) {
  const db = await getAdapter();
  const identitySalt = getOrCreateUsageIdentitySalt(db);
  const now = new Date();

  const [{ getProviderConnections }, { getApiKeys }, { getProviderNodes }, { getGatewayKeys }] = await Promise.all([
  import("./connectionsRepo.js"),
  import("./apiKeysRepo.js"),
  import("./nodesRepo.js"),
  import("./mcpGatewayRepo.js")]
  );

  let allConnections = [];
  try {allConnections = await getProviderConnections();} catch (error) { logFallback("stats connection lookup failed", error); }
  const connectionMap = Object.create(null);
  for (const c of allConnections) connectionMap[c.id] = c.name || c.email || c.id;

  const providerNodeNameMap = Object.create(null);
  try {
    const nodes = await getProviderNodes();
    for (const n of nodes) if (n.id && n.name) providerNodeNameMap[n.id] = n.name;
  } catch (error) { logFallback("stats node lookup failed", error); }

  let allApiKeys = [];
  try {allApiKeys = await getApiKeys();} catch (error) { logFallback("stats API key lookup failed", error); }
  const apiKeyBySecret = new Map(allApiKeys.map((key) => [key.key, key]));
  const apiKeyById = new Map(allApiKeys.map((key) => [key.id, key]));
  let gatewayKeys = [];
  try {gatewayKeys = await getGatewayKeys();} catch (error) { logFallback("stats gateway key lookup failed", error); }
  const gatewayKeyByDigest = new Map(gatewayKeys.map((key) => [usageKeyIdentity(null, key.key, "mcp-gateway"), key]));

  // Resolve current labels for stable IDs without placing credentials in reports.
  const unknownApiKeyIds = new Map();
  function getPublicApiKeyIdentity(identity, provider) {
    if (!identity || identity === "local-no-key") {
      return { id: "local-no-key", keyName: "Local (No API Key)", apiKeyMasked: null };
    }
    const gatewayKey = provider === "mcp-gateway" ? gatewayKeyByDigest.get(identity) : null;
    if (gatewayKey) return {
      id: `mcp-gateway-key:${gatewayKey.id}`, keyName: gatewayKey.name || "MCP Gateway Key", apiKeyMasked: "***",
    };
    const keyInfo = provider !== "mcp-gateway" ? apiKeyById.get(identity) : null;
    if (keyInfo) return { id: `api-key:${keyInfo.id}`, keyName: keyInfo.name || "API Key", apiKeyMasked: "***" };
    const lookup = identity;
    if (!unknownApiKeyIds.has(lookup)) unknownApiKeyIds.set(lookup, unknownApiKeyIds.size + 1);
    return {
      id: `api-key:${fingerprintApiKey(lookup, identitySalt)}`,
      keyName: `Deleted API key ${unknownApiKeyIds.get(lookup)}`,
      apiKeyMasked: "***",
    };
  }

  function legacyIdentity(secret, provider) {
    return usageKeyIdentity(apiKeyBySecret.get(secret)?.id, secret, provider);
  }

  // recentRequests from live history (last 100 entries enough for 20 deduped)
  const recentRows = db.all(`SELECT h.id, h.usageEventId, h.timestamp, h.provider, h.model, h.tokens, h.status, ${usageHistoryKeyColumnsSql(db)} FROM usageHistory h ORDER BY h.id DESC LIMIT 100`);
  const seen = new Set();
  const recentRequests = recentRows.
  map((r) => {
    const t = parseJson(r.tokens, {}) || {};
    const identity = getPublicApiKeyIdentity(usageKeyIdentity(r.usageKeyId, r.legacyKey, r.provider), r.provider);
    return {
      eventKey: r.usageEventId ? `event:${r.usageEventId}` : `row:${r.id}`,
      apiKeyId: identity.id,
      keyName: identity.keyName,
      timestamp: r.timestamp, model: r.model, provider: r.provider || "",
      promptTokens: t.prompt_tokens || t.input_tokens || 0,
      completionTokens: t.completion_tokens || t.output_tokens || 0,
      cachedTokens: t.cached_tokens || t.cache_read_input_tokens || 0,
      status: r.status || "ok"
    };
  }).
  filter((e) => {
    if (e.promptTokens === 0 && e.completionTokens === 0) return false;
    const key = e.eventKey;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).
  slice(0, 20).map(({ eventKey, ...request }) => request);

  const stats = {
    totalRequestsLifetime: Number(db.get("SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'")?.value) || 0,
    totalRequests: 0,
    unknownCostRequests: 0,
    totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0,
    totalReasoningTokens: 0, totalCacheCreationTokens: 0, totalCost: 0,
    byProvider: Object.create(null), byModel: Object.create(null), byAccount: Object.create(null), byApiKey: Object.create(null), byEndpoint: Object.create(null),
    last10Minutes: [],
    pending: pendingRequests,
    activeRequests: [],
    activeSessions: [],
    recentRequests,
    errorProvider: Date.now() - lastErrorProvider.ts < 10000 ? lastErrorProvider.provider : ""
  };

  // Active requests
  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        stats.activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName,
          count,
          keys: getPendingKeyGroups(connectionId, modelKey),
        });
      }
    }
  }

  stats.activeSessions = await getActiveSessions();

  // last10Minutes — query 10min window
  const currentMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const tenMinutesAgo = new Date(currentMinuteStart.getTime() - 9 * 60 * 1000);
  const bucketMap = {};
  for (let i = 0; i < 10; i++) {
    const ts = currentMinuteStart.getTime() - (9 - i) * 60 * 1000;
    bucketMap[ts] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, unknownCostRequests: 0 };
    stats.last10Minutes.push(bucketMap[ts]);
  }
  const recent10 = db.all(
    `SELECT SUBSTR(timestamp, 1, 16) AS timestamp, COUNT(*) AS requests, SUM(promptTokens) AS promptTokens, SUM(completionTokens) AS completionTokens, SUM(cost) AS cost, SUM(CASE WHEN cost IS NULL THEN 1 ELSE 0 END) AS unknownCostRequests FROM usageHistory WHERE timestamp >= ? AND timestamp <= ? GROUP BY SUBSTR(timestamp, 1, 16)`,
    [tenMinutesAgo.toISOString(), now.toISOString()]
  );
  for (const r of recent10) {
    const tt = new Date(`${r.timestamp}:00.000Z`).getTime();
    const minuteStart = Math.floor(tt / 60000) * 60000;
    if (bucketMap[minuteStart]) {
      bucketMap[minuteStart].requests += Number(r.requests);
      bucketMap[minuteStart].promptTokens += r.promptTokens || 0;
      bucketMap[minuteStart].completionTokens += r.completionTokens || 0;
      bucketMap[minuteStart].cost += r.cost || 0;
      bucketMap[minuteStart].unknownCostRequests += Number(r.unknownCostRequests) || 0;
    }
  }

  // Custom calendar range (YYYY-MM-DD, inclusive). Validated defensively: both
  // present, well-formed, and start <= end. When active it forces the daily-
  // summary path bounded by the explicit dates, independent of the preset.
  const rawStart = isString(opts.startDate) ? opts.startDate.trim() : "";
  const rawEnd = isString(opts.endDate) ? opts.endDate.trim() : "";
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  let customStart = DATE_RE.test(rawStart) ? rawStart : "";
  let customEnd = DATE_RE.test(rawEnd) ? rawEnd : "";
  if (customStart && customEnd && customStart > customEnd) {
    [customStart, customEnd] = [customEnd, customStart];
  }
  const hasCustomRange = Boolean(customStart && customEnd);

  const useDailySummary = hasCustomRange || period !== "24h" && period !== "today";

  if (useDailySummary) {
    const maxDays = getUsagePeriodDays(period);
    const dayRows = hasCustomRange ?
    loadDaysInDateRange(db, customStart, customEnd, now) :
    loadDaysInRange(db, maxDays, now);

    for (const dr of dayRows) {
      const { dateKey, day } = dr;
      stats.totalRequests += Number(day.requests) || 0;
      stats.totalPromptTokens += day.promptTokens || 0;
      stats.totalCompletionTokens += day.completionTokens || 0;
      stats.totalCachedTokens += day.cachedTokens || 0;
      stats.totalReasoningTokens += day.reasoningTokens || 0;
      stats.totalCacheCreationTokens += day.cacheCreationTokens || 0;
      stats.totalCost += day.cost || 0;
      stats.unknownCostRequests += Number(day.unknownCostRequests) || 0;
      addLatency(stats, day, day.completionTokens || 0);

      for (const [prov, p] of Object.entries(day.byProvider || {})) {
        if (!stats.byProvider[prov]) stats.byProvider[prov] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0 };
        stats.byProvider[prov].requests += p.requests || 0;
        stats.byProvider[prov].promptTokens += p.promptTokens || 0;
        stats.byProvider[prov].completionTokens += p.completionTokens || 0;
        stats.byProvider[prov].cachedTokens += p.cachedTokens || 0;
        stats.byProvider[prov].reasoningTokens += p.reasoningTokens || 0;
        stats.byProvider[prov].cacheCreationTokens += p.cacheCreationTokens || 0;
        stats.byProvider[prov].cost += p.cost || 0;
        stats.byProvider[prov].unknownCostRequests = (stats.byProvider[prov].unknownCostRequests || 0) + (Number(p.unknownCostRequests) || 0);
        addLatency(stats.byProvider[prov], p, p.completionTokens || 0);
      }

      for (const [mk, m] of Object.entries(day.byModel || {})) {
        const rawModel = m.rawModel || mk.split("|")[0];
        const provider = m.provider || mk.split("|")[1] || "";
        const statsKey = provider ? `${rawModel} (${provider})` : rawModel;
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byModel[statsKey]) {
          stats.byModel[statsKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, rawModel, provider: providerDisplayName, rawProvider: provider, lastUsed: dateKey };
        }
        addCostSplit(stats.byModel[statsKey], m);
        stats.byModel[statsKey].requests += m.requests || 0;
        stats.byModel[statsKey].promptTokens += m.promptTokens || 0;
        stats.byModel[statsKey].completionTokens += m.completionTokens || 0;
        stats.byModel[statsKey].cachedTokens += m.cachedTokens || 0;
        stats.byModel[statsKey].reasoningTokens += m.reasoningTokens || 0;
        stats.byModel[statsKey].cacheCreationTokens += m.cacheCreationTokens || 0;
        stats.byModel[statsKey].cost += m.cost || 0;
        stats.byModel[statsKey].unknownCostRequests = (stats.byModel[statsKey].unknownCostRequests || 0) + (Number(m.unknownCostRequests) || 0);
        addLatency(stats.byModel[statsKey], m, m.completionTokens || 0);
        if (dateKey > (stats.byModel[statsKey].lastUsed || "")) stats.byModel[statsKey].lastUsed = dateKey;
      }

      for (const [dayKey, a] of Object.entries(day.byAccount || {})) {
        // A blob saved under the bare connection id may hold several models'
        // tokens under its last model's name. It gets its own row, so it
        // neither inflates nor stops the split of a per-model row.
        const legacy = !a.connectionId;
        const connId = a.connectionId || dayKey;
        const accountName = connectionMap[connId] || `Account ${connId.slice(0, 8)}...`;
        const rawModel = legacy ? LEGACY_ACCOUNT_MODEL : a.rawModel || "";
        const provider = a.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const accountKey = `${rawModel} (${provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, rawModel, provider: providerDisplayName, rawProvider: provider, connectionId: connId, accountName, lastUsed: dateKey };
        }
        addCostSplit(stats.byAccount[accountKey], a);
        if (legacy && Number(a.cost) > 0) stats.byAccount[accountKey].unsplit.mixed = true;
        stats.byAccount[accountKey].requests += a.requests || 0;
        stats.byAccount[accountKey].promptTokens += a.promptTokens || 0;
        stats.byAccount[accountKey].completionTokens += a.completionTokens || 0;
        stats.byAccount[accountKey].cachedTokens += a.cachedTokens || 0;
        stats.byAccount[accountKey].reasoningTokens += a.reasoningTokens || 0;
        stats.byAccount[accountKey].cacheCreationTokens += a.cacheCreationTokens || 0;
        stats.byAccount[accountKey].cost += a.cost || 0;
        stats.byAccount[accountKey].unknownCostRequests = (stats.byAccount[accountKey].unknownCostRequests || 0) + (Number(a.unknownCostRequests) || 0);
        addLatency(stats.byAccount[accountKey], a, a.completionTokens || 0);
        if (dateKey > (stats.byAccount[accountKey].lastUsed || "")) stats.byAccount[accountKey].lastUsed = dateKey;
      }

      for (const [akKey, ak] of Object.entries(day.byApiKey || {})) {
        const rawModel = ak.rawModel || akKey.split("|")[1] || "";
        const provider = ak.provider || akKey.split("|")[2] || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        // Old imported blobs may still have the original fingerprint in the
        // bucket key. New or migrated blobs carry the same identifier in both.
        const storedIdentity = ak.apiKey ?? akKey.split("|")[0];
        const keyIdentity = akKey === usageKeyStatsKey(storedIdentity, rawModel, provider)
          ? storedIdentity : legacyIdentity(ak.apiKey, provider);
        const identity = getPublicApiKeyIdentity(keyIdentity, provider);
        const { keyName, apiKeyMasked } = identity;
        const apiKeyKey = identity.id;
        const statsKey = usageKeyStatsKey(identity.id, rawModel, provider);
        if (!stats.byApiKey[statsKey]) {
          stats.byApiKey[statsKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, rawModel, provider: providerDisplayName, rawProvider: provider, apiKeyMasked, keyName, apiKeyKey, lastUsed: dateKey };
        }
        addCostSplit(stats.byApiKey[statsKey], ak);
        stats.byApiKey[statsKey].requests += ak.requests || 0;
        stats.byApiKey[statsKey].promptTokens += ak.promptTokens || 0;
        stats.byApiKey[statsKey].completionTokens += ak.completionTokens || 0;
        stats.byApiKey[statsKey].cachedTokens += ak.cachedTokens || 0;
        stats.byApiKey[statsKey].reasoningTokens += ak.reasoningTokens || 0;
        stats.byApiKey[statsKey].cacheCreationTokens += ak.cacheCreationTokens || 0;
        stats.byApiKey[statsKey].cost += ak.cost || 0;
        stats.byApiKey[statsKey].unknownCostRequests = (stats.byApiKey[statsKey].unknownCostRequests || 0) + (Number(ak.unknownCostRequests) || 0);
        addLatency(stats.byApiKey[statsKey], ak, ak.completionTokens || 0);
        if (dateKey > (stats.byApiKey[statsKey].lastUsed || "")) stats.byApiKey[statsKey].lastUsed = dateKey;
      }

      for (const [epKey, ep] of Object.entries(day.byEndpoint || {})) {
        const endpoint = ep.endpoint || epKey.split("|")[0] || "Unknown";
        const rawModel = ep.rawModel || "";
        const provider = ep.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byEndpoint[epKey]) {
          stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, endpoint, rawModel, provider: providerDisplayName, rawProvider: provider, lastUsed: dateKey };
        }
        addCostSplit(stats.byEndpoint[epKey], ep);
        stats.byEndpoint[epKey].requests += ep.requests || 0;
        stats.byEndpoint[epKey].promptTokens += ep.promptTokens || 0;
        stats.byEndpoint[epKey].completionTokens += ep.completionTokens || 0;
        stats.byEndpoint[epKey].cachedTokens += ep.cachedTokens || 0;
        stats.byEndpoint[epKey].reasoningTokens += ep.reasoningTokens || 0;
        stats.byEndpoint[epKey].cacheCreationTokens += ep.cacheCreationTokens || 0;
        stats.byEndpoint[epKey].cost += ep.cost || 0;
        stats.byEndpoint[epKey].unknownCostRequests = (stats.byEndpoint[epKey].unknownCostRequests || 0) + (Number(ep.unknownCostRequests) || 0);
        addLatency(stats.byEndpoint[epKey], ep, ep.completionTokens || 0);
        if (dateKey > (stats.byEndpoint[epKey].lastUsed || "")) stats.byEndpoint[epKey].lastUsed = dateKey;
      }
    }

    // Exact period bounds, with raw history restricted to partial UTC days.
    const overlayCutoff = hasCustomRange ? localDateFromKey(customStart) : maxDays == null ? null : getUsageCalendarCutoff(period, now);
    const customEndExclusive = hasCustomRange ? addLocalCalendarDays(localDateFromKey(customEnd), 1) : null;
    const overlayEnd = customEndExclusive && customEndExclusive <= now ? new Date(customEndExclusive.getTime() - 1) : now;
    const lastUsedRows = readLastSeen(db, overlayCutoff, overlayEnd);
    // Collapse before resolving public identities (which hash keys) or parsing
    // dates: those operations should run once per coarse group, not once per
    // combination of account, key and endpoint.
    const views = [new Map(), new Map(), new Map(), new Map()];
    for (const row of lastUsedRows) {
      const base = JSON.stringify([row.provider, row.model]);
      const keys = [base, `${base}:${JSON.stringify(row.connectionId)}`, `${base}:${JSON.stringify(row.apiKey)}`, `${base}:${JSON.stringify(row.endpoint)}`];
      for (let i = 0; i < views.length; i++) {
        const previous = views[i].get(keys[i]);
        // MAX(timestamp) compares stored text, exactly as the former SQL did.
        if (!previous || row.timestamp > previous.timestamp) views[i].set(keys[i], row);
      }
    }
    for (const e of views[0].values()) {
      const ts = e.timestamp;
      const modelKey = e.provider ? `${e.model} (${e.provider})` : e.model;
      if (stats.byModel[modelKey] && new Date(ts) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = ts;
    }
    for (const e of views[1].values()) {
      if (!e.connectionId) continue;
      const accountName = connectionMap[e.connectionId] || `Account ${e.connectionId.slice(0, 8)}...`;
      const accountKey = `${e.model} (${e.provider} - ${accountName})`;
      if (stats.byAccount[accountKey] && new Date(e.timestamp) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = e.timestamp;
    }
    for (const e of views[2].values()) {
      const identity = getPublicApiKeyIdentity(e.apiKey, e.provider);
      const apiKeyKey = usageKeyStatsKey(identity.id, e.model, e.provider);
      if (stats.byApiKey[apiKeyKey] && new Date(e.timestamp) > new Date(stats.byApiKey[apiKeyKey].lastUsed)) stats.byApiKey[apiKeyKey].lastUsed = e.timestamp;
    }
    for (const e of views[3].values()) {
      const endpoint = e.endpoint || "Unknown";
      const endpointKey = `${endpoint}|${e.model}|${e.provider || "unknown"}`;
      if (stats.byEndpoint[endpointKey] && new Date(e.timestamp) > new Date(stats.byEndpoint[endpointKey].lastUsed)) stats.byEndpoint[endpointKey].lastUsed = e.timestamp;
    }
  } else {
    // 24h / today: live history
    let cutoff;
    if (period === "today") {
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      cutoff = startOfDay.toISOString();
    } else {
      cutoff = new Date(now.getTime() - PERIOD_MS["24h"]).toISOString();
    }
    const filtered = aggregateUsageWindow(db, cutoff, now.toISOString());

    for (const r of filtered) {
      const tokens = r.tokens;
      const promptTokens = tokens.prompt_tokens || 0;
      const completionTokens = tokens.completion_tokens || 0;
      const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
      const reasoningTokens = tokens.reasoning_tokens ||
      tokens.completion_tokens_details?.reasoning_tokens ||
      tokens.output_tokens_details?.reasoning_tokens ||
      0;
      const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
      const entryCost = r.cost || 0;
      const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;

      stats.totalRequests += r.requests;
      stats.totalPromptTokens += promptTokens;
      stats.totalCompletionTokens += completionTokens;
      stats.totalCachedTokens += cachedTokens;
      stats.totalReasoningTokens += reasoningTokens;
      stats.totalCacheCreationTokens += cacheCreationTokens;
      stats.totalCost += entryCost;
      stats.unknownCostRequests += Number(r.unknownCostRequests) || 0;
      addLatency(stats, r, completionTokens);

      if (!stats.byProvider[r.provider]) stats.byProvider[r.provider] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0 };
      stats.byProvider[r.provider].requests += r.requests;
      stats.byProvider[r.provider].promptTokens += promptTokens;
      stats.byProvider[r.provider].completionTokens += completionTokens;
      stats.byProvider[r.provider].cachedTokens += cachedTokens;
      stats.byProvider[r.provider].reasoningTokens += reasoningTokens;
      stats.byProvider[r.provider].cacheCreationTokens += cacheCreationTokens;
      stats.byProvider[r.provider].cost += entryCost;
      addLatency(stats.byProvider[r.provider], r, completionTokens);
      stats.byProvider[r.provider].unknownCostRequests = (stats.byProvider[r.provider].unknownCostRequests || 0) + (Number(r.unknownCostRequests) || 0);

      const modelKey = r.provider ? `${r.model} (${r.provider})` : r.model;
      if (!stats.byModel[modelKey]) {
        stats.byModel[modelKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, rawProvider: r.provider, lastUsed: r.timestamp };
      }
      addCostSplit(stats.byModel[modelKey], r);
      stats.byModel[modelKey].requests += r.requests;
      stats.byModel[modelKey].promptTokens += promptTokens;
      stats.byModel[modelKey].completionTokens += completionTokens;
      stats.byModel[modelKey].cachedTokens += cachedTokens;
      stats.byModel[modelKey].reasoningTokens += reasoningTokens;
      stats.byModel[modelKey].cacheCreationTokens += cacheCreationTokens;
      stats.byModel[modelKey].cost += entryCost;
      addLatency(stats.byModel[modelKey], r, completionTokens);
      stats.byModel[modelKey].unknownCostRequests = (stats.byModel[modelKey].unknownCostRequests || 0) + (Number(r.unknownCostRequests) || 0);
      if (new Date(r.timestamp) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = r.timestamp;

      if (r.connectionId) {
        const accountName = connectionMap[r.connectionId] || `Account ${r.connectionId.slice(0, 8)}...`;
        const accountKey = `${r.model} (${r.provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, rawProvider: r.provider, connectionId: r.connectionId, accountName, lastUsed: r.timestamp };
        }
        addCostSplit(stats.byAccount[accountKey], r);
        stats.byAccount[accountKey].requests += r.requests;
        stats.byAccount[accountKey].promptTokens += promptTokens;
        stats.byAccount[accountKey].completionTokens += completionTokens;
        stats.byAccount[accountKey].cachedTokens += cachedTokens;
        stats.byAccount[accountKey].reasoningTokens += reasoningTokens;
        stats.byAccount[accountKey].cacheCreationTokens += cacheCreationTokens;
        stats.byAccount[accountKey].cost += entryCost;
        addLatency(stats.byAccount[accountKey], r, completionTokens);
        stats.byAccount[accountKey].unknownCostRequests = (stats.byAccount[accountKey].unknownCostRequests || 0) + (Number(r.unknownCostRequests) || 0);
        if (new Date(r.timestamp) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = r.timestamp;
      }

      const identity = getPublicApiKeyIdentity(r.keyIdentity, r.provider);
      const { keyName, apiKeyMasked } = identity;
      const apiKeyKey = identity.id;
      const akKey = usageKeyStatsKey(identity.id, r.model, r.provider);
      if (!stats.byApiKey[akKey]) {
        stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, rawProvider: r.provider, apiKeyMasked, keyName, apiKeyKey, lastUsed: r.timestamp };
      }
      const ake = stats.byApiKey[akKey];
      addCostSplit(ake, r);
      ake.requests += r.requests;ake.promptTokens += promptTokens;ake.completionTokens += completionTokens;ake.cachedTokens += cachedTokens;ake.reasoningTokens += reasoningTokens;ake.cacheCreationTokens += cacheCreationTokens;ake.cost += entryCost;
      addLatency(ake, r, completionTokens);
      ake.unknownCostRequests = (ake.unknownCostRequests || 0) + (Number(r.unknownCostRequests) || 0);
      if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;

      const endpoint = r.endpoint || "Unknown";
      const epKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
      if (!stats.byEndpoint[epKey]) {
        stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, endpoint, rawModel: r.model, provider: providerDisplayName, rawProvider: r.provider, lastUsed: r.timestamp };
      }
      const epe = stats.byEndpoint[epKey];
      addCostSplit(epe, r);
      epe.requests += r.requests;epe.promptTokens += promptTokens;epe.completionTokens += completionTokens;epe.cachedTokens += cachedTokens;epe.reasoningTokens += reasoningTokens;epe.cacheCreationTokens += cacheCreationTokens;epe.cost += entryCost;
      addLatency(epe, r, completionTokens);
      epe.unknownCostRequests = (epe.unknownCostRequests || 0) + (Number(r.unknownCostRequests) || 0);
      if (new Date(r.timestamp) > new Date(epe.lastUsed)) epe.lastUsed = r.timestamp;
    }
  }

  await applyCostBreakdowns(stats);

  // Summed latency becomes rates exactly once, here, so the daily rollup and
  // the live-history path cannot drift apart.
  Object.assign(stats, deriveLatencyRates(stats));
  // How many requests actually carried timing. The rates above describe this
  // subset, so the UI can say so instead of implying the whole period was timed.
  stats.timedRequests = stats.latencySamples || 0;
  for (const bucket of ["byProvider", "byModel", "byAccount", "byApiKey", "byEndpoint"]) {
    for (const entry of Object.values(stats[bucket])) Object.assign(entry, deriveLatencyRates(entry));
  }

  // Prompt tokens are cache-inclusive, so cached / prompt is the hit ratio (port of 9router #1900).
  stats.cacheHitRatio = stats.totalPromptTokens > 0
    ? Math.min(1, stats.totalCachedTokens / stats.totalPromptTokens) : 0;

  // Aggregate Token Saver telemetry for the dashboard (port of 9router #2562).
  stats.tokenSaver = await getTokenSaverStats(period);
  return stats;
}

/**
 * Price the part of a bucket that has no stored split, then scale the result
 * to the cost recorded for that part.
 *
 * Summed tokens cannot say which requests crossed a long-context tier. With no
 * tier, or one that scales input and output alike, the ratios do not depend on
 * that, so scaling to the stored cost is exact. With unequal multipliers they
 * do, so no split is derived.
 *
 * @param {object} rest - Summed token counters and `cost` of the unsplit rows
 * @param {object|null} pricing - Rates for the bucket's model, or null when unknown
 * @param {(tokens: object, pricing: object) => object} calc - `calculateCostBreakdown`
 * @returns {object|null} The five cost fields, or null when no split can be derived
 */
function splitUnsplitCost(rest, pricing, calc) {
  if (!pricing) return null;
  const tiered = Number.isFinite(pricing.longContextThreshold) &&
  (pricing.longContextInputMultiplier || 1) !== (pricing.longContextOutputMultiplier || 1);
  if (tiered) return null;
  const ratedCost = calc({
    prompt_tokens: rest.promptTokens || 0,
    completion_tokens: rest.completionTokens || 0,
    cached_tokens: rest.cachedTokens || 0,
    cache_creation_input_tokens: rest.cacheCreationTokens || 0,
    reasoning_tokens: rest.reasoningTokens || 0
  }, { ...pricing, longContextThreshold: Infinity });
  if (!(ratedCost.totalCost > 0)) return null;
  const scale = (rest.cost || 0) / ratedCost.totalCost;
  const split = {};
  for (const field of USAGE_COST_FIELDS) split[field] = ratedCost[field] * scale;
  return split;
}

/**
 * Finish the per-rate cost split of every dimension bucket.
 *
 * The dashboard used to divide each total by token share on the client, which
 * priced cached input like fresh input and collapsed output to a rounding
 * error on cache-heavy traffic. Each usage row now stores its own split, so a
 * bucket's split is the sum of its rows'. Rows without one are priced here when
 * that is exact (see {@link splitUnsplitCost}); otherwise their cost is
 * published as `unsplitCost`, next to the exact part, instead of guessed at.
 *
 * Provider totals are summed from the model buckets rather than priced again,
 * because a provider row spans several models with different rates.
 *
 * @param {object} stats - Mutated in place
 * @param {(provider: string, model: string) => Promise<object|null>} [lookupPricing] - Defaults to the pricing repo
 */
export async function applyCostBreakdowns(stats, lookupPricing) {
  const [{ getPricingForModel }, { calculateCostBreakdown }] = await Promise.all([
  import("./pricingRepo.js"),
  import("open-sse/providers/pricing.js")]
  );
  const lookup = lookupPricing || getPricingForModel;

  // One await per distinct provider|model, not one per bucket. A failed lookup
  // is logged and not cached, so a transient error does not stick for the call.
  const pricingCache = new Map();
  const pricingFor = async (provider, model) => {
    if (!provider || !model) return null;
    const key = `${provider}|${model}`;
    if (pricingCache.has(key)) return pricingCache.get(key);
    try {
      const pricing = await lookup(provider, model);
      pricingCache.set(key, pricing);
      return pricing;
    } catch (error) {
      console.error(`[usage] pricing lookup failed for ${key}:`, error?.message || error);
      return null;
    }
  };

  // Stored splits are exact and always published. A remainder that cannot be
  // priced exactly is reported as `unsplitCost` rather than guessed at, so the
  // category columns plus `unsplitCost` equal the bucket's cost.
  const bucketSplit = async (entry) => {
    const rest = entry.unsplit;
    const split = { unsplitCost: 0 };
    for (const field of USAGE_COST_FIELDS) split[field] = entry[field] || 0;
    if (!rest) return split;
    const restSplit = rest.mixed ? null : splitUnsplitCost(rest, await pricingFor(entry.rawProvider, entry.rawModel), calculateCostBreakdown);
    if (!restSplit) split.unsplitCost = rest.cost || 0;
    else for (const field of USAGE_COST_FIELDS) split[field] += restSplit[field];
    return split;
  };

  const providerSplits = Object.create(null);
  for (const bucket of ["byModel", "byAccount", "byApiKey", "byEndpoint"]) {
    for (const entry of Object.values(stats[bucket])) {
      const split = await bucketSplit(entry);
      delete entry.unsplit;
      Object.assign(entry, split);
      if (bucket !== "byModel" || !stats.byProvider[entry.rawProvider]) continue;
      const acc = providerSplits[entry.rawProvider] ||= {};
      for (const [field, value] of Object.entries(split)) acc[field] = (acc[field] || 0) + value;
    }
  }
  for (const [provider, split] of Object.entries(providerSplits)) Object.assign(stats.byProvider[provider], split);
}

function isValidTimeZone(timeZone) {
  if (!timeZone || !isString(timeZone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch (error) {
    logFallback("time zone validation failed", error);
    return false;
  }
}

// Offset (ms) to add to a UTC instant to get the wall-clock time in `timeZone`.
function tzOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).
  formatToParts(date).
  reduce((acc, p) => {acc[p.type] = p.value;return acc;}, {});
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUTC - date.getTime();
}

// Start of "today" (00:00) expressed as a UTC epoch ms, for the given IANA timeZone.
function startOfDayInTz(now, timeZone) {
  const offset = tzOffsetMs(now, timeZone);
  const localNow = new Date(now.getTime() + offset);
  localNow.setUTCHours(0, 0, 0, 0);
  return localNow.getTime() - offset;
}

export async function getChartData(period = "7d", timeZone) {
  const db = await getAdapter();
  const nowDate = new Date();
  const now = nowDate.getTime();
  const tz = isValidTimeZone(timeZone) ? timeZone : undefined;

  if (period === "today") {
    const bucketMs = 3600000;
    let startTime;
    let bucketCount;
    if (tz) {
      startTime = startOfDayInTz(nowDate, tz);
      bucketCount = 24;
    } else {
      const startOfDay = new Date(nowDate);
      startOfDay.setHours(0, 0, 0, 0);
      const nextDay = new Date(startOfDay);
      nextDay.setDate(nextDay.getDate() + 1);
      bucketCount = Math.round((nextDay.getTime() - startOfDay.getTime()) / bucketMs);
      startTime = startOfDay.getTime();
    }
    const endTime = startTime + bucketCount * bucketMs;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short",
      ...(tz ? { timeZone: tz } : null)
    });
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      label: labelFn(startTime + i * bucketMs), tokens: 0, cachedTokens: 0,
      reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, unknownCostRequests: 0, tps: null
    }));

    const rows = aggregateChartWindow(db, startTime, Math.min(now, endTime - 1), bucketMs, bucketCount);
    for (const r of rows) {
      const bucket = buckets[Number(r.bucket)];
      bucket.tokens = Number(r.promptTokens || 0) + Number(r.completionTokens || 0);
      bucket.cachedTokens = Number(r.cachedTokens || 0);
      bucket.reasoningTokens = Number(r.reasoningTokens || 0);
      bucket.cacheCreationTokens = Number(r.cacheCreationTokens || 0);
      bucket.cost = Number(r.cost || 0);
      bucket.unknownCostRequests = Number(r.unknownCostRequests) || 0;
      bucket.tps = deriveLatencyRates(latencyFromRow(r)).avgTps;
    }
    return buckets;
  }

  if (period === "24h") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: false, ...(tz ? { timeZone: tz } : null)
    });
    const startTime = now - bucketCount * bucketMs;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      label: labelFn(startTime + i * bucketMs), tokens: 0, cachedTokens: 0,
      reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, unknownCostRequests: 0, tps: null
    }));

    const rows = aggregateChartWindow(db, startTime, now, bucketMs, bucketCount);
    for (const r of rows) {
      const bucket = buckets[Number(r.bucket)];
      bucket.tokens = Number(r.promptTokens || 0) + Number(r.completionTokens || 0);
      bucket.cachedTokens = Number(r.cachedTokens || 0);
      bucket.reasoningTokens = Number(r.reasoningTokens || 0);
      bucket.cacheCreationTokens = Number(r.cacheCreationTokens || 0);
      bucket.cost = Number(r.cost || 0);
      bucket.unknownCostRequests = Number(r.unknownCostRequests) || 0;
      bucket.tps = deriveLatencyRates(latencyFromRow(r)).avgTps;
    }
    return buckets;
  }

  const fixedDays = getChartDayBucketCount(period);
  // Historical charts need only each day’s total row.
  const dayRows = [];
  for (const row of loadDaysInRange(db, fixedDays, nowDate, true)) {
    try { localDateFromKey(row.dateKey); } catch (error) { logFallback("chart date validation failed", error); continue; }
    const { day } = row;
    dayRows.push({ dateKey: row.dateKey, day: {
      promptTokens: day.promptTokens, completionTokens: day.completionTokens,
      cachedTokens: day.cachedTokens, reasoningTokens: day.reasoningTokens,
      cacheCreationTokens: day.cacheCreationTokens, cost: day.cost,
      unknownCostRequests: day.unknownCostRequests,
      latencyMs: day.latencyMs, ttftMs: day.ttftMs,
      latencySamples: day.latencySamples, ttftSamples: day.ttftSamples,
      timedCompletionTokens: day.timedCompletionTokens,
    } });
  }
  const todayKey = toLocalDateKey(nowDate);
  let firstDate;
  if (fixedDays != null) {
    firstDate = addLocalCalendarDays(nowDate, -fixedDays + 1);
  } else if (dayRows.length > 0) {
    firstDate = localDateFromKey(dayRows[0].dateKey);
  } else {
    firstDate = addLocalCalendarDays(nowDate, -EMPTY_ALL_TIME_CHART_DAYS + 1);
  }
  firstDate.setHours(0, 0, 0, 0);

  const firstOrdinal = Date.UTC(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate()) / 86400000;
  const todayOrdinal = Date.UTC(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()) / 86400000;
  const totalDays = Math.max(1, todayOrdinal - firstOrdinal + 1);
  const bucketSize = fixedDays == null ? Math.max(1, Math.ceil(totalDays / MAX_USAGE_CHART_BUCKETS)) : 1;
  const bucketCount = Math.ceil(totalDays / bucketSize);
  const withYear = fixedDays == null;
  const formatDay = (date) => date.toLocaleDateString("en-US", {
    month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : null)
  });
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const start = addLocalCalendarDays(firstDate, index * bucketSize);
    const end = addLocalCalendarDays(start, Math.min(bucketSize, totalDays - index * bucketSize) - 1);
    return {
      label: bucketSize === 1 ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`,
      tokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      cacheCreationTokens: 0,
      cost: 0,
      unknownCostRequests: 0,
      // Latency sums live on the bucket only long enough to become `tps` below;
      // a multi-day bucket may merge several days, so the rate is derived once
      // after every contributing day has been added.
      latencyMs: 0,
      ttftMs: 0,
      timedCompletionTokens: 0,
      tps: null
    };
  });

  for (const row of dayRows) {
    const date = localDateFromKey(row.dateKey);
    const ordinal = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
    const index = Math.floor((ordinal - firstOrdinal) / bucketSize);
    if (index < 0 || index >= buckets.length || row.dateKey > todayKey) continue;
    const day = row.day;
    buckets[index].tokens += (day.promptTokens || 0) + (day.completionTokens || 0);
    buckets[index].cachedTokens += day.cachedTokens || 0;
    buckets[index].reasoningTokens += day.reasoningTokens || 0;
    buckets[index].cacheCreationTokens += day.cacheCreationTokens || 0;
    buckets[index].cost += day.cost || 0;
    buckets[index].unknownCostRequests += Number(day.unknownCostRequests) || 0;
    buckets[index].latencyMs += day.latencyMs || 0;
    buckets[index].ttftMs += day.ttftMs || 0;
    buckets[index].timedCompletionTokens += day.timedCompletionTokens || 0;
  }
  for (const bucket of buckets) bucket.tps = deriveLatencyRates(bucket).avgTps;
  return buckets;
}

function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// No-op: request log is now derived from usageHistory table on read.
export async function appendRequestLog() {}

const RESET_PERIOD_MS = {
  "5m": 5 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000
};

const VALID_RESET_PERIODS = new Set(["5m", "1h", "3h", "6h", "12h", "1d", "7d", "30d", "all"]);

function rebuildDailyKeyInTx(db, dateKey) {
  const start = localDateFromKey(dateKey);
  const end = addLocalCalendarDays(start, 1);
  const rows = aggregateUsageWindow(db, start.toISOString(), new Date(Math.min(end.getTime() - 1, Date.now())).toISOString());
  db.run(`DELETE FROM usageDailyRollups WHERE dateKey = ?`, [dateKey]);
  if (rows.length === 0) return;
  const day = aggregateRowsToDay(rows);
  insertUsageDailyRollup(db, dateKey, day);
}

/**
 * Delete usage rows, daily rollups and token-saver events recorded before
 * `cutoffMs`, then rebuild the boundary day and the lifetime counter.
 * Returns the number of usageHistory rows removed.
 */
function pruneUsageBeforeInTx(db, cutoffMs) {
  const cutoffIso = new Date(cutoffMs).toISOString();
  const cutoffDate = new Date(cutoffMs);
  const cutoffKey = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, "0")}-${String(cutoffDate.getDate()).padStart(2, "0")}`;
  const before = db.get(`SELECT COUNT(*) AS cnt FROM usageHistory WHERE timestamp < ?`, [cutoffIso]);
  backfillUsageEventReceiptsSync(db, cutoffIso);

  // Delete usageHistory entries older than the cutoff (keep recent data within the period)
  db.run(`DELETE FROM usageHistory WHERE timestamp < ?`, [cutoffIso]);
  db.run(`DELETE FROM usageLastSeen WHERE lastUsed < ?`, [cutoffIso]);

  // Delete usageDaily entries older than the cutoff
  db.run(`DELETE FROM usageDailyRollups WHERE dateKey < ?`, [cutoffKey]);
  // Keep token-saver telemetry consistent with the usage windows it is
  // reported alongside (Codex P2 on #306).
  db.run(`DELETE FROM tokenSaverEvents WHERE timestamp < ?`, [cutoffIso]);
  const utcCutoffDay = cutoffIso.slice(0, 10);
  db.run("DELETE FROM tokenSaverDaily WHERE dateKey <= ?", [utcCutoffDay]);
  db.run("DELETE FROM tokenSaverDailyReasons WHERE dateKey <= ?", [utcCutoffDay]);
  backfillTokenSaverDaily(db, "WHERE timestamp >= ? AND timestamp < ?", [
    cutoffIso, new Date(Date.parse(`${utcCutoffDay}T00:00:00.000Z`) + 86400000).toISOString(),
  ]);
  rebuildDailyKeyInTx(db, cutoffKey);

  // Recalculate totalRequestsLifetime from remaining history
  const remaining = db.get(`SELECT COUNT(*) AS cnt FROM usageHistory`);
  db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(remaining.cnt)]);
  return Number(before?.cnt) || 0;
}

/**
 * Delete usage rows, daily rollups and token-saver events recorded on or after
 * `cutoffMs` (the selected recent reset window), then rebuild the boundary day
 * and the lifetime counter from remaining older history.
 */
function deleteUsageSinceInTx(db, cutoffMs) {
  const cutoffIso = new Date(cutoffMs).toISOString();
  const cutoffDate = new Date(cutoffMs);
  const cutoffKey = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, "0")}-${String(cutoffDate.getDate()).padStart(2, "0")}`;
  backfillUsageEventReceiptsSync(db, cutoffIso, ">=");

  // Delete usageHistory entries within the selected recent window (keep older history)
  db.run(`DELETE FROM usageHistory WHERE timestamp >= ?`, [cutoffIso]);
  const utcCutoffDay = cutoffIso.slice(0, 10);
  const utcCutoffDayStart = `${utcCutoffDay}T00:00:00.000Z`;
  db.run(`DELETE FROM usageLastSeen WHERE lastUsed >= ?`, [cutoffIso]);
  // Rebuild the boundary day using the same key identity as normal writes.
  const remainingLastSeen = historyLastSeen(db, "timestamp >= ? AND timestamp < ?", [utcCutoffDayStart, cutoffIso]);
  upsertUsageLastSeen(db, remainingLastSeen.map((row) => ({
    dateKey: row.timestamp.slice(0, 10), provider: row.provider || "", model: row.model || "",
    connectionId: row.connectionId || "", apiKey: row.apiKey, endpoint: row.endpoint || "", lastUsed: row.timestamp,
  })));

  // Delete usageDaily entries after the cutoff day and rebuild the boundary day
  db.run(`DELETE FROM usageDailyRollups WHERE dateKey > ?`, [cutoffKey]);
  db.run(`DELETE FROM tokenSaverEvents WHERE timestamp >= ?`, [cutoffIso]);
  db.run("DELETE FROM tokenSaverDaily WHERE dateKey >= ?", [utcCutoffDay]);
  db.run("DELETE FROM tokenSaverDailyReasons WHERE dateKey >= ?", [utcCutoffDay]);
  backfillTokenSaverDaily(db, "WHERE timestamp >= ? AND timestamp < ?", [
    utcCutoffDayStart, cutoffIso,
  ]);
  rebuildDailyKeyInTx(db, cutoffKey);

  // Recalculate totalRequestsLifetime from remaining history
  const remaining = db.get(`SELECT COUNT(*) AS cnt FROM usageHistory`);
  db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(remaining.cnt)]);
}

/** Retention sweep entry point: prune everything recorded before `cutoffMs`. */
export async function pruneUsageOlderThan(cutoffMs) {
  const db = await getAdapter();
  let removed = 0;
  db.transaction(() => {
    removed = pruneUsageBeforeInTx(db, cutoffMs);
  });
  if (removed > 0) {
    recentRing.items = recentRing.items.filter((item) => !item?.timestamp || item.timestamp >= new Date(cutoffMs).toISOString());
    statsEmitter.emit("update");
  }
  return removed;
}

export async function resetUsageHistory(period) {
  if (!VALID_RESET_PERIODS.has(period)) {
    throw new Error(`Invalid reset period: ${period}`);
  }

  const db = await getAdapter();

  db.transaction(() => {
    if (period === "all") {
      backfillUsageEventReceiptsSync(db);
      // Delete everything
      db.run(`DELETE FROM usageHistory`);
      db.run(`DELETE FROM usageLastSeen`);
      db.run(`DELETE FROM usageDailyRollups`);
      db.run(`DELETE FROM tokenSaverEvents`);
      db.run("DELETE FROM tokenSaverDaily");
      db.run("DELETE FROM tokenSaverDailyReasons");
      db.run(`DELETE FROM _meta WHERE key = 'totalRequestsLifetime'`);
    } else {
      deleteUsageSinceInTx(db, Date.now() - RESET_PERIOD_MS[period]);
    }
  });

  // Clear in-memory ring buffer
  recentRing.items = [];

  // Emit update so connected clients refresh
  statsEmitter.emit("update");
}

export async function getRecentLogs(limit = 200) {
  try {
    const db = await getAdapter();
    const rows = db.all(
      `SELECT timestamp, provider, model, connectionId, promptTokens, completionTokens, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`,
      [limit]
    );
    if (!rows.length) return [];

    const connMap = {};
    try {
      const { getProviderConnections } = await import("./connectionsRepo.js");
      const connections = await getProviderConnections();
      for (const c of connections) connMap[c.id] = c.name || c.email || "";
    } catch (error) { logFallback("recent logs connection lookup failed", error); }

    return rows.map((r) => {
      const ts = formatLogDate(new Date(r.timestamp));
      const p = r.provider?.toUpperCase() || "-";
      const m = r.model || "-";
      const account = connMap[r.connectionId] || (r.connectionId ? r.connectionId.slice(0, 8) : "-");
      const tk = r.tokens ? parseJson(r.tokens, {}) : {};
      const sent = r.promptTokens ?? tk.prompt_tokens ?? "-";
      const received = r.completionTokens ?? tk.completion_tokens ?? "-";
      return `${ts} | ${m} | ${p} | ${account} | ${sent} | ${received} | ${r.status || "-"}`;
    });
  } catch (e) {
    console.error("[usageRepo] getRecentLogs failed:", e.message);
    return [];
  }
}

// ─── Token Saver telemetry persistence (port of decolua/9router #2562) ─────
// Durable per-request event store + period aggregation for the dashboard.
// One row per persisted logical request. The caller (handleSingleModelChat)
// keeps the LATEST routing attempt's event and persists it ONCE after the
// final routing decision, so fallback retries supersede in memory instead of
// double-counting, and fusion panels each persist their own event. The repo
// generates a fresh row id per persisted event. Aggregation reads the stored
// per-request event JSON and folds via the pure open-sse aggregator.

const TOKEN_SAVER_TABLE = "tokenSaverEvents";
// Retention: none. Rows are small (one per request) and the dashboard +
// /api/usage/stats support an "all" (all-time) period, so we keep full history
// rather than silently cap it. Pruning can be added later with a documented
// cap; for now accuracy of the aggregate takes precedence.
// Schema ownership: the table + indexes are declared in ../schema.js TABLES
// and created by migration 010 (and the declarative syncSchemaFromTables on
// fresh DBs), so backups/export include them. No lazy CREATE here.

// Serialize telemetry writes so a burst of concurrent requests completes one
// insert before the next begins. better-sqlite3 is sync, but this async chain
// keeps ordering deterministic across the await boundary.
let tokenSaverWriteChain = Promise.resolve();

/**
 * Persist one logical request's normalized token-saver event. The caller has
 * already resolved routing (latest attempt wins), so each call inserts one new
 * row (DB autoincrement id). Fail-open: telemetry must never break the request
 * path.
 * @param {object} event normalized event from normalizeTokenSaverEvent
 * @param {Date} [now]
 */
export async function recordTokenSaverEvent(event, now = new Date()) {
  if (!event || !isObject(event)) return;
  const ts = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(ts.getTime())) return; // fail-open; never misdate a row
  const run = tokenSaverWriteChain.then(async () => {
    const db = await getAdapter();
    // Persist only the canonical normalized event (port of 9router #2562).
    // normalizeTokenSaverEvent strips/allowlists diagnostics (no raw URLs or
    // upstream error text) and coerces unknown fields to safe zeros, so the
    // public API can never write attacker-controlled data into the dashboard.
    const normalized = normalizeTokenSaverEvent(event);
    const columns = tokenSaverEventColumns(normalized);
    const names = Object.keys(columns);
    db.transaction(() => {
      db.run(
        `INSERT INTO ${TOKEN_SAVER_TABLE} (timestamp, dateKey, data, ${names.join(", ")}) VALUES (?, ?, ?, ${names.map(() => "?").join(", ")})`,
        [ts.toISOString(), toLocalDateKey(ts), stringifyJson(normalized), ...Object.values(columns)]
      );
      const values = [1, ...TOKEN_SAVER_SUM_COLUMNS.map((name) => columns[name]), ...["compressed", "skipped", "disabled"].map((state) => columns.hrState === state ? 1 : 0)];
      db.run(`INSERT INTO tokenSaverDaily(dateKey, localDateKey, ${TOKEN_SAVER_DAILY_COLUMNS.join(", ")})
        VALUES (?, ?, ${values.map(() => "?").join(", ")})
        ON CONFLICT (dateKey, localDateKey) DO UPDATE SET ${TOKEN_SAVER_DAILY_COLUMNS.map((name) => `${name} = tokenSaverDaily.${name} + excluded.${name}`).join(", ")}`,
        [ts.toISOString().slice(0, 10), toLocalDateKey(ts), ...values]);
      if (columns.hrState === "skipped") {
        db.run(`INSERT INTO tokenSaverDailyReasons(dateKey, localDateKey, hrSkipReason, count) VALUES (?, ?, ?, 1)
          ON CONFLICT (dateKey, localDateKey, hrSkipReason) DO UPDATE SET count = tokenSaverDailyReasons.count + excluded.count`,
          [ts.toISOString().slice(0, 10), toLocalDateKey(ts), columns.hrSkipReason || ""]);
      }
    });
  });
  tokenSaverWriteChain = run.catch(() => {});
  try {await run;} catch (e) {console.warn("[usageRepo] recordTokenSaverEvent failed:", e.message);return;}
  scheduleStatsEvent("update");
  // Targeted event for the Token Saver overview live stream (port of 9router
  // #2562), so its SSE refreshes on token-saver writes without subscribing to
  // every normal usage update.
  scheduleStatsEvent("token-saver");
}

/**
 * Aggregate pre-normalized numeric columns in SQL, transferring only daily
 * totals and bounded diagnostic counts, never per-request JSON.
 *
 * Period predicates mirror getUsageStats so every visible period option is
 * correct:
 *   today     → rows on/after local midnight (timestamp)
 *   24h       → rolling last-24-hours (exact timestamp)
 *   Nd (7d…)  → inclusive local-calendar day window (dateKey)
 *   all       → unfiltered
 * @param {string} period usage period key
 * @param {Date} [now] reference time (injectable for tests)
 * @returns {Promise<object>} aggregate from aggregateTokenSaverEvents
 */
export async function getTokenSaverStats(period = "7d", now = new Date()) {
  if (!VALID_USAGE_STATS_PERIODS.has(period)) {
    throw new RangeError(`Invalid usage period: ${period}`);
  }
  try {
    const db = await getAdapter();
    now = now instanceof Date ? now : new Date(now);
    const nowIso = now.toISOString();
    let where = "timestamp <= ?";
    let params = [nowIso];
    if (period === "today") {
      const midnight = new Date(now);midnight.setHours(0, 0, 0, 0);
      where = "timestamp >= ? AND timestamp <= ?";
      params = [midnight.toISOString(), nowIso];
    } else if (period === "24h") {
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      where = "timestamp >= ? AND timestamp <= ?";
      params = [since.toISOString(), nowIso];
    } else if (period !== "all") {
      const cutoff = getUsageCalendarCutoff(period, now);
      if (cutoff) {
        where = "dateKey >= ? AND timestamp <= ?";
        params = [toLocalDateKey(cutoff), nowIso];
      }
    }
    let rows;
    let reasonRows;
    if (period === "today" || period === "24h") {
      rows = db.all(`SELECT dateKey, ${TOKEN_SAVER_AGGREGATES} FROM ${TOKEN_SAVER_TABLE} WHERE ${where} GROUP BY dateKey`, params);
      reasonRows = db.all(`SELECT hrSkipReason, COUNT(*) AS count FROM ${TOKEN_SAVER_TABLE}
        WHERE ${where} AND hrState = 'skipped' GROUP BY hrSkipReason`, params);
    } else {
      // UTC keys bound the read; persisted local keys retain the existing
      // chart buckets, including imported keys that differ from timestamps.
      const utcDay = nowIso.slice(0, 10);
      const localCutoff = period === "all" ? null : toLocalDateKey(getUsageCalendarCutoff(period, now));
      const summaryWhere = `dateKey < ?${localCutoff ? " AND localDateKey >= ?" : ""}`;
      const rawWhere = `timestamp >= ? AND timestamp <= ?${localCutoff ? " AND dateKey >= ?" : ""}`;
      const boundedParams = [utcDay, ...(localCutoff ? [localCutoff] : []),
        `${utcDay}T00:00:00.000Z`, nowIso, ...(localCutoff ? [localCutoff] : [])];
      rows = db.all(`SELECT dateKey, ${TOKEN_SAVER_DAILY_COLUMNS.map((name) => `SUM(${name}) AS ${name}`).join(", ")}
        FROM (
          SELECT localDateKey AS dateKey, ${TOKEN_SAVER_DAILY_COLUMNS.join(", ")} FROM tokenSaverDaily WHERE ${summaryWhere}
          UNION ALL
          SELECT dateKey, ${TOKEN_SAVER_AGGREGATES} FROM tokenSaverEvents WHERE ${rawWhere} GROUP BY dateKey
        ) AS bounded GROUP BY dateKey`, boundedParams);
      reasonRows = db.all(`SELECT hrSkipReason, SUM(count) AS count FROM (
          SELECT hrSkipReason, count FROM tokenSaverDailyReasons WHERE ${summaryWhere}
          UNION ALL
          SELECT hrSkipReason, COUNT(*) AS count FROM tokenSaverEvents WHERE ${rawWhere} AND hrState = 'skipped' GROUP BY hrSkipReason
        ) AS bounded GROUP BY hrSkipReason`, boundedParams);
    }
    const agg = aggregateTokenSaverEvents([]);
    const byDay = new Map();
    for (const row of rows) {
      const n = (key) => Number(row[key] ?? 0);
      const day = {
        requestsObserved: n("requestsObserved"),
        rtk: {
          requestsWithHits: n("rtkRequestsWithHits"), hits: n("rtkHits"),
          bytesBefore: n("rtkBytesBefore"), bytesAfter: n("rtkBytesAfter"), bytesSaved: n("rtkBytesSaved"),
        },
        headroom: {
          compressed: n("compressed"), skipped: n("skipped"), disabled: n("disabled"),
          tokensBefore: n("hrTokensBefore"), tokensAfter: n("hrTokensAfter"), tokensSaved: n("hrTokensSaved"),
          bodyBytesBefore: n("hrBodyBytesBefore"), bodyBytesAfter: n("hrBodyBytesAfter"), phantomSavings: n("hrPhantomSavings"),
        },
        pxpipe: {
          applied: n("pxApplied"), tokensBeforeEst: n("pxTokensBeforeEst"), tokensAfterEst: n("pxTokensAfterEst"),
          tokensSavedEst: n("pxTokensSavedEst"), imageCount: n("pxImageCount"),
        },
        totals: { actualBytesSaved: n("totalActualBytesSaved") },
      };
      agg.requestsObserved += day.requestsObserved;
      for (const group of ["rtk", "headroom", "pxpipe", "totals"]) {
        for (const [key, value] of Object.entries(day[group])) agg[group][key] += value;
      }
      // Corrupt imported date keys contribute totals, but never chart points.
      if (isString(row.dateKey) && /^\d{4}-\d{2}-\d{2}$/.test(row.dateKey)) byDay.set(row.dateKey, day);
    }
    for (const row of reasonRows) {
      agg.headroom.skipReasons[row.hrSkipReason || "other-skip"] = Number(row.count ?? 0);
    }
    // Bounded windows retain their contiguous zero-filled chart axis;
    // all-time remains observed-only.
    const foldDay = (dateKey) => {
      const day = byDay.get(dateKey) || aggregateTokenSaverEvents([]);
      return {
        dateKey,
        actualBytesSaved: day.totals.actualBytesSaved,
        rtkBytesSaved: day.rtk.bytesSaved,
        headroomBodyShrink: Math.max(0, day.headroom.bodyBytesBefore - day.headroom.bodyBytesAfter),
        headroomTokensSaved: day.headroom.tokensSaved,
        requestsObserved: day.requestsObserved
      };
    };
    const nextDateKey = (dateKey) => {
      const d = new Date(`${dateKey}T00:00:00`);
      d.setDate(d.getDate() + 1);
      return toLocalDateKey(d);
    };
    const todayKey = toLocalDateKey(now);
    let fillStart = null;
    if (period === "today") fillStart = todayKey;else
    if (period === "24h") fillStart = toLocalDateKey(addLocalCalendarDays(now, -1)); // fixed 2-day window: stable x-axis
    else if (period !== "all") {
      const cutoff = getUsageCalendarCutoff(period, now);
      fillStart = cutoff ? toLocalDateKey(cutoff) : byDay.size ? [...byDay.keys()].sort()[0] : todayKey;
    }
    if (fillStart) {
      agg.dailyPoints = [];
      for (let k = fillStart; k <= todayKey; k = nextDateKey(k)) agg.dailyPoints.push(foldDay(k));
    } else {
      agg.dailyPoints = [...byDay.keys()].sort().map(foldDay);
    }
    return agg;
  } catch (e) {
    console.warn("[usageRepo] getTokenSaverStats failed:", e.message);
    const agg = aggregateTokenSaverEvents([]);
    agg.dailyPoints = [];
    return agg;
  }
}

/** Bounded key-scoped report. Stored input is not corrected when cache counters exceed it. */
export async function listKeyUsageSessions(apiKeyId, limit = 50) {
  if (!apiKeyId) return [];
  const db = await getAdapter();
  const pageLimit = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50;
  return db.all(`SELECT usageSessionId AS sessionId, usageProjectId AS projectId,
      COUNT(*) AS requests, COALESCE(SUM(promptTokens), 0) AS promptTokens,
      COALESCE(SUM(completionTokens), 0) AS completionTokens,
      COALESCE(SUM(cachedTokens), 0) AS cacheRead,
      COALESCE(SUM(cacheCreationTokens), 0) AS cacheCreation,
      COALESCE(SUM(reasoningTokens), 0) AS reasoning,
      SUM(cost) AS cost, SUM(CASE WHEN cost IS NULL THEN 1 ELSE 0 END) AS unknownCostRequests,
      MAX(timestamp) AS lastUsed
    FROM usageHistory WHERE apiKeyId = ? AND (usageSessionId IS NOT NULL OR usageProjectId IS NOT NULL)
    GROUP BY usageSessionId, usageProjectId ORDER BY MAX(timestamp) DESC, usageSessionId, usageProjectId
    LIMIT ?`, [apiKeyId, pageLimit]).map(({ cacheRead, cacheCreation, reasoning, ...row }) => ({
    ...row,
    tokens: {
      input: row.promptTokens,
      uncachedInput: Math.max(0, row.promptTokens - cacheRead - cacheCreation),
      cacheRead,
      cacheCreation,
      output: row.completionTokens,
      reasoning,
      total: row.promptTokens + row.completionTokens,
    },
  }));
}
