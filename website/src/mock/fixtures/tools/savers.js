// Deterministic Headroom, PXPIPE and Token Saver metrics built from the shared
// world so provider/model names match the usage pages.
import { CONNECTIONS, DAY_MS, MINUTE_MS, seeded } from "../world.js";

const TRAFFIC = CONNECTIONS.filter((connection) => connection.isActive && connection.testStatus === "active");
const CLAUDE_MODELS = [
  { provider: "cc", model: "claude-sonnet-5" },
  { provider: "cc", model: "claude-opus-5" },
  { provider: "anthropic", model: "claude-opus-5" },
];

const dateKey = (ms) => new Date(Date.now() - ms).toISOString().slice(0, 10);
const round1 = (value) => Math.round(value * 10) / 10;

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

function sumWindow(days, keys) {
  const inRange = (event) => Date.now() - Date.parse(event.ts) < days * DAY_MS;
  return (events) => {
    const scoped = days === Infinity ? events : events.filter(inRange);
    return keys(scoped);
  };
}

// Headroom ------------------------------------------------------------------

const HEADROOM_SKIPS = ["skipped", "skipped", "missing_request_body", "missing_request_body", "skipped:_openai-responses_tool/reasoning_input_is_not_safe_to_compress", "request_failed: timeout after 15000ms"];

function headroomEvents() {
  const rand = seeded(1307);
  return Array.from({ length: 180 }, (_, index) => {
    const connection = pick(rand, TRAFFIC);
    const applied = rand() > 0.34;
    const tokensBefore = 4000 + Math.floor(rand() * 42000);
    const tokensSaved = applied ? Math.floor(tokensBefore * (0.22 + rand() * 0.24)) : 0;
    return {
      ts: new Date(Date.now() - index * 97 * MINUTE_MS - Math.floor(rand() * 40) * MINUTE_MS).toISOString(),
      provider: connection.alias,
      model: pick(rand, connection.models),
      applied,
      ...(applied ? {} : { reason: pick(rand, HEADROOM_SKIPS) }),
      tokensBefore,
      tokensSaved,
      compressionMs: 140 + Math.floor(rand() * 260),
    };
  });
}

function headroomWindow(events) {
  const compressed = events.filter((event) => event.applied);
  const tokensBefore = events.reduce((sum, event) => sum + event.tokensBefore, 0);
  const tokensSaved = compressed.reduce((sum, event) => sum + event.tokensSaved, 0);
  return {
    requests: events.length,
    compressed: compressed.length,
    bypassed: events.length - compressed.length,
    tokensBefore,
    tokensSaved,
    savedPct: tokensBefore ? round1((tokensSaved / tokensBefore) * 100) : 0,
    errors: events.filter((event) => event.reason?.startsWith("request_failed")).length,
    avgCompressionMs: compressed.length ? Math.round(compressed.reduce((sum, event) => sum + event.compressionMs, 0) / compressed.length) : 0,
  };
}

function dailySeries(events, days, valueKey, outKey) {
  return Array.from({ length: days }, (_, offset) => {
    const key = dateKey((days - 1 - offset) * DAY_MS);
    const total = events.filter((event) => event.ts.slice(0, 10) === key).reduce((sum, event) => sum + (event[valueKey] || 0), 0);
    return { date: key, [outKey]: total };
  });
}

function windowsFor(events, reduce) {
  const today = dateKey(0);
  const yesterday = dateKey(DAY_MS);
  return {
    today: reduce(events.filter((event) => event.ts.slice(0, 10) === today)),
    yesterday: reduce(events.filter((event) => event.ts.slice(0, 10) === yesterday)),
    last7d: sumWindow(7, reduce)(events),
    last30d: sumWindow(30, reduce)(events),
    all: reduce(events),
  };
}

export function headroomStats(limit = 100) {
  const events = headroomEvents();
  // Older history beyond the generated events keeps "All time" larger than 30 days.
  const windows = windowsFor(events, headroomWindow);
  const all = windows.all;
  const allTime = { ...all, requests: all.requests + 2140, compressed: all.compressed + 1410, bypassed: all.bypassed + 730, tokensBefore: all.tokensBefore + 41_280_000, tokensSaved: all.tokensSaved + 13_620_000 };
  return {
    windows: { ...windows, all: { ...allTime, savedPct: round1((allTime.tokensSaved / allTime.tokensBefore) * 100) } },
    timeline: dailySeries(events, 14, "tokensSaved", "tokensSaved"),
    recent: events.slice(0, limit).map(({ compressionMs: _ms, ...event }) => event),
  };
}

// PXPIPE --------------------------------------------------------------------

function pxpipeEvents() {
  const rand = seeded(2711);
  return Array.from({ length: 90 }, (_, index) => {
    const target = pick(rand, CLAUDE_MODELS);
    const roll = rand();
    const applied = roll > 0.28;
    const reason = applied ? undefined : roll > 0.12 ? "below_threshold" : roll > 0.05 ? "unsupported_model" : "render_failed";
    const tokensBeforeEst = 26000 + Math.floor(rand() * 90000);
    const tokensAfterEst = applied ? Math.floor(tokensBeforeEst * (0.38 + rand() * 0.2)) : tokensBeforeEst;
    return {
      id: `pxp-${index}`,
      ts: new Date(Date.now() - index * 5 * 60 * MINUTE_MS - Math.floor(rand() * 90) * MINUTE_MS).toISOString(),
      provider: reason === "unsupported_model" ? "deepseek" : target.provider,
      model: reason === "unsupported_model" ? "deepseek-v4-pro" : target.model,
      applied,
      ...(reason ? { reason } : {}),
      ...(reason === "render_failed" ? { detail: "canvas renderer timed out" } : {}),
      tokensBeforeEst,
      tokensAfterEst,
      tokensSavedEst: tokensBeforeEst - tokensAfterEst,
      savedPct: applied ? Math.round(((tokensBeforeEst - tokensAfterEst) / tokensBeforeEst) * 100) : 0,
      imageCount: applied ? 1 + Math.floor(rand() * 5) : 0,
      durationMs: 120 + Math.floor(rand() * 400),
    };
  });
}

function pxpipeWindow(events) {
  const applied = events.filter((event) => event.applied);
  const before = applied.reduce((sum, event) => sum + event.tokensBeforeEst, 0);
  const after = applied.reduce((sum, event) => sum + event.tokensAfterEst, 0);
  return {
    requests: events.length,
    compressed: applied.length,
    bypassed: events.length - applied.length,
    tokensBeforeEst: before,
    tokensAfterEst: after,
    tokensSavedEst: before - after,
    savedPct: before ? Math.round(((before - after) / before) * 100) : 0,
    imagesGenerated: applied.reduce((sum, event) => sum + event.imageCount, 0),
    avgCompressionMs: applied.length ? Math.round(applied.reduce((sum, event) => sum + event.durationMs, 0) / applied.length) : 0,
    errors: events.filter((event) => event.reason === "render_failed").length,
  };
}

export function pxpipeStats() {
  const events = pxpipeEvents();
  return { windows: windowsFor(events, pxpipeWindow), recent: events, timeline: dailySeries(events, 14, "tokensSavedEst", "tokensSavedEst") };
}

export function pxpipeLogs(limit = 100) {
  return pxpipeEvents().slice(0, limit);
}

// Token Saver aggregate -------------------------------------------------------

const PERIOD_DAYS = { today: 1, "24h": 1, "7d": 7, "30d": 30, "60d": 60, "90d": 90, "180d": 180, "365d": 365, all: 400 };

export function tokenSaverStats(period = "7d") {
  const days = PERIOD_DAYS[period] || 7;
  const rand = seeded(days * 31 + 7);
  const scale = (value) => Math.round(value * days * (0.9 + rand() * 0.2));
  const chartDays = Math.min(days, 90);
  const dailyPoints = Array.from({ length: chartDays }, (_, offset) => ({
    dateKey: dateKey((chartDays - 1 - offset) * DAY_MS),
    actualBytesSaved: Math.round(180_000 + rand() * 260_000),
  }));
  const rtkBytes = scale(212_000);
  const headroomBefore = scale(1_480_000);
  const headroomAfter = Math.round(headroomBefore * 0.71);
  return {
    period,
    requestsObserved: scale(118),
    rtk: { bytesSaved: rtkBytes, requestsWithHits: scale(71), hits: scale(236) },
    headroom: {
      tokensSaved: scale(61_400),
      compressed: scale(58),
      skipped: scale(16),
      phantomSavings: Math.round(days / 3),
      bodyBytesBefore: headroomBefore,
      bodyBytesAfter: headroomAfter,
      skipReasons: { disabled: scale(4), "unsupported request": scale(3), "unsafe input": scale(2), "below threshold": scale(6) },
    },
    pxpipe: { tokensSavedEst: scale(24_800), applied: scale(9), imageCount: scale(27) },
    totals: { actualBytesSaved: rtkBytes + (headroomBefore - headroomAfter) },
    dailyPoints,
  };
}
