import { EventEmitter } from "events";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
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
import { incrementApiKeyUsageSync } from "./apiKeyUsageTotalsRepo.js";
import { getCommittedTokenCount } from "../helpers/committedTokens.js";
import { normalizeTokenSaverEvent, aggregateTokenSaverEvents } from "open-sse/rtk/index.js";
import { isObject, isString } from "../../../shared/utils/typeChecks.js";

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

function getApiKeyStatsKey(apiKey, model, provider, salt) {
  const keyIdentity = fingerprintApiKey(apiKey, salt) || "local-no-key";
  return `${keyIdentity}|${model}|${provider || "unknown"}`;
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

function addToCounter(target, key, values) {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0 };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].reasoningTokens += values.reasoningTokens || 0;
  target[key].cacheCreationTokens += values.cacheCreationTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) Object.assign(target[key], values.meta);
}

function aggregateEntryToDay(day, entry, identitySalt) {
  const promptTokens = entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const completionTokens = entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cachedTokens = entry.tokens?.cached_tokens || entry.tokens?.cache_read_input_tokens || 0;
  const reasoningTokens = entry.tokens?.reasoning_tokens ||
  entry.tokens?.completion_tokens_details?.reasoning_tokens ||
  entry.tokens?.output_tokens_details?.reasoning_tokens ||
  0;
  const cacheCreationTokens = entry.tokens?.cache_creation_input_tokens || 0;
  const cost = entry.cost || 0;
  const vals = { promptTokens, completionTokens, cachedTokens, reasoningTokens, cacheCreationTokens, cost };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cachedTokens = (day.cachedTokens || 0) + cachedTokens;
  day.reasoningTokens = (day.reasoningTokens || 0) + reasoningTokens;
  day.cacheCreationTokens = (day.cacheCreationTokens || 0) + cacheCreationTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });
  }

  const akModelKey = getApiKeyStatsKey(entry.apiKey, entry.model, entry.provider, identitySalt);
  addToCounter(day.byApiKey, akModelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, apiKey: entry.apiKey || null } });

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
  } catch {}
  return connCache.map;
}

async function ensureRingInitialized() {
  if (recentRing.initialized) return;
  recentRing.initialized = true;
  try {
    const db = await getAdapter();
    const rows = db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`, [RING_CAP]);
    recentRing.items = rows.reverse().map((r) => ({
      timestamp: r.timestamp, provider: r.provider, model: r.model, connectionId: r.connectionId,
      apiKey: r.apiKey, endpoint: r.endpoint, cost: r.cost, status: r.status,
      tokens: parseJson(r.tokens, {})
    }));
  } catch {}
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
    const ts = item.timestamp ? Date.parse(item.timestamp) : NaN;
    if (Number.isFinite(ts) && ts >= cutoff) ids.add(item.connectionId);
  }
  return ids;
}

async function calculateCost(provider, model, tokens) {
  if (!tokens) return 0;
  try {
    const { calculateCostFromTokens } = await import("open-sse/providers/pricing.js");
    if (!provider || !model) return calculateCostFromTokens(tokens, null);
    const { getPricingForModel } = await import("./pricingRepo.js");
    const pricing = await getPricingForModel(provider, model);

    // Delegate the actual math to the single source of truth (avoids the two
    // copies drifting apart — see open-sse/providers/pricing.js for the
    // cache-inclusive prompt_tokens convention this assumes).
    return calculateCostFromTokens(tokens, pricing);
  } catch (e) {
    console.error("Error calculating cost:", e);
    return 0;
  }
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
    try { startActiveSession({ ...session, requestId, model, provider, connectionId }); } catch {/* telemetry must not block requests */}
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
  const seen = new Set();
  const recentRequests = [...recentRing.items].
  sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).
  map((e) => {
    const t = e.tokens || {};
    return {
      timestamp: e.timestamp, model: e.model, provider: e.provider || "",
      promptTokens: t.prompt_tokens || t.input_tokens || 0,
      completionTokens: t.completion_tokens || t.output_tokens || 0,
      status: e.status || "ok"
    };
  }).
  filter((e) => {
    if (e.promptTokens === 0 && e.completionTokens === 0) return false;
    const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
    const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).
  slice(0, 20);

  const errorProvider = Date.now() - lastErrorProvider.ts < 10000 ? lastErrorProvider.provider : "";
  return { activeRequests, activeSessions: await getActiveSessions(), recentRequests, errorProvider, pending: pendingRequests };
}

export async function saveRequestUsage(entry) {
  try {
    const db = await getAdapter();
    const identitySalt = getOrCreateUsageIdentitySalt(db);

    if (!entry.timestamp) entry.timestamp = new Date().toISOString();
    entry.cost = await calculateCost(entry.provider, entry.model, entry.tokens);

    const tokens = entry.tokens || {};
    const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const completionTokens = tokens.completion_tokens || tokens.output_tokens || 0;

    let inserted = false;

    // Every request is a distinct event — never deduplicate on identical field
    // payloads, or parallel writes that share fields (same timestamp + provider +
    // model + connectionId + tokens) would silently clobber each other (write loss).
    // Only an explicit idempotency key (`usageEventId`) dedupes — that is a real
    // retry of the SAME logical event, not a coincidentally-identical new event.
    // All writes (history insert, daily upsert, lifetime counter) happen in ONE
    // transaction; better-sqlite3/node:sqlite are synchronous, so no JS yield
    // occurs mid-transaction and the writes remain atomic/serialized in-process.
    db.transaction(() => {
      // Idempotency: only when the caller supplies a real event id.
      if (entry.usageEventId) {
        const existing = db.get(`SELECT id, endpoint FROM usageHistory WHERE usageEventId = ?`, [entry.usageEventId]);
        if (existing) {
          if (!existing.endpoint && entry.endpoint) {
            db.run(`UPDATE usageHistory SET endpoint = ? WHERE id = ?`, [entry.endpoint, existing.id]);
          }
          return;
        }
      }

      const insert = db.run(
        `INSERT OR IGNORE INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta, usageEventId) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
        entry.timestamp, entry.provider || null, entry.model || null,
        entry.connectionId || null, entry.apiKey || null, entry.endpoint || null,
        promptTokens, completionTokens, entry.cost || 0, entry.status || "ok",
        stringifyJson(tokens), stringifyJson({}), entry.usageEventId || null]

      );
      if ((insert?.changes ?? 0) === 0) return;

      const dateKey = toLocalDateKey(entry.timestamp);
      const row = db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]);
      const day = row ? parseJson(row.data, {}) : {
        requests: 0, promptTokens: 0, completionTokens: 0, cost: 0,
        byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {}
      };
      aggregateEntryToDay(day, entry, identitySalt);
      db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`, [dateKey, stringifyJson(day)]);

      // Resolve the stored secret to its stable row id inside the same
      // transaction. The secret is read-only and is never rotated or rewritten.
      const apiKeyId = entry.apiKey ?
      db.get(`SELECT id FROM apiKeys WHERE key = ?`, [entry.apiKey])?.id || null :
      null;

      // Atomic counter increment in same transaction
      const cur = db.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`);
      const next = (cur ? parseInt(cur.value, 10) : 0) + 1;
      db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(next)]);
      if (apiKeyId) {
        incrementApiKeyUsageSync(db, apiKeyId, {
          tokens: getCommittedTokenCount(tokens, { promptTokens, completionTokens }),
          cost: entry.cost || 0
        });
      }
      inserted = true;
    });

    if (inserted) {
      pushToRing(entry);
      finishActiveSession({ requestId: entry.usageEventId, promptTokens, completionTokens, status: "done" });
      scheduleStatsEvent("update", 250);
    }
  } catch (e) {
    console.error("Failed to save usage stats:", e);
  }
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
    `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens,
            promptTokens, completionTokens
       FROM usageHistory ${where} ORDER BY id ASC`,
    params
  );

  return rows.map((r) => ({
    timestamp: r.timestamp, provider: r.provider, model: r.model,
    connectionId: r.connectionId, apiKeyMasked: maskApiKey(r.apiKey), endpoint: r.endpoint,
    cost: r.cost, status: r.status,
    promptTokens: Number(r.promptTokens ?? parseJson(r.tokens, {}).prompt_tokens ?? 0),
    completionTokens: Number(r.completionTokens ?? parseJson(r.tokens, {}).completion_tokens ?? 0),
    tokens: {
      prompt_tokens: Number(r.promptTokens ?? parseJson(r.tokens, {}).prompt_tokens ?? 0),
      completion_tokens: Number(r.completionTokens ?? parseJson(r.tokens, {}).completion_tokens ?? 0),
      ...parseJson(r.tokens, {})
    }
  }));
}

function loadDaysInRange(adapter, maxDays, identitySalt, now = new Date()) {
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
  const rows = adapter.all(
    `SELECT dateKey, data FROM usageDaily WHERE ${lowerBound}dateKey < ? ORDER BY dateKey ASC`,
    params
  );

  // The current day is reconstructed from bounded history so a future-dated
  // imported row cannot contaminate any calendar-period aggregate.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayRows = adapter.all(
    `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens,
            completionTokens, cost, status, tokens
       FROM usageHistory WHERE timestamp >= ? AND timestamp <= ? ORDER BY id ASC`,
    [startOfToday.toISOString(), now.toISOString()]
  );
  if (todayRows.length > 0) {
    const day = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0 };
    for (const row of todayRows) {
      const tokens = parseJson(row.tokens, {});
      aggregateEntryToDay(day, {
        ...row,
        tokens: {
          prompt_tokens: row.promptTokens || 0,
          completion_tokens: row.completionTokens || 0,
          ...tokens
        }
      }, identitySalt);
    }
    rows.push({ dateKey: todayKey, data: stringifyJson(day) });
  }
  return rows;
}

// Like loadDaysInRange but bounded by explicit inclusive local date keys
// (YYYY-MM-DD) instead of a rolling day count. Used by the usage page's custom
// calendar range. `endKey` >= today reconstructs the current day from live
// history (usageDaily has no row for today yet), matching loadDaysInRange.
function loadDaysInDateRange(adapter, startKey, endKey, identitySalt, now = new Date()) {
  const todayKey = toLocalDateKey(now);
  const rows = adapter.all(
    `SELECT dateKey, data FROM usageDaily WHERE dateKey >= ? AND dateKey <= ? AND dateKey < ? ORDER BY dateKey ASC`,
    [startKey, endKey, todayKey]
  );
  if (endKey >= todayKey && startKey <= todayKey) {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const todayRows = adapter.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens,
              completionTokens, cost, status, tokens
         FROM usageHistory WHERE timestamp >= ? AND timestamp <= ? ORDER BY id ASC`,
      [startOfToday.toISOString(), now.toISOString()]
    );
    if (todayRows.length > 0) {
      const day = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0 };
      for (const row of todayRows) {
        const tokens = parseJson(row.tokens, {});
        aggregateEntryToDay(day, {
          ...row,
          tokens: { prompt_tokens: row.promptTokens || 0, completion_tokens: row.completionTokens || 0, ...tokens }
        }, identitySalt);
      }
      rows.push({ dateKey: todayKey, data: stringifyJson(day) });
    }
  }
  return rows;
}

export async function getUsageStats(period = "all", opts = {}) {
  const db = await getAdapter();
  const identitySalt = getOrCreateUsageIdentitySalt(db);
  const now = new Date();

  const [{ getProviderConnections }, { getApiKeys }, { getProviderNodes }] = await Promise.all([
  import("./connectionsRepo.js"),
  import("./apiKeysRepo.js"),
  import("./nodesRepo.js")]
  );

  let allConnections = [];
  try {allConnections = await getProviderConnections();} catch {}
  const connectionMap = {};
  for (const c of allConnections) connectionMap[c.id] = c.name || c.email || c.id;

  const providerNodeNameMap = {};
  try {
    const nodes = await getProviderNodes();
    for (const n of nodes) if (n.id && n.name) providerNodeNameMap[n.id] = n.name;
  } catch {}

  let allApiKeys = [];
  try {allApiKeys = await getApiKeys();} catch {}
  const apiKeyMap = {};
  for (const k of allApiKeys) apiKeyMap[k.key] = { name: k.name, id: k.id, createdAt: k.createdAt };

  // API responses use database IDs for registered keys and salted HMACs for
  // deleted/unknown keys. Neither identity contains raw key material.
  const unknownApiKeyIds = new Map();
  function getPublicApiKeyIdentity(apiKey, internalIdentity = apiKey) {
    if (!apiKey && (!internalIdentity || String(internalIdentity).startsWith("local-no-key"))) {
      return { id: "local-no-key", keyName: "Local (No API Key)", apiKeyMasked: null };
    }
    const keyInfo = apiKey ? apiKeyMap[apiKey] : null;
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

  // recentRequests from live history (last 100 entries enough for 20 deduped)
  const recentRows = db.all(`SELECT timestamp, provider, model, tokens, status FROM usageHistory ORDER BY id DESC LIMIT 100`);
  const seen = new Set();
  const recentRequests = recentRows.
  map((r) => {
    const t = parseJson(r.tokens, {}) || {};
    return {
      timestamp: r.timestamp, model: r.model, provider: r.provider || "",
      promptTokens: t.prompt_tokens || t.input_tokens || 0,
      completionTokens: t.completion_tokens || t.output_tokens || 0,
      cachedTokens: t.cached_tokens || t.cache_read_input_tokens || 0,
      status: r.status || "ok"
    };
  }).
  filter((e) => {
    if (e.promptTokens === 0 && e.completionTokens === 0) return false;
    const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
    const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).
  slice(0, 20);

  const stats = {
    totalRequests: 0,
    totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0,
    totalReasoningTokens: 0, totalCacheCreationTokens: 0, totalCost: 0,
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
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
    bucketMap[ts] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    stats.last10Minutes.push(bucketMap[ts]);
  }
  const recent10 = db.all(
    `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`,
    [tenMinutesAgo.toISOString(), now.toISOString()]
  );
  for (const r of recent10) {
    const tt = new Date(r.timestamp).getTime();
    const minuteStart = Math.floor(tt / 60000) * 60000;
    if (bucketMap[minuteStart]) {
      bucketMap[minuteStart].requests++;
      bucketMap[minuteStart].promptTokens += r.promptTokens || 0;
      bucketMap[minuteStart].completionTokens += r.completionTokens || 0;
      bucketMap[minuteStart].cost += r.cost || 0;
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
    loadDaysInDateRange(db, customStart, customEnd, identitySalt, now) :
    loadDaysInRange(db, maxDays, identitySalt, now);

    for (const dr of dayRows) {
      const dateKey = dr.dateKey;
      const day = parseJson(dr.data, {});
      stats.totalPromptTokens += day.promptTokens || 0;
      stats.totalCompletionTokens += day.completionTokens || 0;
      stats.totalCachedTokens += day.cachedTokens || 0;
      stats.totalReasoningTokens += day.reasoningTokens || 0;
      stats.totalCacheCreationTokens += day.cacheCreationTokens || 0;
      stats.totalCost += day.cost || 0;

      for (const [prov, p] of Object.entries(day.byProvider || {})) {
        if (!stats.byProvider[prov]) stats.byProvider[prov] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0 };
        stats.byProvider[prov].requests += p.requests || 0;
        stats.byProvider[prov].promptTokens += p.promptTokens || 0;
        stats.byProvider[prov].completionTokens += p.completionTokens || 0;
        stats.byProvider[prov].cachedTokens += p.cachedTokens || 0;
        stats.byProvider[prov].reasoningTokens += p.reasoningTokens || 0;
        stats.byProvider[prov].cacheCreationTokens += p.cacheCreationTokens || 0;
        stats.byProvider[prov].cost += p.cost || 0;
      }

      for (const [mk, m] of Object.entries(day.byModel || {})) {
        const rawModel = m.rawModel || mk.split("|")[0];
        const provider = m.provider || mk.split("|")[1] || "";
        const statsKey = provider ? `${rawModel} (${provider})` : rawModel;
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byModel[statsKey]) {
          stats.byModel[statsKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, rawModel, provider: providerDisplayName, rawProvider: provider, lastUsed: dateKey };
        }
        stats.byModel[statsKey].requests += m.requests || 0;
        stats.byModel[statsKey].promptTokens += m.promptTokens || 0;
        stats.byModel[statsKey].completionTokens += m.completionTokens || 0;
        stats.byModel[statsKey].cachedTokens += m.cachedTokens || 0;
        stats.byModel[statsKey].reasoningTokens += m.reasoningTokens || 0;
        stats.byModel[statsKey].cacheCreationTokens += m.cacheCreationTokens || 0;
        stats.byModel[statsKey].cost += m.cost || 0;
        if (dateKey > (stats.byModel[statsKey].lastUsed || "")) stats.byModel[statsKey].lastUsed = dateKey;
      }

      for (const [connId, a] of Object.entries(day.byAccount || {})) {
        const accountName = connectionMap[connId] || `Account ${connId.slice(0, 8)}...`;
        const rawModel = a.rawModel || "";
        const provider = a.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const accountKey = `${rawModel} (${provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, rawModel, provider: providerDisplayName, rawProvider: provider, connectionId: connId, accountName, lastUsed: dateKey };
        }
        stats.byAccount[accountKey].requests += a.requests || 0;
        stats.byAccount[accountKey].promptTokens += a.promptTokens || 0;
        stats.byAccount[accountKey].completionTokens += a.completionTokens || 0;
        stats.byAccount[accountKey].cachedTokens += a.cachedTokens || 0;
        stats.byAccount[accountKey].reasoningTokens += a.reasoningTokens || 0;
        stats.byAccount[accountKey].cacheCreationTokens += a.cacheCreationTokens || 0;
        stats.byAccount[accountKey].cost += a.cost || 0;
        if (dateKey > (stats.byAccount[accountKey].lastUsed || "")) stats.byAccount[accountKey].lastUsed = dateKey;
      }

      for (const [akKey, ak] of Object.entries(day.byApiKey || {})) {
        const rawModel = ak.rawModel || akKey.split("|")[1] || "";
        const provider = ak.provider || akKey.split("|")[2] || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const apiKeyVal = ak.apiKey;
        const identity = getPublicApiKeyIdentity(apiKeyVal, akKey);
        const { keyName, apiKeyMasked } = identity;
        const apiKeyKey = identity.id;
        const statsKey = `${identity.id}|${rawModel}|${provider || "unknown"}`;
        if (!stats.byApiKey[statsKey]) {
          stats.byApiKey[statsKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, rawModel, provider: providerDisplayName, rawProvider: provider, apiKeyMasked, keyName, apiKeyKey, lastUsed: dateKey };
        }
        stats.byApiKey[statsKey].requests += ak.requests || 0;
        stats.byApiKey[statsKey].promptTokens += ak.promptTokens || 0;
        stats.byApiKey[statsKey].completionTokens += ak.completionTokens || 0;
        stats.byApiKey[statsKey].cachedTokens += ak.cachedTokens || 0;
        stats.byApiKey[statsKey].reasoningTokens += ak.reasoningTokens || 0;
        stats.byApiKey[statsKey].cacheCreationTokens += ak.cacheCreationTokens || 0;
        stats.byApiKey[statsKey].cost += ak.cost || 0;
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
        stats.byEndpoint[epKey].requests += ep.requests || 0;
        stats.byEndpoint[epKey].promptTokens += ep.promptTokens || 0;
        stats.byEndpoint[epKey].completionTokens += ep.completionTokens || 0;
        stats.byEndpoint[epKey].cachedTokens += ep.cachedTokens || 0;
        stats.byEndpoint[epKey].reasoningTokens += ep.reasoningTokens || 0;
        stats.byEndpoint[epKey].cacheCreationTokens += ep.cacheCreationTokens || 0;
        stats.byEndpoint[epKey].cost += ep.cost || 0;
        if (dateKey > (stats.byEndpoint[epKey].lastUsed || "")) stats.byEndpoint[epKey].lastUsed = dateKey;
      }
    }

    // Overlay precise lastUsed timestamps without materializing every request.
    // The lower bound matches the same local-calendar cutoff as the rollup;
    // the upper bound excludes future-dated imported rows.
    const overlayCutoff = maxDays == null ? null : getUsageCalendarCutoff(period, now);
    const overlayParams = overlayCutoff ?
    [overlayCutoff.toISOString(), now.toISOString()] :
    [now.toISOString()];
    const loadLastUsed = (dimensions) => db.all(
      `SELECT MAX(timestamp) AS timestamp, ${dimensions.join(", ")}
         FROM usageHistory
        WHERE ${overlayCutoff ? "timestamp >= ? AND " : ""}timestamp <= ?
        GROUP BY ${dimensions.join(", ")}
        ORDER BY ${dimensions.join(", ")}`,
      overlayParams
    );
    for (const e of loadLastUsed(["provider", "model"])) {
      const ts = e.timestamp;
      const modelKey = e.provider ? `${e.model} (${e.provider})` : e.model;
      if (stats.byModel[modelKey] && new Date(ts) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = ts;
    }
    for (const e of loadLastUsed(["provider", "model", "connectionId"])) {
      if (!e.connectionId) continue;
      const accountName = connectionMap[e.connectionId] || `Account ${e.connectionId.slice(0, 8)}...`;
      const accountKey = `${e.model} (${e.provider} - ${accountName})`;
      if (stats.byAccount[accountKey] && new Date(e.timestamp) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = e.timestamp;
    }
    for (const e of loadLastUsed(["provider", "model", "apiKey"])) {
      const identity = getPublicApiKeyIdentity(e.apiKey, getApiKeyStatsKey(e.apiKey, e.model, e.provider, identitySalt));
      const apiKeyKey = `${identity.id}|${e.model}|${e.provider || "unknown"}`;
      if (stats.byApiKey[apiKeyKey] && new Date(e.timestamp) > new Date(stats.byApiKey[apiKeyKey].lastUsed)) stats.byApiKey[apiKeyKey].lastUsed = e.timestamp;
    }
    for (const e of loadLastUsed(["provider", "model", "endpoint"])) {
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
    const filtered = db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, tokens
         FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`,
      [cutoff, now.toISOString()]
    );

    for (const r of filtered) {
      const tokens = parseJson(r.tokens, {}) || {};
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

      stats.totalPromptTokens += promptTokens;
      stats.totalCompletionTokens += completionTokens;
      stats.totalCachedTokens += cachedTokens;
      stats.totalReasoningTokens += reasoningTokens;
      stats.totalCacheCreationTokens += cacheCreationTokens;
      stats.totalCost += entryCost;

      if (!stats.byProvider[r.provider]) stats.byProvider[r.provider] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0 };
      stats.byProvider[r.provider].requests++;
      stats.byProvider[r.provider].promptTokens += promptTokens;
      stats.byProvider[r.provider].completionTokens += completionTokens;
      stats.byProvider[r.provider].cachedTokens += cachedTokens;
      stats.byProvider[r.provider].reasoningTokens += reasoningTokens;
      stats.byProvider[r.provider].cacheCreationTokens += cacheCreationTokens;
      stats.byProvider[r.provider].cost += entryCost;

      const modelKey = r.provider ? `${r.model} (${r.provider})` : r.model;
      if (!stats.byModel[modelKey]) {
        stats.byModel[modelKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, rawProvider: r.provider, lastUsed: r.timestamp };
      }
      stats.byModel[modelKey].requests++;
      stats.byModel[modelKey].promptTokens += promptTokens;
      stats.byModel[modelKey].completionTokens += completionTokens;
      stats.byModel[modelKey].cachedTokens += cachedTokens;
      stats.byModel[modelKey].reasoningTokens += reasoningTokens;
      stats.byModel[modelKey].cacheCreationTokens += cacheCreationTokens;
      stats.byModel[modelKey].cost += entryCost;
      if (new Date(r.timestamp) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = r.timestamp;

      if (r.connectionId) {
        const accountName = connectionMap[r.connectionId] || `Account ${r.connectionId.slice(0, 8)}...`;
        const accountKey = `${r.model} (${r.provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, rawProvider: r.provider, connectionId: r.connectionId, accountName, lastUsed: r.timestamp };
        }
        stats.byAccount[accountKey].requests++;
        stats.byAccount[accountKey].promptTokens += promptTokens;
        stats.byAccount[accountKey].completionTokens += completionTokens;
        stats.byAccount[accountKey].cachedTokens += cachedTokens;
        stats.byAccount[accountKey].reasoningTokens += reasoningTokens;
        stats.byAccount[accountKey].cacheCreationTokens += cacheCreationTokens;
        stats.byAccount[accountKey].cost += entryCost;
        if (new Date(r.timestamp) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = r.timestamp;
      }

      if (r.apiKey && isString(r.apiKey)) {
        const identity = getPublicApiKeyIdentity(r.apiKey, fingerprintApiKey(r.apiKey, identitySalt));
        const { keyName, apiKeyMasked } = identity;
        const apiKeyKey = identity.id;
        const akKey = `${identity.id}|${r.model}|${r.provider || "unknown"}`;
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, rawProvider: r.provider, apiKeyMasked, keyName, apiKeyKey, lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey[akKey];
        ake.requests++;ake.promptTokens += promptTokens;ake.completionTokens += completionTokens;ake.cachedTokens += cachedTokens;ake.reasoningTokens += reasoningTokens;ake.cacheCreationTokens += cacheCreationTokens;ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      } else {
        const akKey = getApiKeyStatsKey(null, r.model, r.provider, identitySalt);
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, rawProvider: r.provider, apiKeyMasked: null, keyName: "Local (No API Key)", apiKeyKey: "local-no-key", lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey[akKey];
        ake.requests++;ake.promptTokens += promptTokens;ake.completionTokens += completionTokens;ake.cachedTokens += cachedTokens;ake.reasoningTokens += reasoningTokens;ake.cacheCreationTokens += cacheCreationTokens;ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      }

      const endpoint = r.endpoint || "Unknown";
      const epKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
      if (!stats.byEndpoint[epKey]) {
        stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, endpoint, rawModel: r.model, provider: providerDisplayName, rawProvider: r.provider, lastUsed: r.timestamp };
      }
      const epe = stats.byEndpoint[epKey];
      epe.requests++;epe.promptTokens += promptTokens;epe.completionTokens += completionTokens;epe.cachedTokens += cachedTokens;epe.reasoningTokens += reasoningTokens;epe.cacheCreationTokens += cacheCreationTokens;epe.cost += entryCost;
      if (new Date(r.timestamp) > new Date(epe.lastUsed)) epe.lastUsed = r.timestamp;
    }
  }

  stats.totalRequests = Object.values(stats.byProvider).reduce((sum, p) => sum + (p.requests || 0), 0);
  // Aggregate Token Saver telemetry for the dashboard (port of 9router #2562).
  stats.tokenSaver = await getTokenSaverStats(period);
  return stats;
}

function isValidTimeZone(timeZone) {
  if (!timeZone || !isString(timeZone)) return false;
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
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
  const identitySalt = getOrCreateUsageIdentitySalt(db);
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
      reasoningTokens: 0, cacheCreationTokens: 0, cost: 0
    }));

    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`,
      [new Date(startTime).toISOString(), nowDate.toISOString()]
    );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t > now || t >= endTime) continue;
      const idx = Math.floor((t - startTime) / bucketMs);
      if (idx >= 0 && idx < bucketCount) {
        const tokens = parseJson(r.tokens, {});
        buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
        buckets[idx].cachedTokens += tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
        buckets[idx].reasoningTokens += tokens.reasoning_tokens ||
        tokens.completion_tokens_details?.reasoning_tokens ||
        tokens.output_tokens_details?.reasoning_tokens ||
        0;
        buckets[idx].cacheCreationTokens += tokens.cache_creation_input_tokens || 0;
        buckets[idx].cost += r.cost || 0;
      }
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
      reasoningTokens: 0, cacheCreationTokens: 0, cost: 0
    }));

    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`,
      [new Date(startTime).toISOString(), nowDate.toISOString()]
    );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t > now) continue;
      const idx = Math.min(Math.floor((t - startTime) / bucketMs), bucketCount - 1);
      const tokens = parseJson(r.tokens, {});
      buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
      buckets[idx].cachedTokens += tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
      buckets[idx].reasoningTokens += tokens.reasoning_tokens ||
      tokens.completion_tokens_details?.reasoning_tokens ||
      tokens.output_tokens_details?.reasoning_tokens ||
      0;
      buckets[idx].cacheCreationTokens += tokens.cache_creation_input_tokens || 0;
      buckets[idx].cost += r.cost || 0;
    }
    return buckets;
  }

  const fixedDays = getChartDayBucketCount(period);
  const dayRows = loadDaysInRange(db, fixedDays, identitySalt, nowDate).
  filter((row) => {
    try {localDateFromKey(row.dateKey);return true;} catch {return false;}
  });
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
      cost: 0
    };
  });

  for (const row of dayRows) {
    const date = localDateFromKey(row.dateKey);
    const ordinal = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
    const index = Math.floor((ordinal - firstOrdinal) / bucketSize);
    if (index < 0 || index >= buckets.length || row.dateKey > todayKey) continue;
    const day = parseJson(row.data, {});
    buckets[index].tokens += (day.promptTokens || 0) + (day.completionTokens || 0);
    buckets[index].cachedTokens += day.cachedTokens || 0;
    buckets[index].reasoningTokens += day.reasoningTokens || 0;
    buckets[index].cacheCreationTokens += day.cacheCreationTokens || 0;
    buckets[index].cost += day.cost || 0;
  }
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

function rebuildDailyKeyInTx(db, dateKey, identitySalt) {
  const start = localDateFromKey(dateKey);
  const end = addLocalCalendarDays(start, 1);
  const rows = db.all(
    `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens,
            completionTokens, cost, status, tokens
       FROM usageHistory WHERE timestamp >= ? AND timestamp < ? AND timestamp <= ? ORDER BY id ASC`,
    [start.toISOString(), end.toISOString(), new Date().toISOString()]
  );
  db.run(`DELETE FROM usageDaily WHERE dateKey = ?`, [dateKey]);
  if (rows.length === 0) return;
  const day = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0 };
  for (const row of rows) {
    aggregateEntryToDay(day, {
      ...row,
      tokens: {
        prompt_tokens: row.promptTokens || 0,
        completion_tokens: row.completionTokens || 0,
        ...parseJson(row.tokens, {})
      }
    }, identitySalt);
  }
  db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`, [dateKey, stringifyJson(day)]);
}

export async function resetUsageHistory(period) {
  if (!VALID_RESET_PERIODS.has(period)) {
    throw new Error(`Invalid reset period: ${period}`);
  }

  const db = await getAdapter();
  const identitySalt = getOrCreateUsageIdentitySalt(db);

  db.transaction(() => {
    if (period === "all") {
      // Delete everything
      db.run(`DELETE FROM usageHistory`);
      db.run(`DELETE FROM usageDaily`);
      db.run(`DELETE FROM tokenSaverEvents`);
      db.run(`DELETE FROM _meta WHERE key = 'totalRequestsLifetime'`);
    } else {
      const cutoff = Date.now() - RESET_PERIOD_MS[period];
      const cutoffIso = new Date(cutoff).toISOString();
      const cutoffDate = new Date(cutoff);
      const cutoffKey = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, "0")}-${String(cutoffDate.getDate()).padStart(2, "0")}`;

      // Delete usageHistory entries older than the cutoff (keep recent data within the period)
      db.run(`DELETE FROM usageHistory WHERE timestamp < ?`, [cutoffIso]);

      // Delete usageDaily entries older than the cutoff
      db.run(`DELETE FROM usageDaily WHERE dateKey < ?`, [cutoffKey]);
      // Keep token-saver telemetry consistent with the usage windows it is
      // reported alongside (Codex P2 on #306).
      db.run(`DELETE FROM tokenSaverEvents WHERE timestamp < ?`, [cutoffIso]);
      rebuildDailyKeyInTx(db, cutoffKey, identitySalt);

      // Recalculate totalRequestsLifetime from remaining history
      const remaining = db.get(`SELECT COUNT(*) AS cnt FROM usageHistory`);
      db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(remaining.cnt)]);
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
    } catch {}

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
    db.run(
      `INSERT INTO ${TOKEN_SAVER_TABLE} (timestamp, dateKey, data) VALUES (?, ?, ?)`,
      [ts.toISOString(), toLocalDateKey(ts), stringifyJson(normalizeTokenSaverEvent(event))]
    );
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
 * Aggregate token-saver events over a usage period by folding stored
 * per-request event rows through the pure aggregator. Empty window → zeroed
 * aggregate. Only event-row JSON is passed (never an aggregate), so
 * requestsObserved counts one per logical request.
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
    let rows;
    if (period === "today") {
      const midnight = new Date(now);midnight.setHours(0, 0, 0, 0);
      rows = db.all(`SELECT dateKey, data FROM ${TOKEN_SAVER_TABLE} WHERE timestamp >= ? AND timestamp <= ?`, [midnight.toISOString(), nowIso]);
    } else if (period === "24h") {
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      rows = db.all(`SELECT dateKey, data FROM ${TOKEN_SAVER_TABLE} WHERE timestamp >= ? AND timestamp <= ?`, [since.toISOString(), nowIso]);
    } else if (period === "all") {
      rows = db.all(`SELECT dateKey, data FROM ${TOKEN_SAVER_TABLE} WHERE timestamp <= ?`, [nowIso]);
    } else {
      const cutoff = getUsageCalendarCutoff(period, now);
      rows = cutoff ?
      db.all(`SELECT dateKey, data FROM ${TOKEN_SAVER_TABLE} WHERE dateKey >= ? AND timestamp <= ?`, [toLocalDateKey(cutoff), nowIso]) :
      db.all(`SELECT dateKey, data FROM ${TOKEN_SAVER_TABLE} WHERE timestamp <= ?`, [nowIso]);
    }
    const agg = aggregateTokenSaverEvents(rows.map((r) => parseJson(r.data, null)).filter(Boolean));
    // Daily points for the overview chart: group the same window's events by
    // local dateKey and fold each day. Ordered by date. Bounded periods are
    // zero-filled to a contiguous calendar range so the chart doesn't connect
    // sparse observations; "all" stays observed-only to avoid an unbounded
    // array (24h spans today + yesterday, the rolling window's observed dates).
    const byDay = new Map();
    for (const r of rows) {
      const ev = parseJson(r.data, null);
      if (!ev) continue;
      // Ignore rows with a corrupt/imported dateKey — they'd poison the chart.
      if (!isString(r.dateKey) || !/^\d{4}-\d{2}-\d{2}$/.test(r.dateKey)) continue;
      if (!byDay.has(r.dateKey)) byDay.set(r.dateKey, []);
      byDay.get(r.dateKey).push(ev);
    }
    const foldDay = (dateKey) => {
      const day = aggregateTokenSaverEvents(byDay.get(dateKey) || []);
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