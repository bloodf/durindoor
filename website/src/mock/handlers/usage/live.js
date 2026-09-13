// Live side of the usage mock: requests that "arrive" while the demo is open,
// the in-flight request snapshot, and the reset window from /api/usage/reset.
import { toLocalDateKey } from "@/lib/usagePeriods.js";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "../../fixtures/world.js";
import { LANES, apiKeyName } from "../../fixtures/usageLanes.js";
import { laneWeightNow, makeRequestEvent, pickWeighted, usageHistory } from "../../fixtures/usageHistory.js";

const LIVE_CAP = 300;
const CLIENTS = ["claude-code", "codex-cli", "opencode", "cline", "gemini-cli"];
const RESET_MS = { "5m": 5 * MINUTE_MS, "1h": HOUR_MS, "3h": 3 * HOUR_MS, "6h": 6 * HOUR_MS, "12h": 12 * HOUR_MS, "1d": DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS, all: Infinity };

export const RESET_PERIODS = Object.freeze(Object.keys(RESET_MS));

let liveEvents = [];
let snapshot = { active: [], finished: [] };
let ticked = false;

const random = () => Math.random();

// --- reset window --------------------------------------------------------

function resetWindow(store) {
  const reset = store.get("usage.reset");
  if (!reset?.at || !RESET_MS[reset.period]) return null;
  const at = new Date(reset.at).getTime();
  return { at, from: at - RESET_MS[reset.period], period: reset.period };
}

export function applyReset(store, period) {
  store.set("usage.reset", { at: new Date().toISOString(), period });
  liveEvents = liveEvents.filter((event) => !isEventHidden(store, event.timestamp));
}

export function isEventHidden(store, timestamp) {
  const window = resetWindow(store);
  if (!window) return false;
  const ms = new Date(timestamp).getTime();
  return ms <= window.at && ms >= window.from;
}

/** Day rollups only disappear for resets that span at least a day. */
export function isDayHidden(store, dateKey) {
  const window = resetWindow(store);
  if (!window || RESET_MS[window.period] < DAY_MS) return false;
  if (dateKey > toLocalDateKey(new Date(window.at))) return false;
  return window.period === "all" || dateKey >= toLocalDateKey(new Date(window.from));
}

// --- request events ------------------------------------------------------

/** Every raw request (seeded + live), newest first, minus reset ones. */
export function requestEvents(store) {
  const { recent } = usageHistory();
  return [...liveEvents, ...recent].filter((event) => !isEventHidden(store, event.timestamp));
}

export function liveRequestEvents(store) {
  return liveEvents.filter((event) => !isEventHidden(store, event.timestamp));
}

function sessionFor(event, status) {
  const lane = LANES[event.laneIndex];
  return {
    requestId: event.id,
    clientId: CLIENTS[event.laneIndex % CLIENTS.length],
    sessionId: `sess-${event.traceId.slice(0, 8)}`,
    model: event.model,
    provider: event.provider,
    account: lane.accountName,
    startedAt: new Date(event.timestamp).getTime() - event.latency.total,
    completedAt: status === "active" ? null : new Date(event.timestamp).getTime(),
    durationMs: status === "active" ? Math.round(1000 + random() * 6000) : event.latency.total,
    promptTokens: status === "active" ? null : event.promptTokens,
    completionTokens: status === "active" ? null : event.completionTokens,
    status,
  };
}

/**
 * Advance the live simulation one step: finish some in-flight requests,
 * start new ones. Called by the stats stream every few seconds.
 */
export function tick() {
  ticked = true;
  const now = Date.now();
  const { scales } = usageHistory();
  const finishing = snapshot.active.filter(() => random() < 0.6);
  const finished = finishing.map((item) => ({ ...item.event, timestamp: new Date(now).toISOString() }));
  liveEvents = [...[...finished].reverse(), ...liveEvents].slice(0, LIVE_CAP);
  const stillActive = snapshot.active.filter((item) => !finishing.includes(item));
  const startCount = Math.floor(random() * 3) + (stillActive.length === 0 ? 1 : 0);
  const started = Array.from({ length: startCount }, () => {
    const lane = pickWeighted(random, LANES, laneWeightNow);
    return { event: makeRequestEvent(lane, random, now, scales), startedAt: now };
  });
  snapshot = {
    active: [...stillActive, ...started].slice(0, 5),
    finished: [...finished.map((event) => ({ event, at: now })), ...snapshot.finished].filter((item) => now - item.at < 15_000),
  };
}

function modelKey(event) {
  return `${event.model} (${event.provider})`;
}

/** { pending, activeRequests, activeSessions, errorProvider } for the stats payload. */
export function liveOverlay() {
  if (!ticked) tick();
  const now = Date.now();
  const pending = { byModel: {}, byAccount: {}, byKey: {} };
  const grouped = new Map();
  for (const { event } of snapshot.active) {
    const key = modelKey(event);
    const keyName = apiKeyName(event.apiKeyId);
    pending.byModel = { ...pending.byModel, [key]: (pending.byModel[key] || 0) + 1 };
    const account = pending.byAccount[event.connectionId] || {};
    pending.byAccount = { ...pending.byAccount, [event.connectionId]: { ...account, [key]: (account[key] || 0) + 1 } };
    const byKeyConn = pending.byKey[event.connectionId] || {};
    const byKeyModel = byKeyConn[key] || {};
    pending.byKey = { ...pending.byKey, [event.connectionId]: { ...byKeyConn, [key]: { ...byKeyModel, [keyName]: (byKeyModel[keyName] || 0) + 1 } } };
    const groupId = `${event.connectionId}|${key}`;
    const group = grouped.get(groupId) || { event, count: 0, keys: {} };
    grouped.set(groupId, { ...group, count: group.count + 1, keys: { ...group.keys, [keyName]: (group.keys[keyName] || 0) + 1 } });
  }
  const activeRequests = [...grouped.values()].map(({ event, count, keys }) => ({
    model: event.model,
    provider: event.provider,
    account: LANES[event.laneIndex].accountName,
    count,
    keys: Object.entries(keys).map(([name, keyCount]) => ({ name, count: keyCount })).sort((a, b) => a.name.localeCompare(b.name)),
  }));
  const activeSessions = [
    ...snapshot.active.map(({ event, startedAt }) => ({ ...sessionFor(event, "active"), startedAt, durationMs: now - startedAt })),
    ...snapshot.finished.map(({ event }) => sessionFor(event, event.error ? "error" : "done")),
  ];
  const lastError = snapshot.finished.find((item) => item.event.error && now - item.at < 10_000);
  return { pending, activeRequests, activeSessions, errorProvider: lastError ? lastError.event.provider : "" };
}
