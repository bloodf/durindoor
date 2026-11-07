import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

// #1085: the ledger rejects a total that differs from input + output. A provider
// reporting such a total on chat must keep its usage row, without double counting.
const writes = vi.hoisted(() => []);
vi.mock("@/lib/usageDb.js", async () => {
  const database = await import("@/lib/db/index.js");
  return {
    ...database,
    appendRequestLog: vi.fn(async () => {}),
    saveRequestDetail: vi.fn(async () => {}),
    saveRequestUsage(entry) {
      const write = database.saveRequestUsage(entry);
      writes.push(write);
      return write;
    },
  };
});

const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let directory; let originalEnv; let listeners; let adapter; let saveUsageStats;
const save = async (tokens, provider = "fixture", model = "fixture-model") => {
  saveUsageStats({ provider, model, tokens, apiKey: null, endpoint: "/v1/chat/completions", silent: true });
  await Promise.all(writes.splice(0));
  return adapter.all("SELECT * FROM usageHistory ORDER BY id").at(-1);
};

// Warm the chat usage and DB graph once so beforeEach keeps the default hook timeout.
beforeAll(async () => {
  const before = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  const env = Object.fromEntries(["DATA_DIR", "DURINDOOR_DATABASE_ENGINE"].map((name) => [name, process.env[name]]));
  const warm = fs.mkdtempSync(path.join(os.tmpdir(), "chat-usage-total-warm-"));
  process.env.DATA_DIR = warm;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  try {
    await import("../../open-sse/handlers/chatCore/requestDetail.js");
    await import("@/lib/db/repos/pricingRepo.js");
  } finally {
    await global._dbAdapter?.instance?.close?.();
    delete global._dbAdapter;
    for (const signal of signals) for (const listener of process.listeners(signal)) if (!before.get(signal).has(listener)) process.removeListener(signal, listener);
    for (const [name, value] of Object.entries(env)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    fs.rmSync(warm, { recursive: true, force: true });
  }
}, 60_000);

beforeEach(async () => {
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  originalEnv = Object.fromEntries(["HOME", "DATA_DIR", "DURINDOOR_DATABASE_ENGINE"].map((name) => [name, process.env[name]]));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "chat-usage-total-"));
  process.env.HOME = directory;
  process.env.DATA_DIR = path.join(directory, "data");
  fs.mkdirSync(process.env.DATA_DIR);
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  ({ saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  for (const signal of signals) for (const listener of process.listeners(signal)) if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
  for (const [name, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  fs.rmSync(directory, { recursive: true, force: true });
});

it("folds reasoning reported outside completion into output exactly once", async () => {
  const row = await save({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 170, reasoning_tokens: 20, prompt_tokens_details: { cached_tokens: 30 } });
  expect(row).toMatchObject({ promptTokens: 100, completionTokens: 70, reasoningTokens: 20, cachedTokens: 30 });
  expect(JSON.parse(row.tokens)).toMatchObject({ total_tokens: 170 });
  expect(JSON.parse(row.meta).reportedTotalTokens).toBe(170);
});

it("prices a Gemini thinking total once: candidates at output, thoughts at the reasoning rate", async () => {
  const { extractUsage } = await import("../../open-sse/utils/usageTracking.js");
  const { resolvePricingForModel } = await import("@/lib/db/repos/pricingRepo.js");
  const { calculateCostBreakdown } = await import("../../open-sse/providers/pricing.js");
  const usage = extractUsage({ usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 400, thoughtsTokenCount: 600, totalTokenCount: 2000 } });
  expect(usage).toMatchObject({ prompt_tokens: 1000, completion_tokens: 400, total_tokens: 2000, reasoning_tokens: 600 });
  const row = await save(usage, "gemini", "gemini-2.5-pro");
  expect(row).toMatchObject({ promptTokens: 1000, completionTokens: 1000, reasoningTokens: 600 });
  const { pricing } = await resolvePricingForModel("gemini", "gemini-2.5-pro");
  const reasoningRate = pricing.reasoning ?? pricing.output;
  const expected = (1000 * pricing.input + 400 * pricing.output + 600 * reasoningRate) / 1e6;
  expect(row.cost).toBeCloseTo(expected, 12);
  expect(row.cost).toBeCloseTo(calculateCostBreakdown({ prompt_tokens: 1000, completion_tokens: 1000, reasoning_tokens: 600 }, pricing).totalCost, 12);
});

it("keeps components when the reported total is below their sum, with a warning", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const row = await save({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 120 });
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("below input + output"));
  expect(row).toMatchObject({ promptTokens: 100, completionTokens: 50 });
  expect(JSON.parse(row.tokens)).toMatchObject({ total_tokens: 150 });
  expect(JSON.parse(row.meta).reportedTotalTokens).toBe(120);
});

it("records a total-only report instead of dropping the request", async () => {
  const row = await save({ total_tokens: 5 });
  expect(row).toMatchObject({ promptTokens: 0, completionTokens: 5 });
});

it("leaves consistent usage unmodified", async () => {
  const row = await save({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, reasoning_tokens: 20 });
  expect(row).toMatchObject({ promptTokens: 100, completionTokens: 50, reasoningTokens: 20 });
  expect(JSON.parse(row.meta).reportedTotalTokens).toBeUndefined();
});

it("keeps the chat row when a stored native tariff is invalid", async () => {
  adapter.run("INSERT INTO kv(scope, key, value) VALUES('pricing', 'fixture', ?)", [JSON.stringify({ "fixture-model": { input: 1, output: 1, native: { unit: "bogus", rate: 1 } } })]);
  const row = await save({ prompt_tokens: 1_000_000, completion_tokens: 0 });
  expect(row).toBeDefined();
  expect(JSON.parse(row.meta)).toMatchObject({ modality: "chat" });
});

it("records chat as an explicit modality, without native units or a native tariff", async () => {
  const { updatePricing } = await import("@/lib/db/repos/pricingRepo.js");
  await updatePricing({ fixture: { "fixture-model": { input: 1, output: 1, native: { unit: "image", rate: 5 } } } });
  const row = await save({ prompt_tokens: 1_000_000, completion_tokens: 0 });
  expect(row.cost).toBe(1);
  const meta = JSON.parse(row.meta);
  expect(meta).toMatchObject({ modality: "chat", costStatus: "estimated", costSource: "pricing" });
  expect(meta.nativeUnits).toBeUndefined();
});
