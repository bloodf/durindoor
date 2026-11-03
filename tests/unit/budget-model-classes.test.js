import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #1085: pins the documented dollar-budget behavior per model class and price override.
vi.mock("@/sse/services/auth.js", () => ({ hasValidCliToken: async () => false, extractApiKey: () => "class-secret" }));

const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let directory; let originalEnv; let listeners; let database; let adapter; let enforce; let updatePricing;
const save = (provider, model, extra = {}) => database.saveRequestUsage({
  provider, model, apiKey: "class-secret", strict: true,
  tokens: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }, ...extra,
});
const decision = () => enforce(new Request("http://localhost/v1/chat/completions", { method: "POST" }), "any/model", "class-secret");
const totals = () => database.getApiKeyUsageTotals("class-key");

beforeEach(async () => {
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  originalEnv = Object.fromEntries(["HOME", "DATA_DIR", "DURINDOOR_DATABASE_ENGINE"].map((name) => [name, process.env[name]]));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "budget-classes-"));
  process.env.HOME = directory;
  process.env.DATA_DIR = path.join(directory, "data");
  fs.mkdirSync(process.env.DATA_DIR);
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
  database = await import("@/lib/db/index.js");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, policy, createdAt) VALUES(?, ?, ?, 1, '[]', ?, ?)",
    ["class-key", "class-secret", "Budget classes", JSON.stringify({ maxCostUsd: 1 }), new Date().toISOString()]);
  ({ enforceApiKeyModelPolicy: enforce } = await import("@/sse/services/apiKeyPolicy.js"));
  ({ updatePricing } = await import("@/lib/db/repos/pricingRepo.js"));
});
afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  for (const signal of signals) for (const listener of process.listeners(signal)) if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
  for (const [name, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("lifetime dollar budget by model class", () => {
  it("unpriced: counts as unknown, spends nothing, does not deny", async () => {
    await save("no-such-provider", "no-such-model");
    expect(await totals()).toMatchObject({ totalCost: 0, unknownCostRequests: 1, totalRequests: 1 });
    expect(await decision()).toBeNull();
  });

  it("builtin free: an estimated zero, not unknown, does not deny", async () => {
    await save("glm", "glm-4.7-flash");
    expect(await totals()).toMatchObject({ totalCost: 0, unknownCostRequests: 0 });
    expect(await decision()).toBeNull();
  });

  it("subscription: spends its token-value estimate and denies", async () => {
    await save("codex", "gpt-5.6-sol");
    expect((await totals()).totalCost).toBeGreaterThan(1);
    expect((await decision()).status).toBe(429);
  });

  it("zero override makes a subscription model spend nothing", async () => {
    await updatePricing({ codex: { "gpt-5.6-sol": { input: 0, output: 0, cached: 0, reasoning: 0, cache_creation: 0 } } });
    await save("codex", "gpt-5.6-sol");
    expect(await totals()).toMatchObject({ totalCost: 0, unknownCostRequests: 0 });
    expect(await decision()).toBeNull();
  });

  it("price override makes an unpriced model spend and deny", async () => {
    await updatePricing({ "no-such-provider": { "no-such-model": { input: 2, output: 2 } } });
    await save("no-such-provider", "no-such-model");
    expect(await totals()).toMatchObject({ totalCost: 4, unknownCostRequests: 0 });
    expect((await decision()).status).toBe(429);
  });

  it("provider receipt outranks a price override", async () => {
    await updatePricing({ codex: { "gpt-5.6-sol": { input: 100, output: 100 } } });
    await save("codex", "gpt-5.6-sol", { tokens: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, cost_usd: 0.25 } });
    expect((await totals()).totalCost).toBe(0.25);
    expect(await decision()).toBeNull();
  });
});
