import { EventEmitter } from "events";
import { createHash } from "node:crypto";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getMeta, setMeta } from "../helpers/metaStore.js";
import {
  EMPTY_ALL_TIME_CHART_DAYS,
  MAX_USAGE_CHART_BUCKETS,
  addLocalCalendarDays,
  getChartDayBucketCount,
  getUsageCalendarCutoff,
  getUsagePeriodDays,
  localDateFromKey,
  toLocalDateKey,
} from "../../usagePeriods.js";
import { incrementApiKeyUsageSync } from "./apiKeyUsageTotalsRepo.js";

function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  // Legacy keys contain only 32 bits of secret material (`sk-<8 hex>`).
  // Revealing a prefix, or an unsalted digest that verifies guesses offline,
  // makes those keys practical to recover. Usage APIs therefore expose no
  // secret-derived characters at all.
  return "***";
}

function fingerprintApiKey(key) {
  if (!key || typeof key !== "string") return null;
  return `sha256:${createHash("sha256").update(key).digest("hex")}`;
}

function getApiKeyStatsKey(apiKey, model, provider) {
  const keyIdentity = fingerprintApiKey(apiKey) || "local-no-key";
  return `${keyIdentity}|${model}|${provider || "unknown"}`;
}

const PENDING_TIMEOUT_MS = 60 * 1000;
const RING_CAP = 50;
const CONN_CACHE_TTL_MS = 30 * 1000;
// Window durations in ms for history/reset queries. Calendar-day stats/charts use getUsagePeriodDays/getChartDayBucketCount from usagePeriods.js.
const PERIOD_MS = { "24h": 86400000 };

// In-memory state shared across Next.js modules
if (!global._pendingRequests) global._pendingRequests = { byModel: {}, byAccount: {} };
if (!global._lastErrorProvider) global._lastErrorProvider = { provider: "", ts: 0 };
if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
if (!global._pendingTimers) global._pendingTimers = {};
if (!global._recentRing) global._recentRing = { items: [], initialized: false };
if (!global._connectionMapCache) global._connectionMapCache = { map: {}, ts: 0 };
if (!global._statsEmitTimers) global._statsEmitTimers = { pending: null, update: null };

const pendingRequests = global._pendingRequests;
const lastErrorProvider = global._lastErrorProvider;
const pendingTimers = global._pendingTimers;
const recentRing = global._recentRing;
const connCache = global._connectionMapCache;
const statsEmitTimers = global._statsEmitTimers;

export const statsEmitter = global._statsEmitter;

function scheduleStatsEvent(event, delayMs = 150) {
  const key = event === "update" ? "update" : "pending";
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

function aggregateEntryToDay(day, entry) {
  const promptTokens = entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const completionTokens = entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cachedTokens = entry.tokens?.cached_tokens || entry.tokens?.cache_read_input_tokens || 0;
  const reasoningTokens = entry.tokens?.reasoning_tokens
    || entry.tokens?.completion_tokens_details?.reasoning_tokens
    || entry.tokens?.output_tokens_details?.reasoning_tokens
    || 0;
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

  const akModelKey = getApiKeyStatsKey(entry.apiKey, entry.model, entry.provider);
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
      tokens: parseJson(r.tokens, {}),
    }));
  } catch {}
}

async function calculateCost(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("./pricingRepo.js");
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) return 0;

    // Delegate the actual math to the single source of truth (avoids the two
    // copies drifting apart — see open-sse/providers/pricing.js for the
    // cache-inclusive prompt_tokens convention this assumes).
    const { calculateCostFromTokens } = await import("open-sse/providers/pricing.js");
    return calculateCostFromTokens(tokens, pricing);
  } catch (e) {
    console.error("Error calculating cost:", e);
    return 0;
  }
}

export function trackPendingRequest(model, provider, connectionId, started, error = false) {
  const modelKey = provider ? `${model} (${provider})` : model;
  const timerKey = `${connectionId}|${modelKey}`;

  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, pendingRequests.byModel[modelKey] + (started ? 1 : -1));
  if (pendingRequests.byModel[modelKey] === 0) delete pendingRequests.byModel[modelKey];

  if (connectionId) {
    if (!pendingRequests.byAccount[connectionId]) pendingRequests.byAccount[connectionId] = {};
    if (!pendingRequests.byAccount[connectionId][modelKey]) pendingRequests.byAccount[connectionId][modelKey] = 0;
    pendingRequests.byAccount[connectionId][modelKey] = Math.max(0, pendingRequests.byAccount[connectionId][modelKey] + (started ? 1 : -1));
    if (pendingRequests.byAccount[connectionId][modelKey] === 0) {
      delete pendingRequests.byAccount[connectionId][modelKey];
      if (Object.keys(pendingRequests.byAccount[connectionId]).length === 0) {
        delete pendingRequests.byAccount[connectionId];
      }
    }
  }

  if (started) {
    clearTimeout(pendingTimers[timerKey]);
    pendingTimers[timerKey] = setTimeout(() => {
      delete pendingTimers[timerKey];
      if (pendingRequests.byModel[modelKey] > 0) pendingRequests.byModel[modelKey] = 0;
      if (connectionId && pendingRequests.byAccount[connectionId]?.[modelKey] > 0) {
        pendingRequests.byAccount[connectionId][modelKey] = 0;
      }
      scheduleStatsEvent("pending");
    }, PENDING_TIMEOUT_MS);
  } else {
    clearTimeout(pendingTimers[timerKey]);
    delete pendingTimers[timerKey];
  }

  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  const t = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  console.log(`[${t}] [PENDING] ${started ? "START" : "END"}${error ? " (ERROR)" : ""} | provider=${provider} | model=${model}`);
  scheduleStatsEvent("pending");
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
          account: accountName, count,
        });
      }
    }
  }

  await ensureRingInitialized();
  const seen = new Set();
  const recentRequests = [...recentRing.items]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((e) => {
      const t = e.tokens || {};
      return {
        timestamp: e.timestamp, model: e.model, provider: e.provider || "",
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
        status: e.status || "ok",
      };
    })
    .filter((e) => {
      if (e.promptTokens === 0 && e.completionTokens === 0) return false;
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const errorProvider = (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "";
  return { activeRequests, recentRequests, errorProvider };
}

export async function saveRequestUsage(entry) {
  try {
    const db = await getAdapter();

    if (!entry.timestamp) entry.timestamp = new Date().toISOString();
    entry.cost = await calculateCost(entry.provider, entry.model, entry.tokens);

    const tokens = entry.tokens || {};
    const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const completionTokens = tokens.completion_tokens || tokens.output_tokens || 0;

    let inserted = false;

    // All 3 writes (history insert, daily upsert, lifetime counter) in ONE transaction.
    // better-sqlite3 is sync → no JS yield mid-transaction → no race in same process.
    db.transaction(() => {
      const existing = db.get(
        `SELECT id, endpoint FROM usageHistory
         WHERE timestamp = ?
           AND COALESCE(provider, '') = COALESCE(?, '')
           AND COALESCE(model, '') = COALESCE(?, '')
           AND COALESCE(connectionId, '') = COALESCE(?, '')
           AND COALESCE(apiKey, '') = COALESCE(?, '')
           AND promptTokens = ?
           AND completionTokens = ?
         ORDER BY id DESC LIMIT 1`,
        [
          entry.timestamp, entry.provider || null, entry.model || null,
          entry.connectionId || null, entry.apiKey || null,
          promptTokens, completionTokens,
        ]
      );

      if (existing) {
        if (!existing.endpoint && entry.endpoint) {
          db.run(`UPDATE usageHistory SET endpoint = ? WHERE id = ?`, [entry.endpoint, existing.id]);
        }
        return;
      }

      db.run(
        `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.timestamp, entry.provider || null, entry.model || null,
          entry.connectionId || null, entry.apiKey || null, entry.endpoint || null,
          promptTokens, completionTokens, entry.cost || 0, entry.status || "ok",
          stringifyJson(tokens), stringifyJson({}),
        ]
      );

      const dateKey = toLocalDateKey(entry.timestamp);
      const row = db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]);
      const day = row ? parseJson(row.data, {}) : {
        requests: 0, promptTokens: 0, completionTokens: 0, cost: 0,
        byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
      };
      aggregateEntryToDay(day, entry);
      db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`, [dateKey, stringifyJson(day)]);

      // Resolve the stored secret to its stable row id inside the same
      // transaction. The secret is read-only and is never rotated or rewritten.
      const apiKeyId = entry.apiKey
        ? db.get(`SELECT id FROM apiKeys WHERE key = ?`, [entry.apiKey])?.id || null
        : null;

      // Atomic counter increment in same transaction
      const cur = db.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`);
      const next = (cur ? parseInt(cur.value, 10) : 0) + 1;
      db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(next)]);
      if (apiKeyId) {
        incrementApiKeyUsageSync(db, apiKeyId, {
          tokens: promptTokens + completionTokens,
          cost: entry.cost || 0,
        });
      }
      inserted = true;
    });

    if (inserted) {
      pushToRing(entry);
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

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.connectionId != null) { conds.push("connectionId = ?"); params.push(filter.connectionId); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db.all(
    `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens,
            promptTokens, completionTokens
       FROM usageHistory ${where} ORDER BY id ASC`,
    params,
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
      ...parseJson(r.tokens, {}),
    },
  }));
}

function loadDaysInRange(adapter, maxDays, now = new Date()) {
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
    params,
  );

  // The current day is reconstructed from bounded history so a future-dated
  // imported row cannot contaminate any calendar-period aggregate.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayRows = adapter.all(
    `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens,
            completionTokens, cost, status, tokens
       FROM usageHistory WHERE timestamp >= ? AND timestamp <= ? ORDER BY id ASC`,
    [startOfToday.toISOString(), now.toISOString()],
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
          ...tokens,
        },
      });
    }
    rows.push({ dateKey: todayKey, data: stringifyJson(day) });
  }
  return rows;
}

export async function getUsageStats(period = "all") {
  const db = await getAdapter();
  const now = new Date();

  const [{ getProviderConnections }, { getApiKeys }, { getProviderNodes }] = await Promise.all([
    import("./connectionsRepo.js"),
    import("./apiKeysRepo.js"),
    import("./nodesRepo.js"),
  ]);

  let allConnections = [];
  try { allConnections = await getProviderConnections(); } catch {}
  const connectionMap = {};
  for (const c of allConnections) connectionMap[c.id] = c.name || c.email || c.id;

  const providerNodeNameMap = {};
  try {
    const nodes = await getProviderNodes();
    for (const n of nodes) if (n.id && n.name) providerNodeNameMap[n.id] = n.name;
  } catch {}

  let allApiKeys = [];
  try { allApiKeys = await getApiKeys(); } catch {}
  const apiKeyMap = {};
  for (const k of allApiKeys) apiKeyMap[k.key] = { name: k.name, id: k.id, createdAt: k.createdAt };

  // API responses use database IDs for registered keys and request-local
  // opaque ordinals for deleted/unknown keys. Raw hashes remain an internal
  // aggregation detail only and are never serialized to callers.
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
        apiKeyMasked: maskApiKey(apiKey),
      };
    }
    const lookup = internalIdentity || apiKey;
    if (!unknownApiKeyIds.has(lookup)) {
      unknownApiKeyIds.set(lookup, unknownApiKeyIds.size + 1);
    }
    const ordinal = unknownApiKeyIds.get(lookup);
    return {
      id: `api-key:deleted-${ordinal}`,
      keyName: `Deleted API key ${ordinal}`,
      apiKeyMasked: maskApiKey(apiKey || "unknown"),
    };
  }

  // recentRequests from live history (last 100 entries enough for 20 deduped)
  const recentRows = db.all(`SELECT timestamp, provider, model, tokens, status FROM usageHistory ORDER BY id DESC LIMIT 100`);
  const seen = new Set();
  const recentRequests = recentRows
    .map((r) => {
      const t = parseJson(r.tokens, {}) || {};
      return {
        timestamp: r.timestamp, model: r.model, provider: r.provider || "",
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
        cachedTokens: t.cached_tokens || t.cache_read_input_tokens || 0,
        status: r.status || "ok",
      };
    })
    .filter((e) => {
      if (e.promptTokens === 0 && e.completionTokens === 0) return false;
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const stats = {
    totalRequests: 0,
    totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0,
    totalReasoningTokens: 0, totalCacheCreationTokens: 0, totalCost: 0,
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
    last10Minutes: [],
    pending: pendingRequests,
    activeRequests: [],
    recentRequests,
    errorProvider: (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "",
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
          account: accountName, count,
        });
      }
    }
  }

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

  const useDailySummary = period !== "24h" && period !== "today";

  if (useDailySummary) {
    const maxDays = getUsagePeriodDays(period);
    const dayRows = loadDaysInRange(db, maxDays, now);

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
    const overlayParams = overlayCutoff
      ? [overlayCutoff.toISOString(), now.toISOString()]
      : [now.toISOString()];
    const loadLastUsed = (dimensions) => db.all(
      `SELECT MAX(timestamp) AS timestamp, ${dimensions.join(", ")}
         FROM usageHistory
        WHERE ${overlayCutoff ? "timestamp >= ? AND " : ""}timestamp <= ?
        GROUP BY ${dimensions.join(", ")}
        ORDER BY ${dimensions.join(", ")}`,
      overlayParams,
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
      const identity = getPublicApiKeyIdentity(e.apiKey, getApiKeyStatsKey(e.apiKey, e.model, e.provider));
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
      const reasoningTokens = tokens.reasoning_tokens
        || tokens.completion_tokens_details?.reasoning_tokens
        || tokens.output_tokens_details?.reasoning_tokens
        || 0;
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

      if (r.apiKey && typeof r.apiKey === "string") {
        const identity = getPublicApiKeyIdentity(r.apiKey, fingerprintApiKey(r.apiKey));
        const { keyName, apiKeyMasked } = identity;
        const apiKeyKey = identity.id;
        const akKey = `${identity.id}|${r.model}|${r.provider || "unknown"}`;
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, rawProvider: r.provider, apiKeyMasked, keyName, apiKeyKey, lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey[akKey];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.reasoningTokens += reasoningTokens; ake.cacheCreationTokens += cacheCreationTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      } else {
        const akKey = getApiKeyStatsKey(null, r.model, r.provider);
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, rawProvider: r.provider, apiKeyMasked: null, keyName: "Local (No API Key)", apiKeyKey: "local-no-key", lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey[akKey];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.reasoningTokens += reasoningTokens; ake.cacheCreationTokens += cacheCreationTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      }

      const endpoint = r.endpoint || "Unknown";
      const epKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
      if (!stats.byEndpoint[epKey]) {
        stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0, endpoint, rawModel: r.model, provider: providerDisplayName, rawProvider: r.provider, lastUsed: r.timestamp };
      }
      const epe = stats.byEndpoint[epKey];
      epe.requests++; epe.promptTokens += promptTokens; epe.completionTokens += completionTokens; epe.cachedTokens += cachedTokens; epe.reasoningTokens += reasoningTokens; epe.cacheCreationTokens += cacheCreationTokens; epe.cost += entryCost;
      if (new Date(r.timestamp) > new Date(epe.lastUsed)) epe.lastUsed = r.timestamp;
    }
  }

  stats.totalRequests = Object.values(stats.byProvider).reduce((sum, p) => sum + (p.requests || 0), 0);
  return stats;
}

export async function getChartData(period = "7d") {
  const db = await getAdapter();
  const nowDate = new Date();
  const now = nowDate.getTime();

  if (period === "today") {
    const bucketMs = 3600000;
    const startOfDay = new Date(nowDate);
    startOfDay.setHours(0, 0, 0, 0);
    const nextDay = new Date(startOfDay);
    nextDay.setDate(nextDay.getDate() + 1);
    const bucketCount = Math.round((nextDay.getTime() - startOfDay.getTime()) / bucketMs);
    const startTime = startOfDay.getTime();
    const endTime = nextDay.getTime();
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short",
    });
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      label: labelFn(startTime + i * bucketMs), tokens: 0, cachedTokens: 0,
      reasoningTokens: 0, cacheCreationTokens: 0, cost: 0,
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
        buckets[idx].reasoningTokens += tokens.reasoning_tokens
          || tokens.completion_tokens_details?.reasoning_tokens
          || tokens.output_tokens_details?.reasoning_tokens
          || 0;
        buckets[idx].cacheCreationTokens += tokens.cache_creation_input_tokens || 0;
        buckets[idx].cost += r.cost || 0;
      }
    }
    return buckets;
  }

  if (period === "24h") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const startTime = now - bucketCount * bucketMs;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      label: labelFn(startTime + i * bucketMs), tokens: 0, cachedTokens: 0,
      reasoningTokens: 0, cacheCreationTokens: 0, cost: 0,
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
      buckets[idx].reasoningTokens += tokens.reasoning_tokens
        || tokens.completion_tokens_details?.reasoning_tokens
        || tokens.output_tokens_details?.reasoning_tokens
        || 0;
      buckets[idx].cacheCreationTokens += tokens.cache_creation_input_tokens || 0;
      buckets[idx].cost += r.cost || 0;
    }
    return buckets;
  }

  const fixedDays = getChartDayBucketCount(period);
  const dayRows = loadDaysInRange(db, fixedDays, nowDate)
    .filter((row) => {
      try { localDateFromKey(row.dateKey); return true; } catch { return false; }
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
    month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}),
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
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const VALID_RESET_PERIODS = new Set(["5m", "1h", "3h", "6h", "12h", "1d", "7d", "30d", "all"]);

function rebuildDailyKeyInTx(db, dateKey) {
  const start = localDateFromKey(dateKey);
  const end = addLocalCalendarDays(start, 1);
  const rows = db.all(
    `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens,
            completionTokens, cost, status, tokens
       FROM usageHistory WHERE timestamp >= ? AND timestamp < ? AND timestamp <= ? ORDER BY id ASC`,
    [start.toISOString(), end.toISOString(), new Date().toISOString()],
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
        ...parseJson(row.tokens, {}),
      },
    });
  }
  db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`, [dateKey, stringifyJson(day)]);
}

export async function resetUsageHistory(period) {
  if (!VALID_RESET_PERIODS.has(period)) {
    throw new Error(`Invalid reset period: ${period}`);
  }

  const db = await getAdapter();

  db.transaction(() => {
    if (period === "all") {
      // Delete everything
      db.run(`DELETE FROM usageHistory`);
      db.run(`DELETE FROM usageDaily`);
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
      rebuildDailyKeyInTx(db, cutoffKey);

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
      [limit],
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
