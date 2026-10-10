import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #1085 acceptance (rerank, previously unselected): the real handler, real
// policy enforcer and real isolated SQLite. Only credentials and the provider
// core (synthetic receipts, no network) are replaced.

const mocks = vi.hoisted(() => ({ core: vi.fn(), credentials: vi.fn(), unavailable: vi.fn(), http: vi.fn() }));
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
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.http }));

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
  originalEnv = Object.fromEntries(["HOME", "DATA_DIR", "TMPDIR", "TMP", "TEMP", "DURINDOOR_DATABASE_ENGINE"].map((name) => [name, process.env[name]]));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "rerank-budget-"));
  for (const name of ["home", "data", "tmp"]) fs.mkdirSync(path.join(directory, name));
  process.env.HOME = path.join(directory, "home");
  process.env.DATA_DIR = path.join(directory, "data");
  for (const name of ["TMPDIR", "TMP", "TEMP"]) process.env[name] = path.join(directory, "tmp");
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  vi.doMock("open-sse/handlers/rerankCore.js", () => ({ handleRerankCore: mocks.core }));
  vi.doMock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: false }) }));
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

// #1085 composition: only credential/model discovery and external HTTP are
// synthetic. These cases load the real core, executor, accounting and SQLite
// policy path; the earlier manufactured core receipts remain unchanged.
describe("rerank raw provider receipt through real core and SQLite policy", () => {
  const model = "openrouter/cohere/rerank-4-pro";
  const send = (id) => new Request("http://localhost/v1/rerank", {
    method: "POST",
    headers: { "x-request-id": id },
    body: JSON.stringify({ ...body, model }),
  });
  const ranking = (usage) => JSON.stringify({
    id: "synthetic-rerank",
    results: [{ index: 1, relevance_score: 0.875, document: { text: "b" } }, { index: 0, relevance_score: 0.125, document: { text: "a" } }],
    ...(usage === undefined ? {} : { usage }),
  });
  const reply = (text, status = 200) => mocks.http.mockResolvedValueOnce(new Response(text, {
    status, headers: { "content-type": "application/json" },
  }));
  const reopen = async () => {
    await global._dbAdapter.instance.close();
    delete global._dbAdapter;
    delete global._apiKeyLimitState;
    vi.resetModules();
    adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    database = await import("@/lib/db/index.js");
    ({ handleRerank } = await import("@/sse/handlers/rerank.js"));
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
    vi.doUnmock("open-sse/handlers/rerankCore.js");
    vi.doUnmock("open-sse/executors/index.js");
    vi.resetModules();
    ({ handleRerank } = await import("@/sse/handlers/rerank.js"));
    database = await import("@/lib/db/index.js");
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    ["cost_usd", 0.5],
    ["cost_in_usd_ticks", 500_000_000_000],
  ])("commits raw %s once and denies the next request before HTTP", async (field, value) => {
    const usage = { [field]: value, input_tokens: 7, total_tokens: 7 };
    const text = ranking(usage);
    reply(text);
    const response = await handleRerank(send(`paid-${field}`));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(text);
    expect(mocks.http).toHaveBeenCalledTimes(1);
    const [url, options] = mocks.http.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/rerank");
    expect(JSON.parse(options.body)).toEqual({ ...body, model: "cohere/rerank-4-pro" });
    await reopen();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ apiKey: "rerank-secret", provider: "openrouter", model: "cohere/rerank-4-pro", connectionId: "account-r", endpoint: "/v1/rerank", status: "ok", cost: 0.5, promptTokens: 7 });
    const totals = await database.getApiKeyUsageTotals("rerank-key");
    expect(totals).toMatchObject({ totalRequests: 1, totalCost: 0.5, unknownCostRequests: 0 });
    const denied = await handleRerank(send(`denied-${field}`));
    expect(denied.status).toBe(429);
    expect(mocks.http).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(1);
    expect(await database.getApiKeyUsageTotals("rerank-key")).toEqual(totals);
    expect(JSON.parse(rows()[0].meta)).toMatchObject({
      modality: "rerank", costStatus: "known", costSource: "provider",
      providerUsage: { path: "usage", value: usage }, providerCost: { path: `usage.${field}`, value },
    });
  });

  it("preserves unknown versus explicit zero and excludes failed requests from allowance", async () => {
    adapter.run("UPDATE apiKeys SET policy = ? WHERE id = ?", [JSON.stringify({ maxCostUsd: 0.5, monthlyRequestLimit: 3 }), "rerank-key"]);
    reply(JSON.stringify({ error: { message: "synthetic upstream rejection" } }), 503);
    expect((await handleRerank(send("failed"))).status).toBe(503);
    expect(rows()).toEqual([]);
    expect(await database.getApiKeyUsageTotals("rerank-key")).toMatchObject({ totalRequests: 0, totalCost: 0 });
    const usages = [undefined, { cost_usd: "invalid", input_tokens: 7 }, { cost_usd: 0, input_tokens: 7 }];
    for (const [index, usage] of usages.entries()) {
      const text = ranking(usage);
      reply(text);
      const response = await handleRerank(send(`unknown-zero-${index}`));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(text);
    }
    await reopen();
    const records = rows();
    expect(records).toHaveLength(3);
    expect(records.map((row) => row.cost)).toEqual([null, null, 0]);
    expect(records.map((row) => JSON.parse(row.meta).costStatus)).toEqual(["unknown", "unknown", "known"]);
    expect(JSON.parse(records[0].meta).providerUsage).toBeUndefined();
    expect(JSON.parse(records[1].meta)).toMatchObject({ providerUsage: { path: "usage", value: usages[1] }, providerCost: { path: "usage.cost_usd", value: "invalid" } });
    expect(JSON.parse(records[2].meta)).toMatchObject({ providerUsage: { path: "usage", value: usages[2] }, costSource: "provider" });
    expect(await database.getApiKeyUsageTotals("rerank-key")).toMatchObject({ totalRequests: 3, totalCost: 0, unknownCostRequests: 2 });
    expect((await handleRerank(send("request-allowance-denied"))).status).toBe(429);
    expect(mocks.http).toHaveBeenCalledTimes(4);
    expect(rows()).toHaveLength(3);
  });
});
