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
