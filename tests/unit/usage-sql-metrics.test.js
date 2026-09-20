import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aggregateTokenSaverEvents } from "../../open-sse/rtk/index.js";
import migration from "../../src/lib/db/migrations/020-token-saver-aggregates.js";
import { backfillTokenSaverDaily } from "../../src/lib/db/migrations/token-saver-daily-schema.js";

const now = new Date(2026, 6, 14, 12);
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
let dir, oldDataDir, repo, db;
beforeEach(async () => {
  oldDataDir = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-sql-metrics-"));
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;
  vi.resetModules();
  await import("@/lib/db/index.js");
  repo = await import("@/lib/db/repos/usageRepo.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
});
afterEach(() => {
  vi.useRealTimers();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete global._statsEmitTimers;
  if (oldDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = oldDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

function expectedStats(fixtures, period) {
  const cutoff = new Date(now);
  if (period === "24h") cutoff.setTime(now.getTime() - 86400000);
  else { cutoff.setHours(0, 0, 0, 0); if (period !== "today") cutoff.setDate(cutoff.getDate() - parseInt(period, 10) + 1); }
  const selected = fixtures.filter(({ at }) => at <= now && (period === "all" || at >= cutoff));
  const result = aggregateTokenSaverEvents(selected.map(({ event }) => event));
  const observed = new Map();
  for (const { at, event } of selected) {
    const key = dateKey(at);
    if (!observed.has(key)) observed.set(key, []);
    observed.get(key).push(event);
  }
  const days = period === "all" ? [...observed.keys()].sort() : [];
  if (period !== "all") {
    const d = new Date(cutoff); d.setHours(0, 0, 0, 0);
    for (; d <= now; d.setDate(d.getDate() + 1)) days.push(dateKey(d));
  }
  result.dailyPoints = days.map((key) => {
    const day = aggregateTokenSaverEvents(observed.get(key) || []);
    return { dateKey: key, actualBytesSaved: day.totals.actualBytesSaved, rtkBytesSaved: day.rtk.bytesSaved,
      headroomBodyShrink: Math.max(0, day.headroom.bodyBytesBefore - day.headroom.bodyBytesAfter),
      headroomTokensSaved: day.headroom.tokensSaved, requestsObserved: day.requestsObserved };
  });
  return result;
}

const events = [
  {},
  { rtk: { requestsWithHits: "2", hits: "4", bytesBefore: "900", bytesAfter: 600, bytesSaved: "300" }, headroom: { state: "compressed", tokensBefore: 100, tokensAfter: 40, tokensSaved: 60, bodyBytesBefore: 900, bodyBytesAfter: 300, phantomSavings: true }, pxpipe: { applied: true, tokensBeforeEst: 400, tokensAfterEst: 200, tokensSavedEst: 200, imageCount: "3" } },
  { rtk: { hits: true, bytesBefore: -100, bytesAfter: false, bytesSaved: "not-a-number" }, headroom: { state: "skipped", tokensSaved: 500, diagnostic: "timeout" } },
  { headroom: { state: "skipped", diagnostic: "https://secret.invalid", bodyBytesBefore: 900, bodyBytesAfter: 0, phantomSavings: true }, pxpipe: { applied: false, imageCount: -5 } },
  { headroom: { state: "skipped" } },
  { headroom: { state: "compressed", bodyBytesBefore: 100, bodyBytesAfter: 700, tokensSaved: "13" }, rtk: { bytesSaved: 60526220870 } },
  { headroom: { state: "invalid", tokensSaved: 100 }, pxpipe: { applied: "yes", tokensSavedEst: "11" } },
];

describe("portable SQL usage metrics", { timeout: 20000 }, () => {
  it("equals the canonical JS fold including calendar boundaries and daily zero filling", async () => {
    const fixtures = [];
    for (const at of [new Date(2026, 5, 1), new Date(2026, 6, 8), new Date(2026, 6, 13, 11), new Date(2026, 6, 13, 12), now, new Date(now.getTime() + 1)]) {
      for (const event of events) { fixtures.push({ at, event }); await repo.recordTokenSaverEvent(event, at); }
    }
    for (const period of ["today", "24h", "7d", "30d", "all"]) {
      expect(await repo.getTokenSaverStats(period, now), period).toEqual(expectedStats(fixtures, period));
    }
    await repo.resetUsageHistory("all");
    for (const period of ["today", "24h", "7d", "all"]) expect(await repo.getTokenSaverStats(period, now)).toEqual(expectedStats([], period));
  });

  it("preserves positive fractional metrics instead of truncating them", async () => {
    const fixtures = [0.1, 0.2, 0.3].map((n) => ({ at: now, event: { rtk: { hits: n, bytesSaved: n }, headroom: { state: "compressed", tokensSaved: n }, pxpipe: { imageCount: n } } }));
    for (const { event, at } of fixtures) await repo.recordTokenSaverEvent(event, at);
    const actual = await repo.getTokenSaverStats("today", now);
    const expected = expectedStats(fixtures, "today");
    const compare = (a, b) => {
      if (typeof b === "number") expect(Math.abs(a - b)).toBeLessThanOrEqual(Number.EPSILON * Math.max(1, Math.abs(b)) * 4);
      else if (b && typeof b === "object") { expect(Object.keys(a)).toEqual(Object.keys(b)); for (const key of Object.keys(b)) compare(a[key], b[key]); }
      else expect(a).toEqual(b);
    };
    compare(actual, expected);
  });

  it("backfills more than one batch idempotently without changing raw JSON", async () => {
    const fixtures = Array.from({ length: 503 }, (_, i) => ({ at: now, event: events[i % events.length] }));
    db.exec("DROP TABLE tokenSaverEvents");
    db.exec("CREATE TABLE tokenSaverEvents(id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, dateKey TEXT NOT NULL, data TEXT NOT NULL)");
    for (const { at, event } of fixtures) db.run("INSERT INTO tokenSaverEvents(timestamp, dateKey, data) VALUES (?, ?, ?)", [at.toISOString(), dateKey(at), JSON.stringify(event)]);
    migration.up(db);
    migration.up(db);
    backfillTokenSaverDaily(db);
    expect(await repo.getTokenSaverStats("all", now)).toEqual(expectedStats(fixtures, "all"));
    expect(db.all("SELECT data FROM tokenSaverEvents ORDER BY id").map((r) => r.data)).toEqual(fixtures.map(({ event }) => JSON.stringify(event)));
  });

  it("matches four independent lastUsed GROUP BY views across all dimensions", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    for (const key of ["key-a", "key-b"]) db.run("INSERT INTO apiKeys(id, key, name, createdAt) VALUES (?, ?, ?, ?)", [key, key, key, now.toISOString()]);
    for (const [i, connectionId, apiKey, endpoint] of [
      [0, "account-one", "key-a", "/chat"], [1, "account-two", "key-b", "/responses"],
      [2, "account-one", "key-b", "/chat"], [3, null, "key-a", "/responses"],
      [4, "account-two", "key-a", "/chat"], [5, "account-one", "key-a", "/chat"],
    ]) {
      await repo.saveRequestUsage({ timestamp: new Date(now.getTime() - (6 - i) * 3600000).toISOString(), provider: "openai", model: "model", connectionId, apiKey, endpoint, tokens: { prompt_tokens: 1 }, status: "ok" });
    }
    // Future data must never win the overlay.
    await repo.saveRequestUsage({ timestamp: new Date(now.getTime() + 3600000).toISOString(), provider: "openai", model: "model", connectionId: "account-one", apiKey: "key-a", endpoint: "/chat", tokens: { prompt_tokens: 1 } });
    for (const period of ["7d", "all"]) {
      const stats = await repo.getUsageStats(period);
      for (const [group, dimension, field] of [["byModel", null, null], ["byAccount", "connectionId", "connectionId"], ["byApiKey", "apiKey", "keyName"], ["byEndpoint", "endpoint", "endpoint"]]) {
        const dims = ["provider", "model", ...(dimension ? [dimension] : [])];
        const oracle = db.all(`SELECT ${dims.join(", ")}, MAX(timestamp) AS timestamp FROM usageHistory WHERE timestamp <= ? GROUP BY ${dims.join(", ")}`, [now.toISOString()]);
        for (const entry of Object.values(stats[group])) {
          const row = oracle.find((r) => r.provider === entry.rawProvider && r.model === entry.rawModel && (!dimension || r[dimension] === entry[field]));
          expect(entry.lastUsed).toBe(row.timestamp);
        }
      }
    }
  });
});
