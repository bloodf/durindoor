import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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
const save = async (tokens) => {
  saveUsageStats({ provider: "xai", model: "grok-4", tokens, apiKey: null, endpoint: "/v1/chat/completions", silent: true });
  await Promise.all(writes.splice(0));
  return adapter.all("SELECT * FROM usageHistory ORDER BY id").at(-1);
};

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

it("keeps components when the reported total is below their sum", async () => {
  const row = await save({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 120 });
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
