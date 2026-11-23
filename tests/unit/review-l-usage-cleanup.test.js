import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { calculateCostBreakdown, getPricingForModel } from "open-sse/providers/pricing.js";
import { mediaAccounting } from "open-sse/handlers/mediaAccounting.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";
let dir, oldDataDir, repo, db;
beforeEach(async () => {
  oldDataDir = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-cleanup-"));
  process.env.DATA_DIR = dir; delete global._dbAdapter; vi.resetModules();
  await import("@/lib/db/index.js");
  repo = await import("@/lib/db/repos/usageRepo.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
});
afterEach(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter; delete global._statsEmitTimers;
  if (oldDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDataDir;
  await disposeLoadedRequestDetailsRepo(); fs.rmSync(dir, { recursive: true, force: true });
});
it("rejects malformed receipts while retaining valid zero and ticks", () => {
  const rates = { input: 1, output: 0 };
  for (const value of [true, "0.5", [], {}, -1]) {
    expect(calculateCostBreakdown({ prompt_tokens: 1000000, cost_usd: value }, rates).totalCost).toBe(1);
    expect(mediaAccounting({ usage: { cost_usd: value } }, "openai", "image").cost).toBeNull();
  }
  expect(calculateCostBreakdown({ cost_in_usd_ticks: 5000000000 }, rates).totalCost).toBe(0.5);
  expect(mediaAccounting({ usage: { cost_usd: 0 } }, "openai", "image").cost).toBe(0);
});
it("shares builtin lookup with the override-aware resolver", async () => {
  const prices = await import("@/lib/db/repos/pricingRepo.js");
  const builtin = getPricingForModel("openai", "gpt-5.4");
  expect((await prices.resolvePricingForModel("openai", "gpt-5.4")).pricing).toEqual(builtin);
  await prices.updatePricing({ openai: { "gpt-5.4": { input: 99 } } });
  expect((await prices.resolvePricingForModel("openai", "gpt-5.4")).pricing.input).toBe(99);
  expect(getPricingForModel("openai", "gpt-5.4")).toEqual(builtin);
});
it("reports the stored counter and retains distinct identical recent events", async () => {
  const entry = { timestamp: new Date().toISOString(), provider: "openai", model: "gpt-5.4", tokens: { prompt_tokens: 2, completion_tokens: 3 } };
  await repo.saveRequestUsage({ ...entry, usageEventId: "one" });
  await repo.saveRequestUsage({ ...entry, usageEventId: "two" });
  await repo.saveRequestUsage({ ...entry, usageEventId: "one" });
  const stats = await repo.getUsageStats();
  expect(stats.totalRequestsLifetime).toBe(Number(db.get("SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'").value));
  expect(stats.recentRequests).toHaveLength(2);
  expect((await repo.getActiveRequests()).recentRequests).toHaveLength(2);
});
it("documents retention data and boundary rebuilds", () => {
  const docs = fs.readFileSync(new URL("../../docs/guides/usage-and-quota.mdx", import.meta.url), "utf8");
  for (const phrase of ["usageLastSeen", "usageDaily", "token-saver", "boundary day"]) expect(docs).toContain(phrase);
});
