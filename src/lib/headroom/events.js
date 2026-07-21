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

// Cumulative totals stored so log rotation never loses the All-time view.
// When the active log exceeds MAX_FILE_BYTES it is renamed to events.jsonl.1;
// the previous events.jsonl.1 (already summarized) is replaced. The metadata
// file holds the folded all-time totals so they survive beyond the single
// rotated segment kept on disk.
const ROTATION_METADATA_FILE = path.join(HEADROOM_DIR, "events-meta.json");

function readJsonSync(file, defaultValue = {}) {
  try {
    const text = fs.readFileSync(file, "utf8");
    return JSON.parse(text);
  } catch {
    return defaultValue;
  }
}

function emptyMetaTotals() {
  return {
    requests: 0, compressed: 0, bypassed: 0, errors: 0,
    tokensBefore: 0, tokensAfter: 0, tokensSaved: 0,
    compressionTimeMs: 0,
  };
}

function metaTotalsFromEvents(events) {
  const totals = emptyMetaTotals();
  for (const ev of events) accumulate(totals, ev);
  return totals;
}

function mergeMetaTotals(target, source) {
  for (const k of Object.keys(emptyMetaTotals())) {
    target[k] = (target[k] || 0) + (source[k] || 0);
  }
  return target;
}

function loadMeta() {
  const meta = readJsonSync(ROTATION_METADATA_FILE, { all: emptyMetaTotals(), lastFoldedIno: 0 });
  if (!meta.all) meta.all = emptyMetaTotals();
  if (!meta.lastFoldedIno) meta.lastFoldedIno = 0;
  return meta;
}

function saveMeta(meta) {
  const tmp = `${ROTATION_METADATA_FILE}.tmp.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(meta), { flush: true });
    fs.renameSync(tmp, ROTATION_METADATA_FILE);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    return false;
  }
}

function statIno(file) {
  try {
    return fs.statSync(file).ino;
  } catch {
    return 0;
  }
}

function rotateIfNeeded() {
  ensureDir();
  try {
    const stat = fs.statSync(EVENTS_FILE);
    if (stat.size <= MAX_FILE_BYTES) return;
  } catch {
    return;
  }

  const meta = loadMeta();
  const rotatedIno = statIno(ROTATED_FILE);

  // Fold the existing rotated file into metadata only once. The ino stored in
  // metadata prevents double-counting if a previous unlink/rename failed partway.
  if (rotatedIno && rotatedIno !== meta.lastFoldedIno) {
    let rotated;
    try {
      rotated = fs.readFileSync(ROTATED_FILE, "utf8");
    } catch {
      // Cannot safely read the file we are about to delete; abort and preserve it.
      return;
    }

    const parsed = [];
    for (const line of rotated.split("\n")) {
      if (!line) continue;
      try {
        const ev = JSON.parse(line);
        if (!Number.isFinite(ev.ts)) continue;
        parsed.push(ev);
      } catch { /* skip corrupt line */ }
    }
    mergeMetaTotals(meta.all, metaTotalsFromEvents(parsed));
    meta.lastFoldedIno = rotatedIno;
  }

  // Persist before renaming anything; if the metadata write fails, keep the
  // original files so the all-time totals are not lost.
  if (!saveMeta(meta)) return;

  // Rename active to rotated; discard the already-summarized rotated segment.
  if (fs.existsSync(ROTATED_FILE)) {
    try {
      fs.unlinkSync(ROTATED_FILE);
    } catch {
      // If we cannot remove the old rotated file, keep the oversized active file
      // rather than losing it. The next append will retry.
      return;
    }
  }
  fs.renameSync(EVENTS_FILE, ROTATED_FILE);
}

// Fire-and-forget: stats must never break the request path.
export function appendHeadroomEvent(event) {
  try {
    rotateIfNeeded();
    fs.appendFile(EVENTS_FILE, JSON.stringify({ ts: Date.now(), ...event }) + "\n", () => {});
  } catch { /* ignore */ }
}

export function readHeadroomEvents({ sinceMs = null, limit = null } = {}) {
  const meta = loadMeta();
  const events = [];
  for (const file of [ROTATED_FILE, EVENTS_FILE]) {
    try {
      if (!fs.existsSync(file)) continue;
      // Skip the rotated file if it has already been folded into metadata.
      if (file === ROTATED_FILE && fs.statSync(file).ino === meta.lastFoldedIno) continue;
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

function mergeTotals(target, source) {
  target.requests += source.requests || 0;
  target.compressed += source.compressed || 0;
  target.bypassed += source.bypassed || 0;
  target.errors += source.errors || 0;
  target.tokensBefore += source.tokensBefore || 0;
  target.tokensAfter += source.tokensAfter || 0;
  target.tokensSaved += source.tokensSaved || 0;
  target.compressionTimeMs += source.compressionTimeMs || 0;
  return target;
}

function isErrorReason(reason) {
  if (!reason) return false;
  return [
    "request_failed:", "request-failed", "transform_error", "timeout", "unexpected_error:",
    "proxy_returned_HTTP_", "proxy_response_missing_", "proxy_response_did_not_", "proxy_response_has_",
    "http-error", "translation-failed", "invalid-proxy-response", "unexpected-error",
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
  const meta = loadMeta();
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
    // Padded no-event day: tokensSaved is null until an event confirms it.
    timeline.set(key, { date: key, tokensSaved: null, compressed: 0, requests: 0 });
  }

  // Fold persisted all-time totals so rotated-out history still counts.
  mergeTotals(windows.all, meta.all);

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
      // Any observed event for the day confirms a real measurement
      // (applied:true contributes tokens; applied:false is a confirmed zero).
      if (bucket.tokensSaved === null) bucket.tokensSaved = 0;
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

