// Folds the usage history into the shapes getUsageStats(), getChartData()
// and the combos report return (src/lib/db/repos/usageRepo.js).
import { addLocalCalendarDays, getUsageCalendarCutoff, toLocalDateKey } from "@/lib/usagePeriods.js";
import { COMBOS } from "../../fixtures/world.js";
import { LANES, apiKeyIdentity, providerDisplay } from "../../fixtures/usageLanes.js";
import { elapsedDayShare, hourShare, usageHistory } from "../../fixtures/usageHistory.js";
import { isDayHidden, liveOverlay, liveRequestEvents, requestEvents } from "./live.js";

const METRICS = ["requests", "promptTokens", "completionTokens", "cachedTokens", "reasoningTokens", "cacheCreationTokens", "cost"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function customRange(startDate, endDate) {
  if (!DATE_RE.test(startDate || "") || !DATE_RE.test(endDate || "")) return null;
  return startDate <= endDate ? { start: startDate, end: endDate } : { start: endDate, end: startDate };
}

/** Fraction of a day's rollup that falls inside the requested window. */
function dayFactor(dateKey, period, now, range) {
  const todayKey = toLocalDateKey(now);
  if (dateKey > todayKey) return 0;
  // ponytail: floor so "today" never looks empty in an early-morning demo; charts use the raw hour profile.
  const partial = dateKey === todayKey ? Math.max(elapsedDayShare(now), 0.3) : 1;
  if (range) return dateKey >= range.start && dateKey <= range.end ? partial : 0;
  if (period === "today") return dateKey === todayKey ? partial : 0;
  if (period === "24h") {
    if (dateKey === todayKey) return partial;
    return dateKey === toLocalDateKey(addLocalCalendarDays(now, -1)) ? 1 - elapsedDayShare(now) : 0;
  }
  const cutoff = getUsageCalendarCutoff(period, now);
  return !cutoff || dateKey >= toLocalDateKey(cutoff) ? partial : 0;
}

/** Weighted rows for a window: day rollups plus requests that arrived live. */
export function windowRows(store, period, { startDate, endDate } = {}) {
  const now = new Date();
  const range = customRange(startDate, endDate);
  const { cells } = usageHistory(now);
  const rows = [];
  for (const cell of cells) {
    const factor = dayFactor(cell.dateKey, period, now, range);
    if (factor > 0 && !isDayHidden(store, cell.dateKey)) rows.push({ cell, factor, lastUsed: cell.dateKey });
  }
  if (dayFactor(toLocalDateKey(now), period, now, range) > 0) {
    for (const event of liveRequestEvents(store)) {
      if (event.httpStatus === 200) rows.push({ cell: { ...event, requests: 1 }, factor: 1, lastUsed: event.timestamp });
    }
  }
  return rows;
}

const emptyMetrics = () => Object.fromEntries(METRICS.map((metric) => [metric, 0]));

function add(target, cell, factor, lastUsed) {
  const next = { ...target };
  for (const metric of METRICS) next[metric] = (target[metric] || 0) + (cell[metric] || 0) * factor;
  if (lastUsed && (!target.lastUsed || lastUsed > target.lastUsed)) next.lastUsed = lastUsed;
  return next;
}

function finalize(map) {
  const rounded = (row) => Object.fromEntries(Object.entries(row).map(([metric, value]) => [metric, metric !== "cost" && METRICS.includes(metric) ? Math.round(value) : value]));
  return Object.fromEntries(Object.entries(map).map(([key, row]) => [key, rounded(row)]));
}

function dimensionKeys(cell) {
  const lane = LANES[cell.laneIndex];
  const identity = apiKeyIdentity(cell.apiKeyId);
  const provider = lane.provider;
  return {
    lane,
    identity,
    model: `${lane.model} (${provider})`,
    account: `${lane.model} (${provider} - ${lane.accountName})`,
    apiKey: `${identity.id}|${lane.model}|${provider}`,
    endpoint: `${cell.endpoint}|${lane.model}|${provider}`,
  };
}

function lastSeenIndex(store) {
  const index = {};
  for (const event of requestEvents(store)) {
    for (const key of Object.values(dimensionKeys(event)).filter((value) => typeof value === "string")) {
      if (!index[key] || event.timestamp > index[key]) index[key] = event.timestamp;
    }
  }
  return index;
}

function last10Minutes(store) {
  const currentMinute = Math.floor(Date.now() / 60000) * 60000;
  const buckets = Array.from({ length: 10 }, () => ({ requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 }));
  for (const event of requestEvents(store)) {
    const index = 9 - (currentMinute - Math.floor(new Date(event.timestamp).getTime() / 60000) * 60000) / 60000;
    if (index < 0 || index > 9) continue;
    const bucket = buckets[index];
    buckets[index] = {
      requests: bucket.requests + 1,
      promptTokens: bucket.promptTokens + event.promptTokens,
      completionTokens: bucket.completionTokens + event.completionTokens,
      cost: bucket.cost + event.cost,
    };
  }
  return buckets;
}

function recentRequests(store) {
  return requestEvents(store)
    .filter((event) => event.promptTokens > 0 || event.completionTokens > 0)
    .slice(0, 20)
    .map((event) => ({
      timestamp: event.timestamp, model: event.model, provider: event.provider,
      promptTokens: event.promptTokens, completionTokens: event.completionTokens, cachedTokens: event.cachedTokens, status: "ok",
    }));
}

export function buildStats(store, period, options = {}) {
  const rows = windowRows(store, period, options);
  const lastSeen = lastSeenIndex(store);
  const totals = emptyMetrics();
  const maps = { byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {} };
  let sum = totals;
  for (const { cell, factor, lastUsed } of rows) {
    const keys = dimensionKeys(cell);
    const { lane, identity } = keys;
    const base = { rawModel: lane.model, provider: providerDisplay(lane.provider), rawProvider: lane.provider };
    const used = (key) => (lastSeen[key] && lastSeen[key] > lastUsed ? lastSeen[key] : lastUsed);
    sum = add(sum, cell, factor);
    maps.byProvider[lane.provider] = add(maps.byProvider[lane.provider] || emptyMetrics(), cell, factor);
    maps.byModel[keys.model] = add(maps.byModel[keys.model] || { ...emptyMetrics(), ...base }, cell, factor, used(keys.model));
    maps.byAccount[keys.account] = add(
      maps.byAccount[keys.account] || { ...emptyMetrics(), ...base, connectionId: lane.connectionId, accountName: lane.accountName },
      cell, factor, used(keys.account),
    );
    maps.byApiKey[keys.apiKey] = add(
      maps.byApiKey[keys.apiKey] || { ...emptyMetrics(), ...base, apiKeyMasked: identity.apiKeyMasked, keyName: identity.keyName, apiKeyKey: identity.id },
      cell, factor, used(keys.apiKey),
    );
    maps.byEndpoint[keys.endpoint] = add(maps.byEndpoint[keys.endpoint] || { ...emptyMetrics(), ...base, endpoint: cell.endpoint }, cell, factor, used(keys.endpoint));
  }
  const byProvider = finalize(maps.byProvider);
  return {
    totalRequests: Object.values(byProvider).reduce((total, row) => total + row.requests, 0),
    totalPromptTokens: Math.round(sum.promptTokens),
    totalCompletionTokens: Math.round(sum.completionTokens),
    totalCachedTokens: Math.round(sum.cachedTokens),
    totalReasoningTokens: Math.round(sum.reasoningTokens),
    totalCacheCreationTokens: Math.round(sum.cacheCreationTokens),
    totalCost: sum.cost,
    byProvider,
    byModel: finalize(maps.byModel),
    byAccount: finalize(maps.byAccount),
    byApiKey: finalize(maps.byApiKey),
    byEndpoint: finalize(maps.byEndpoint),
    last10Minutes: last10Minutes(store),
    recentRequests: recentRequests(store),
    ...liveOverlay(),
  };
}

// --- chart ---------------------------------------------------------------

const emptyBucket = (label) => ({ label, tokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, cost: 0 });

function addToBucket(bucket, cell, factor) {
  return {
    ...bucket,
    tokens: bucket.tokens + (cell.promptTokens + cell.completionTokens) * factor,
    cachedTokens: bucket.cachedTokens + cell.cachedTokens * factor,
    reasoningTokens: bucket.reasoningTokens + cell.reasoningTokens * factor,
    cacheCreationTokens: bucket.cacheCreationTokens + cell.cacheCreationTokens * factor,
    cost: bucket.cost + cell.cost * factor,
  };
}

const roundBucket = (bucket) => ({
  ...bucket,
  tokens: Math.round(bucket.tokens),
  cachedTokens: Math.round(bucket.cachedTokens),
  reasoningTokens: Math.round(bucket.reasoningTokens),
  cacheCreationTokens: Math.round(bucket.cacheCreationTokens),
});

function hourlyChart(store, period) {
  const now = new Date();
  const hourLabel = (ms) => new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const start = period === "today" ? startOfDay.getTime() : Math.floor((now.getTime() - 24 * 3_600_000) / 3_600_000) * 3_600_000 + 3_600_000;
  let buckets = Array.from({ length: 24 }, (_, index) => emptyBucket(hourLabel(start + index * 3_600_000)));
  const { cells } = usageHistory(now);
  const byDate = new Map();
  for (const cell of cells) {
    if (isDayHidden(store, cell.dateKey)) continue;
    byDate.set(cell.dateKey, [...(byDate.get(cell.dateKey) || []), cell]);
  }
  buckets = buckets.map((bucket, index) => {
    const at = new Date(start + index * 3_600_000);
    if (at.getTime() > now.getTime()) return bucket;
    const share = hourShare(at.getHours()) * (now.getTime() - at.getTime() < 3_600_000 ? now.getMinutes() / 60 : 1);
    return (byDate.get(toLocalDateKey(at)) || []).reduce((acc, cell) => addToBucket(acc, cell, share), bucket);
  });
  for (const event of liveRequestEvents(store)) {
    const index = Math.floor((new Date(event.timestamp).getTime() - start) / 3_600_000);
    if (index >= 0 && index < 24) buckets[index] = addToBucket(buckets[index], event, 1);
  }
  return buckets.map(roundBucket);
}

export function buildChart(store, period) {
  if (period === "today" || period === "24h") return hourlyChart(store, period);
  const now = new Date();
  const rows = windowRows(store, period);
  const cutoff = getUsageCalendarCutoff(period, now);
  const firstKey = cutoff ? toLocalDateKey(cutoff) : rows.reduce((min, row) => (row.cell.dateKey < min ? row.cell.dateKey : min), toLocalDateKey(now));
  const withYear = !cutoff;
  const keys = [];
  for (let date = new Date(`${firstKey}T00:00:00`); toLocalDateKey(date) <= toLocalDateKey(now); date = addLocalCalendarDays(date, 1)) {
    keys.push(toLocalDateKey(date));
  }
  const indexByKey = new Map(keys.map((key, index) => [key, index]));
  const buckets = keys.map((key) => emptyBucket(new Date(`${key}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : null) })));
  for (const { cell, factor } of rows) {
    const index = indexByKey.get(cell.dateKey ?? toLocalDateKey(new Date(cell.timestamp)));
    if (index != null) buckets[index] = addToBucket(buckets[index], cell, factor);
  }
  return buckets.map(roundBucket);
}

// --- combos report -------------------------------------------------------

const BOUNDARY = "Combo and connection attribution starts with migration 014. Earlier history was never recorded with combo identity and remains separately unattributed.";

export function buildComboReport(store, period, options = {}) {
  const groups = new Map();
  let unattributed = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
  for (const { cell, factor } of windowRows(store, period, options)) {
    const lane = LANES[cell.laneIndex];
    const metrics = { requests: cell.requests * factor, promptTokens: cell.promptTokens * factor, completionTokens: cell.completionTokens * factor, cost: cell.cost * factor };
    const combo = cell.comboName ? COMBOS.find((item) => item.name === cell.comboName) : null;
    if (!combo) {
      unattributed = Object.fromEntries(Object.keys(unattributed).map((key) => [key, unattributed[key] + metrics[key]]));
      continue;
    }
    const id = `${combo.id}|${lane.connectionId}`;
    const row = groups.get(id) || { comboId: combo.id, comboName: combo.name, connectionId: lane.connectionId, requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    groups.set(id, Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key in metrics ? value + metrics[key] : value])));
  }
  const round = (row) => ({ ...row, requests: Math.round(row.requests), promptTokens: Math.round(row.promptTokens), completionTokens: Math.round(row.completionTokens) });
  return {
    mode: "future-only",
    boundary: BOUNDARY,
    rows: [...groups.values()].map(round).sort((a, b) => a.comboName.localeCompare(b.comboName) || a.connectionId.localeCompare(b.connectionId)),
    unattributed: round(unattributed),
  };
}
