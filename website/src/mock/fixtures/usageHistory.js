// Deterministic usage history: per-day rollup cells (60 days) plus ~200 raw
// recent requests over the last eight hours. Rebuilt once per calendar day so
// relative dates stay current; the same seed always yields the same numbers.
import { toLocalDateKey, addLocalCalendarDays } from "@/lib/usagePeriods.js";
import { API_KEYS, DAY_MS, HOUR_MS, MINUTE_MS, seeded } from "./world.js";
import { FAILURES, LANES, laneCost } from "./usageLanes.js";

export const HISTORY_DAYS = 60;
const RECENT_COUNT = 200;
const RECENT_WINDOW_MS = 8 * HOUR_MS;

// Relative request volume per local hour of day.
export const HOUR_PROFILE = Object.freeze([
  0.3, 0.2, 0.15, 0.1, 0.1, 0.15, 0.3, 0.6, 1.0, 1.4, 1.6, 1.6, 1.3, 1.5, 1.7, 1.7, 1.5, 1.3, 1.0, 0.9, 0.8, 0.7, 0.6, 0.4,
]);
const HOUR_TOTAL = HOUR_PROFILE.reduce((sum, value) => sum + value, 0);

export function hourShare(hour) {
  return HOUR_PROFILE[hour] / HOUR_TOTAL;
}

/** Share of a full day's traffic that has already happened by `now` (local time). */
export function elapsedDayShare(now = new Date()) {
  const hour = now.getHours();
  const done = HOUR_PROFILE.slice(0, hour).reduce((sum, value) => sum + value, 0);
  return (done + HOUR_PROFILE[hour] * (now.getMinutes() / 60)) / HOUR_TOTAL;
}

const between = (rand, min, max) => min + rand() * (max - min);

function pickWeighted(rand, items, weightOf) {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let roll = rand() * total;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function rawCells(now) {
  const rand = seeded(20128);
  const cells = [];
  for (let age = HISTORY_DAYS - 1; age >= 0; age -= 1) {
    const date = addLocalCalendarDays(now, -age);
    const dateKey = toLocalDateKey(date);
    const weekday = date.getDay();
    const dayFactor = (weekday === 0 || weekday === 6 ? 0.45 : 1) * (0.8 + 0.2 * (1 - age / HISTORY_DAYS));
    for (const lane of LANES) {
      const noise = between(rand, 0.75, 1.25);
      if (lane.activeUntilDaysAgo != null && age < lane.activeUntilDaysAgo) continue;
      const laneRequests = lane.weight * dayFactor * noise;
      for (const [apiKeyId, endpoint, comboName, share] of lane.mix) {
        const requests = laneRequests * share;
        const promptTokens = requests * lane.prompt * between(rand, 0.85, 1.15);
        const completionTokens = requests * lane.completion * between(rand, 0.85, 1.15);
        cells.push({
          dateKey, laneIndex: lane.index, apiKeyId, endpoint, comboName, requests, promptTokens, completionTokens,
          cachedTokens: promptTokens * lane.cache,
          reasoningTokens: completionTokens * lane.reasoning,
          cacheCreationTokens: lane.cacheWrite ? promptTokens * 0.05 : 0,
        });
      }
    }
  }
  return cells.map((cell) => ({ ...cell, cost: laneCost(LANES[cell.laneIndex], cell) }));
}

/**
 * Scale each key's traffic so its last-30-day totals match world.API_KEYS
 * usage. Keyless local traffic follows the workstation key's scale.
 */
function keyScales(cells, now) {
  const cutoff = toLocalDateKey(addLocalCalendarDays(now, -29));
  const sums = {};
  for (const cell of cells) {
    if (cell.dateKey < cutoff || !cell.apiKeyId) continue;
    const sum = (sums[cell.apiKeyId] ||= { requests: 0, tokens: 0, cost: 0 });
    sum.requests += cell.requests;
    sum.tokens += cell.promptTokens + cell.completionTokens;
    sum.cost += cell.cost;
  }
  const scales = Object.fromEntries(
    API_KEYS.map((key) => {
      const sum = sums[key.id] || { requests: 1, tokens: 1, cost: 1 };
      return [key.id, { requests: key.usage.requests / sum.requests, tokens: key.usage.tokens / sum.tokens, cost: key.usage.cost / sum.cost }];
    }),
  );
  return { ...scales, local: scales["key-workstation"] };
}

function scaleCell(cell, scale) {
  return {
    ...cell,
    requests: cell.requests * scale.requests,
    promptTokens: cell.promptTokens * scale.tokens,
    completionTokens: cell.completionTokens * scale.tokens,
    cachedTokens: cell.cachedTokens * scale.tokens,
    reasoningTokens: cell.reasoningTokens * scale.tokens,
    cacheCreationTokens: cell.cacheCreationTokens * scale.tokens,
    cost: cell.cost * scale.cost,
  };
}

function failureFor(lane, rand) {
  const options = FAILURES[lane.connectionId];
  if (!options) return null;
  // The backup codex account fails most of the time; cursor always does now.
  if (lane.connectionId === "conn-codex-backup" && rand() > 0.7) return null;
  return pickWeighted(rand, options, (option) => option.share);
}

function hex(rand, length) {
  return Array.from({ length }, () => Math.floor(rand() * 16).toString(16)).join("");
}

/** Build one raw request from a lane. Shared by seeded history and live drift. */
export function makeRequestEvent(lane, rand, timestampMs, scales) {
  const [apiKeyId, endpoint, comboName] = pickWeighted(rand, lane.mix, (entry) => entry[3]);
  const scale = scales[apiKeyId || "local"];
  const perRequest = scale.tokens / scale.requests;
  const failure = failureFor(lane, rand);
  const promptTokens = failure ? 0 : Math.round(lane.prompt * perRequest * between(rand, 0.4, 1.6));
  const completionTokens = failure ? 0 : Math.round(lane.completion * perRequest * between(rand, 0.4, 1.6));
  const cachedTokens = Math.round(promptTokens * lane.cache * between(rand, 0.7, 1));
  const total = failure ? Math.round(between(rand, 180, 900)) : Math.round(between(rand, 1800, 14000));
  const timestamp = new Date(timestampMs).toISOString();
  const tokens = { prompt_tokens: promptTokens, completion_tokens: completionTokens };
  if (cachedTokens) tokens[lane.cacheWrite ? "cache_read_input_tokens" : "cached_tokens"] = cachedTokens;
  if (lane.cacheWrite && promptTokens) tokens.cache_creation_input_tokens = Math.round(promptTokens * 0.05);
  if (lane.reasoning && completionTokens) tokens.reasoning_tokens = Math.round(completionTokens * lane.reasoning);
  return {
    id: `${timestamp}-${hex(rand, 6)}-${lane.model.replace(/[^a-zA-Z0-9-]/g, "-")}`,
    traceId: `${hex(rand, 8)}-${hex(rand, 4)}-4${hex(rand, 3)}-a${hex(rand, 3)}-${hex(rand, 12)}`,
    timestamp,
    laneIndex: lane.index,
    provider: lane.provider,
    model: lane.model,
    connectionId: lane.connectionId,
    apiKeyId,
    endpoint,
    comboName,
    tokens,
    promptTokens,
    completionTokens,
    cachedTokens,
    reasoningTokens: tokens.reasoning_tokens || 0,
    cacheCreationTokens: tokens.cache_creation_input_tokens || 0,
    cost: failure ? 0 : laneCost(lane, { promptTokens, completionTokens, cachedTokens }) * (scale.cost / scale.tokens),
    httpStatus: failure ? failure.status : 200,
    error: failure?.message || null,
    latency: { ttft: failure ? 0 : Math.round(between(rand, 250, 1400)), total },
  };
}

export function laneWeightNow(lane) {
  // Recent traffic avoids paused accounts; failing accounts still get tried.
  if (lane.connectionId === "conn-kiro") return 0;
  if (lane.connectionId === "conn-cursor") return 1.2;
  if (lane.connectionId === "conn-codex-backup") return 2;
  return lane.weight;
}

function recentEvents(nowMs, scales) {
  const rand = seeded(4242);
  const events = [];
  for (let index = 0; index < RECENT_COUNT; index += 1) {
    const offset = RECENT_WINDOW_MS * (index / RECENT_COUNT) ** 1.8 + between(rand, 5_000, 40_000);
    const lane = pickWeighted(rand, LANES, laneWeightNow);
    events.push(makeRequestEvent(lane, rand, nowMs - offset, scales));
  }
  return events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

let cached = null;

/**
 * { cells, recent, scales, builtAt } for the current calendar day. Cells are
 * full-day rollups; callers scale today's cell by elapsedDayShare().
 */
export function usageHistory(now = new Date()) {
  const todayKey = toLocalDateKey(now);
  if (cached?.todayKey === todayKey) return cached;
  const raw = rawCells(now);
  const scales = keyScales(raw, now);
  const cells = raw.map((cell) => scaleCell(cell, scales[cell.apiKeyId || "local"]));
  cached = { todayKey, cells, scales, recent: recentEvents(now.getTime(), scales), builtAt: now.getTime() };
  return cached;
}

export { DAY_MS, MINUTE_MS, pickWeighted };
