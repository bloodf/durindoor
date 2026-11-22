// Port of decolua/9router #1900: usage stats expose an overall cache-hit ratio
// (cached tokens / prompt tokens), shown as a hint on the Cached tokens card.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-cache-hit-1900-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
}, 120_000);

afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("usage cacheHitRatio (#1900)", () => {
  it("is zero with no usage", async () => {
    const stats = await db.getUsageStats("24h");
    expect(stats.cacheHitRatio).toBe(0);
  });

  it("is cached tokens divided by prompt tokens", async () => {
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      connectionId: "c-hit",
      tokens: { prompt_tokens: 1000, completion_tokens: 100, cached_tokens: 250 },
      endpoint: "/v1/chat/completions",
      status: "ok",
    });
    const stats = await db.getUsageStats("24h");
    expect(stats.cacheHitRatio).toBeCloseTo(0.25, 6);
  });
});
