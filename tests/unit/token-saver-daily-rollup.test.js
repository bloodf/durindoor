import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { aggregateTokenSaverEvents } from "../../open-sse/rtk/index.js";
import migration from "../../src/lib/db/migrations/022-token-saver-daily.js";
import { backfillTokenSaverDaily } from "../../src/lib/db/migrations/token-saver-daily-schema.js";
import { getUsageCalendarCutoff, toLocalDateKey, addLocalCalendarDays } from "../../src/lib/usagePeriods.js";

const now = new Date("2026-09-20T12:00:00.000Z");
let oldDataDir, oldTZ, dir, repo, db;
beforeEach(async () => {
  oldDataDir = process.env.DATA_DIR; oldTZ = process.env.TZ;
  process.env.TZ = "America/New_York";
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "token-daily-")); process.env.DATA_DIR = dir;
  delete global._dbAdapter; vi.resetModules();
  await import("@/lib/db/index.js");
  repo = await import("@/lib/db/repos/usageRepo.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
});
afterEach(() => {
  vi.restoreAllMocks();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter; delete global._statsEmitTimers;
  if (oldDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDataDir;
  if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ;
  fs.rmSync(dir, { recursive: true, force: true });
});
const events = [
  { rtk: { hits: 4, requestsWithHits: 2, bytesBefore: 1200, bytesAfter: 300, bytesSaved: 900 }, headroom: { state: "compressed", tokensBefore: 100, tokensAfter: 50, tokensSaved: 50, bodyBytesBefore: 1000, bodyBytesAfter: 200, phantomSavings: true }, pxpipe: { applied: true, tokensBeforeEst: 600, tokensAfterEst: 400, tokensSavedEst: 200, imageCount: 2 } },
  { headroom: { state: "skipped", diagnostic: "timeout" } },
  { headroom: { state: "skipped", diagnostic: "https://private.invalid/secret" }, rtk: { bytesSaved: 60000000000 } },
  {},
];
async function seed() {
  for (const at of ["2026-09-18T04:00:00.000Z", "2026-09-18T03:59:59.999Z", "2026-09-01T10:00:00.000Z", "2026-09-19T12:00:00.000Z", "2026-09-20T04:00:00.000Z", "2026-09-20T11:00:00.000Z", "2026-09-20T18:00:00.000Z"]) {
    for (const event of events) await repo.recordTokenSaverEvent(event, new Date(at));
  }
}
function oracle(period) {
  const today = toLocalDateKey(now);
  const midnight = new Date(now); midnight.setHours(0,0,0,0);
  const cutoff = period === "today" ? midnight.toISOString() : period === "24h" ? new Date(now.getTime()-86400000).toISOString() : null;
  const localCutoff = !["today","24h","all"].includes(period) ? toLocalDateKey(getUsageCalendarCutoff(period, now)) : null;
  const rows = db.all("SELECT timestamp, dateKey, data FROM tokenSaverEvents ORDER BY id").filter(row => row.timestamp <= now.toISOString() && (!cutoff || row.timestamp >= cutoff) && (!localCutoff || row.dateKey >= localCutoff));
  const agg = aggregateTokenSaverEvents(rows.map(row=>JSON.parse(row.data)));
  const byDay = new Map();
  for (const row of rows) { if (!byDay.has(row.dateKey)) byDay.set(row.dateKey,[]); byDay.get(row.dateKey).push(JSON.parse(row.data)); }
  const fillStart = period === "all" ? null : period === "today" ? today : period === "24h" ? toLocalDateKey(addLocalCalendarDays(now,-1)) : localCutoff;
  const keys = fillStart ? [] : [...byDay.keys()].filter(key=>/^\d{4}-\d{2}-\d{2}$/.test(key)).sort();
  if (fillStart) for(let key=fillStart; key<=today; key=toLocalDateKey(addLocalCalendarDays(new Date(`${key}T00:00:00`),1))) keys.push(key);
  agg.dailyPoints = keys.map(dateKey=>{
    const day=aggregateTokenSaverEvents(byDay.get(dateKey)||[]);
    return { dateKey, actualBytesSaved: day.totals.actualBytesSaved, rtkBytesSaved: day.rtk.bytesSaved, headroomBodyShrink: Math.max(0,day.headroom.bodyBytesBefore-day.headroom.bodyBytesAfter), headroomTokensSaved: day.headroom.tokensSaved, requestsObserved: day.requestsObserved };
  });
  return agg;
}

it("matches the canonical fold across periods, out-of-order writes and partial UTC boundary days", async () => {
  await seed();
  for (const period of ["all","7d","30d","today","24h"]) expect(await repo.getTokenSaverStats(period,now),period).toEqual(oracle(period));
  const daily = (await repo.getTokenSaverStats("all",now)).dailyPoints;
  expect(daily.filter(row=>["2026-09-17","2026-09-18"].includes(row.dateKey)).map(({dateKey,requestsObserved})=>({dateKey,requestsObserved}))).toEqual([{dateKey:"2026-09-17",requestsObserved:4},{dateKey:"2026-09-18",requestsObserved:4}]);
});

it("backfills both rollups idempotently and preserves imported local keys", async () => {
  await seed();
  db.run("UPDATE tokenSaverEvents SET dateKey = ? WHERE timestamp = ?", ["2026-09-16","2026-09-18T04:00:00.000Z"]);
  db.exec("DROP TABLE tokenSaverDaily"); db.exec("DROP TABLE tokenSaverDailyReasons");
  migration.up(db); migration.up(db);
  for (const period of ["all","7d","30d","today","24h"]) expect(await repo.getTokenSaverStats(period,now),period).toEqual(oracle(period));
  expect((await repo.getTokenSaverStats("all",now)).dailyPoints.find(row=>row.dateKey==="2026-09-16").requestsObserved).toBe(4);
  db.run("DELETE FROM tokenSaverEvents WHERE timestamp < ?", ["2026-09-17T00:00:00.000Z"]);
  db.transaction(()=>backfillTokenSaverDaily(db));
  expect(await repo.getTokenSaverStats("all",now)).toEqual(oracle("all"));
  db.exec("DROP TABLE tokenSaverEvents"); migration.up(db);
});

it("retention rebuilds the partial UTC day and reset removes both rollups", async () => {
  await seed();
  await repo.pruneUsageOlderThan(Date.parse("2026-09-18T04:00:00.000Z"));
  expect(await repo.getTokenSaverStats("all",now)).toEqual(oracle("all"));
  await repo.resetUsageHistory("all");
  expect(await repo.getTokenSaverStats("all",now)).toEqual(oracle("all"));
  expect(db.get("SELECT COUNT(*) AS count FROM tokenSaverDailyReasons").count).toBe(0);
});
