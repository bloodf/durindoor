import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const now = new Date("2026-07-10T07:30:00.000Z");
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
    timestamp: "2026-07-10T07:15:00.000Z",
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
    expect(chart[0].label).toMatch(/^00:00/);
    expect(chart[0].tokens).toBe(15);
  });

  it("ignores an invalid requested timezone", async () => {
    const chart = await db.getChartData("today", "Not/A_Timezone");

    expect(chart).toHaveLength(24);
  });
});
