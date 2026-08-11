import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
// Anchor mid-afternoon in Los Angeles (23:30 UTC → 16:30 LA) so the fixture sits
// well inside the LA calendar day. An anchor just after LA midnight leaves only
// minutes of slack, and any real-clock leakage during the async DB write pushes
// the row outside the queried window — green locally, red on a slower runner.
const now = new Date("2026-07-10T23:30:00.000Z");
let tempDir;
let db;

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-usage-tz-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  // resetModules reloads the db module, but the adapter lives on `global`, so a
  // sibling test file that already opened a database keeps it resident and this
  // file's rows land somewhere else. Mutate the shared object rather than
  // replacing it — the driver captured a reference to it at import time.
  if (!global._dbAdapter) global._dbAdapter = { logged: false };
  global._dbAdapter.instance = null;
  global._dbAdapter.initPromise = null;
  global._dbAdapter.file = null;
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updatePricing({ openai: { "gpt-tz": { input: 1, output: 1 } } });
  await db.saveRequestUsage({
    timestamp: "2026-07-10T23:15:00.000Z",
    provider: "openai",
    model: "gpt-tz",
    connectionId: "tz-test",
    endpoint: "/v1/chat/completions",
    tokens: { prompt_tokens: 10, completion_tokens: 5 },
    status: "ok",
  });
});

afterAll(() => {
  vi.useRealTimers();
  // Release this file's database so a later file opens its own instead of
  // inheriting a handle onto the temp dir removed below.
  if (global._dbAdapter) {
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = null;
    global._dbAdapter.file = null;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("usage chart timezone", () => {
  it("groups today by requested IANA timezone", async () => {
    const chart = await db.getChartData("today", "America/Los_Angeles");

    expect(chart).toHaveLength(24);
    // Node 20 and 24 disagree on how `hour12: false` renders midnight ("24:00"
    // vs "00:00"), so assert the zone abbreviation the label carries instead of
    // the hour text — that is what actually proves the requested timezone was
    // used for bucketing.
    expect(chart[0].label).toMatch(/(PDT|PST)/);
    // 16:15 LA → the 17th hourly bucket of the LA day.
    expect(chart[16].tokens).toBe(15);
    expect(chart.reduce((sum, b) => sum + b.tokens, 0)).toBe(15);
  });

  it("ignores an invalid requested timezone", async () => {
    const chart = await db.getChartData("today", "Not/A_Timezone");

    expect(chart).toHaveLength(24);
  });
});
