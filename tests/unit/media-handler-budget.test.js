import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #1085 acceptance (rerank, previously unselected): the real handler, real
// policy enforcer and real isolated SQLite. Only credentials and the provider
// core (synthetic receipts, no network) are replaced.

const mocks = vi.hoisted(() => ({ core: vi.fn(), credentials: vi.fn(), unavailable: vi.fn() }));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: async () => ({ apiKey: "rerank-secret", auth: { ok: true, apiKeyId: "rerank-key" } }),
  hasValidCliToken: async () => false,
  extractApiKey: () => "rerank-secret",
  getProviderCredentialsWithQuotaPreflight: mocks.credentials,
  getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: mocks.unavailable,
  clearAccountError: vi.fn(),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (value) => { const [provider, ...model] = value.split("/"); return { provider, model: model.join("/") }; },
}));
vi.mock("open-sse/handlers/rerankCore.js", () => ({ handleRerankCore: mocks.core }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: false }) }));

const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let directory; let originalEnv; let listeners; let adapter; let handleRerank; let database;
const body = { model: "paid/rank", query: "q", documents: ["a", "b"] };
const request = () => new Request("http://localhost/v1/rerank", { method: "POST", body: JSON.stringify(body) });
const rows = () => adapter.all("SELECT * FROM usageHistory ORDER BY id");
const receipt = (cost) => ({
  state: "complete", tokens: {}, nativeUnits: { operations: 1 }, cost,
  costStatus: cost === null ? "unknown" : "known", costSource: cost === null ? "unavailable" : "provider", meta: {},
});
const success = (cost) => ({ success: true, status: 200, accounting: receipt(cost), response: new Response('{"results":[]}', { status: 200 }) });

beforeEach(async () => {
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  originalEnv = { DATA_DIR: process.env.DATA_DIR, DURINDOOR_DATABASE_ENGINE: process.env.DURINDOOR_DATABASE_ENGINE };
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "rerank-budget-"));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
  vi.clearAllMocks();
  mocks.credentials.mockResolvedValue({ connectionId: "account-r", apiKey: "provider-secret", connectionName: "R" });
  mocks.unavailable.mockResolvedValue({ shouldFallback: false });
  database = await import("@/lib/db/index.js");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, policy, createdAt) VALUES(?, ?, ?, 1, '[]', ?, ?)",
    ["rerank-key", "rerank-secret", "Rerank budget", JSON.stringify({ maxCostUsd: 0.5 }), new Date().toISOString()]);
  ({ handleRerank } = await import("@/sse/handlers/rerank.js"));
});
afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  for (const signal of signals) for (const listener of process.listeners(signal)) if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
  for (const [name, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("rerank handler through the durable ledger to the next policy decision", () => {
  it("persists an attributed paid record, then denies the next request before dispatch", async () => {
    mocks.core.mockResolvedValue(success(0.5));
    const first = await handleRerank(request());
    expect(first.status).toBe(200);
    expect(await first.text()).toBe('{"results":[]}');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ apiKey: "rerank-secret", provider: "paid", model: "rank", connectionId: "account-r", endpoint: "/v1/rerank", cost: 0.5 });
    expect(JSON.parse(rows()[0].meta)).toMatchObject({ modality: "rerank", nativeUnits: { operations: 1 }, costStatus: "known" });
    const denied = await handleRerank(request());
    expect(denied.status).toBe(429);
    expect(mocks.core).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(1);
    expect(await database.getApiKeyUsageTotals("rerank-key")).toMatchObject({ totalRequests: 1, totalCost: 0.5 });
  });

  it("keeps unknown and failed rerank out of spend, so the key stays allowed", async () => {
    mocks.core.mockResolvedValueOnce({ success: false, status: 503, error: "down", response: new Response("down", { status: 503 }) });
    expect((await handleRerank(request())).status).toBe(503);
    expect(rows()).toEqual([]);
    mocks.core.mockResolvedValueOnce(success(null));
    expect((await handleRerank(request())).status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].cost).toBeNull();
    expect(await database.getApiKeyUsageTotals("rerank-key")).toMatchObject({ totalRequests: 1, totalCost: 0, unknownCostRequests: 1 });
    mocks.core.mockResolvedValueOnce(success(0));
    expect((await handleRerank(request())).status).toBe(200);
    expect(rows()).toHaveLength(2);
    expect(rows()[1].cost).toBe(0);
  });
});
