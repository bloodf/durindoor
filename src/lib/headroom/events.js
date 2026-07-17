import fs from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/dataDir.js";

const HEADROOM_DIR = path.join(DATA_DIR, "headroom");
const EVENTS_FILE = path.join(HEADROOM_DIR, "events.jsonl");
const ROTATED_FILE = path.join(HEADROOM_DIR, "events.jsonl.1");
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

function ensureDir() {
  if (!fs.existsSync(HEADROOM_DIR)) fs.mkdirSync(HEADROOM_DIR, { recursive: true });
}

// Fire-and-forget: stats must never break the request path.
export function appendHeadroomEvent(event) {
  try {
    ensureDir();
    try {
      const stat = fs.statSync(EVENTS_FILE);
      if (stat.size > MAX_FILE_BYTES) fs.renameSync(EVENTS_FILE, ROTATED_FILE);
    } catch { /* no file yet */ }
    fs.appendFile(EVENTS_FILE, JSON.stringify({ ts: Date.now(), ...event }) + "\n", () => {});
  } catch { /* ignore */ }
}

export function readHeadroomEvents({ sinceMs = null, limit = null } = {}) {
  const events = [];
  for (const file of [ROTATED_FILE, EVENTS_FILE]) {
    try {
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          if (!Number.isFinite(ev.ts) || (sinceMs && ev.ts < sinceMs)) continue;
          events.push(ev);
        } catch { /* skip corrupt line */ }
      }
    } catch { /* ignore */ }
  }
  events.sort((a, b) => a.ts - b.ts);
  return limit ? events.slice(-limit) : events;
}

function emptyTotals() {
  return {
    requests: 0, compressed: 0, bypassed: 0, errors: 0,
    tokensBefore: 0, tokensAfter: 0, tokensSaved: 0, savedPct: 0,
    compressionTimeMs: 0, avgCompressionMs: 0,
  };
}

function isErrorReason(reason) {
  if (!reason) return false;
  return [
    "request_failed:", "transform_error", "timeout", "unexpected_error:",
    "proxy_returned_HTTP_", "proxy_response_missing_", "proxy_response_did_not_", "proxy_response_has_",
  ].some((p) => reason.startsWith(p));
}

function accumulate(totals, ev) {
  totals.requests++;
  if (ev.applied) {
    totals.compressed++;
    totals.tokensBefore += ev.tokensBefore || 0;
    totals.tokensAfter += ev.tokensAfter || 0;
    totals.tokensSaved += ev.tokensSaved || 0;
    totals.compressionTimeMs += ev.durationMs || 0;
  } else if (isErrorReason(ev.reason)) {
    totals.errors++;
  } else {
    totals.bypassed++;
  }
}

function finalize(totals) {
  totals.savedPct = totals.tokensBefore > 0
    ? +((totals.tokensSaved / totals.tokensBefore) * 100).toFixed(2)
    : 0;
  totals.avgCompressionMs = totals.compressed > 0
    ? Math.round(totals.compressionTimeMs / totals.compressed)
    : 0;
  return totals;
}

// Aggregated stats for the dashboard: all-time + windowed totals, a daily
// tokens-saved timeline (last `timelineDays`), and the most recent events.
// Saved-token counters are as reported by the Headroom proxy; provider
// billing may differ (see phantom-savings warning in logs).
export function getHeadroomStats({ timelineDays = 30, recentLimit = 100 } = {}) {
  const events = readHeadroomEvents();
  const now = Date.now();
  const nowDate = new Date(now);
  const startOfToday = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());

  const windows = {
    all: emptyTotals(),
    today: emptyTotals(),
    yesterday: emptyTotals(),
    last7d: emptyTotals(),
    last30d: emptyTotals(),
  };

  const dateKey = (ts) => new Date(ts).toISOString().slice(0, 10);
  const timeline = new Map();
  for (let i = timelineDays - 1; i >= 0; i--) {
    const key = dateKey(startOfToday - i * DAY_MS);
    timeline.set(key, { date: key, tokensSaved: 0, compressed: 0, requests: 0 });
  }

  for (const ev of events) {
    accumulate(windows.all, ev);
    if (ev.ts >= startOfToday) accumulate(windows.today, ev);
    else if (ev.ts >= startOfToday - DAY_MS) accumulate(windows.yesterday, ev);
    if (ev.ts >= now - 7 * DAY_MS) accumulate(windows.last7d, ev);
    if (ev.ts >= now - 30 * DAY_MS) accumulate(windows.last30d, ev);

    const key = dateKey(ev.ts);
    const bucket = timeline.get(key);
    if (bucket) {
      bucket.requests++;
      if (ev.applied) {
        bucket.compressed++;
        bucket.tokensSaved += ev.tokensSaved || 0;
      }
    }
  }

  for (const w of Object.values(windows)) finalize(w);

  return {
    windows,
    timeline: [...timeline.values()],
    recent: events.slice(-recentLimit).reverse(),
  };
}
