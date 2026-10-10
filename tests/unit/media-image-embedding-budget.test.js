import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #1085 acceptance: REAL image and embedding handlers, real policy enforcer and
// real isolated SQLite. Direct, combo, binary and codex-stream image paths each
// commit one attributed record, and the committed spend then denies the next
// request before any provider dispatch. Image providers use the real core over
// a synthetic fetch; the embedding core is replaced by a synthetic receipt.
// Only credentials, model parsing, routing tables and token refresh are mocked.

const state = vi.hoisted(() => ({ combo: null, embedding: vi.fn(), credentials: vi.fn() }));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: async () => ({ apiKey: "media-secret", auth: { ok: true, apiKeyId: "media-key" } }),
  hasValidCliToken: async () => false,
  extractApiKey: () => "media-secret",
  getProviderCredentialsWithQuotaPreflight: (...args) => state.credentials(...args),
  getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (value) => { const [provider, ...model] = value.split("/"); return { provider, model: model.join("/") }; },
  getComboModels: async () => state.combo,
  getComboCanonicalName: async () => (state.combo ? "image-combo" : null),
}));
vi.mock("@/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: (model) => !model, resolveMediaRoute: vi.fn(), defaultRouteComboOptions: () => ({}),
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_p, c) => c, updateProviderCredentials: vi.fn() }));
vi.mock("open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: async () => ({ allowedConnectionIds: ["account-i"], restrictionApplied: true }) }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: false }) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetch(...args) }));
vi.mock("open-sse/handlers/embeddingsCore.js", () => ({ handleEmbeddingsCore: (...args) => state.embedding(...args) }));

const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let directory; let originalEnv; let listeners; let adapter; let database; let handleImage; let handleEmbeddings;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const imageBody = (extra = {}) => JSON.stringify({ model: "openrouter/img", prompt: "fixture", ...extra });
const imageRequest = (query = "", headers = {}) => new Request(`http://localhost/v1/images/generations${query}`, { method: "POST", headers, body: imageBody() });
const embedRequest = () => new Request("http://localhost/v1/embeddings", { method: "POST", body: JSON.stringify({ model: "paid/embed", input: "hi" }) });
const paidImage = (cost = 0.5) => json({ created: 1, data: [{ b64_json: "aGk=" }], usage: { cost } });
const rows = () => adapter.all("SELECT * FROM usageHistory ORDER BY id");
const meta = (row) => JSON.parse(row.meta);
const event = (type, data) => `event: ${type}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
const item = event("response.output_item.done", { item: { type: "image_generation_call", result: "aGk=" } });
const completed = (cost) => event("response.completed", { response: { status: "completed", usage: { input_tokens: 11, output_tokens: 7, cost_usd: cost } } });

beforeEach(async () => {
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  originalEnv = Object.fromEntries(["HOME", "DATA_DIR", "TMPDIR", "TMP", "TEMP", "DURINDOOR_DATABASE_ENGINE"].map((name) => [name, process.env[name]]));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "image-embedding-budget-"));
  for (const name of ["home", "data", "tmp"]) fs.mkdirSync(path.join(directory, name));
  process.env.HOME = path.join(directory, "home");
  process.env.DATA_DIR = path.join(directory, "data");
  for (const name of ["TMPDIR", "TMP", "TEMP"]) process.env[name] = path.join(directory, "tmp");
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.doMock("open-sse/handlers/embeddingsCore.js", () => ({ handleEmbeddingsCore: (...args) => state.embedding(...args) }));
  vi.doMock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: false }) }));
  vi.resetModules();
  vi.clearAllMocks();
  state.combo = null;
  state.credentials.mockResolvedValue({ connectionId: "account-i", apiKey: "provider-secret", connectionName: "I" });
  vi.stubGlobal("fetch", vi.fn());
  database = await import("@/lib/db/index.js");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, policy, createdAt) VALUES(?, ?, ?, 1, '[]', ?, ?)",
    ["media-key", "media-secret", "Image embedding budget", JSON.stringify({ maxCostUsd: 0.5 }), new Date().toISOString()]);
  ({ handleImageGeneration: handleImage } = await import("@/sse/handlers/imageGeneration.js"));
  ({ handleEmbeddings } = await import("@/sse/handlers/embeddings.js"));
});
afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.unstubAllGlobals();
  for (const signal of signals) for (const listener of process.listeners(signal)) if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
  for (const [name, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  fs.rmSync(directory, { recursive: true, force: true });
});

async function expectDeniedBeforeDispatch(send) {
  fetch.mockClear();
  const denied = await send();
  expect(denied.status).toBe(429);
  expect(fetch).not.toHaveBeenCalled();
  expect(rows()).toHaveLength(1);
  expect(await database.getApiKeyUsageTotals("media-key")).toMatchObject({ totalRequests: 1, totalCost: 0.5 });
}

describe("image handler paths into the dollar budget", () => {
  it("direct: one attributed record, then denial before dispatch", async () => {
    fetch.mockResolvedValueOnce(paidImage());
    const response = await handleImage(imageRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).data[0].b64_json).toBe("aGk=");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ apiKey: "media-secret", provider: "openrouter", model: "img", connectionId: "account-i", endpoint: "/v1/images/generations", cost: 0.5 });
    expect(meta(rows()[0])).toMatchObject({ modality: "image", nativeUnits: { images: 1 }, costStatus: "known", costSource: "provider" });
    await expectDeniedBeforeDispatch(() => handleImage(imageRequest()));
  });

  it("binary: raw bytes are returned and the same record is committed", async () => {
    fetch.mockResolvedValueOnce(paidImage());
    const response = await handleImage(imageRequest("?response_format=binary"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hi");
    expect(rows()).toHaveLength(1);
    expect(meta(rows()[0])).toMatchObject({ modality: "image", nativeUnits: { images: 1 } });
    expect(rows()[0].cost).toBe(0.5);
    await expectDeniedBeforeDispatch(() => handleImage(imageRequest("?response_format=binary")));
  });

  it("combo: failed first member spends nothing; only the winner is attributed", async () => {
    state.combo = ["openrouter/bad", "openrouter/good"];
    fetch.mockResolvedValueOnce(json({ error: { message: "upstream down" } }, 500)).mockResolvedValueOnce(paidImage());
    const response = await handleImage(imageRequest());
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ model: "good", connectionId: "account-i", cost: 0.5 });
    await expectDeniedBeforeDispatch(() => handleImage(imageRequest()));
  });

  it("upstream failure alone never spends or denies", async () => {
    fetch.mockResolvedValue(json({ error: { message: "upstream down" } }, 500));
    expect((await handleImage(imageRequest())).status).toBeGreaterThanOrEqual(500);
    expect(rows()).toEqual([]);
    expect(await database.getApiKeyUsageTotals("media-key")).toMatchObject({ totalRequests: 0, totalCost: 0 });
    fetch.mockImplementation(async () => paidImage(0));
    expect((await handleImage(imageRequest())).status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].cost).toBe(0);
    expect((await handleImage(imageRequest())).status).toBe(200);
    expect(rows()).toHaveLength(2);
  });

  it("codex stream: commits once only after the terminal receipt, then denies", async () => {
    state.credentials.mockResolvedValue({ connectionId: "account-i", apiKey: "provider-secret", accessToken: "tok", connectionName: "I" });
    fetch.mockImplementationOnce(async () => new Response(item + completed(0.5)));
    const streamRequest = () => new Request("http://localhost/v1/images/generations", {
      method: "POST", headers: { accept: "text/event-stream" }, body: imageBody({ model: "codex/gpt-image" }),
    });
    const response = await handleImage(streamRequest());
    expect(rows()).toEqual([]);
    const text = await response.text();
    expect(text).toContain("event: done");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ provider: "codex", connectionId: "account-i", cost: 0.5 });
    expect(meta(rows()[0])).toMatchObject({ modality: "image", costStatus: "known" });
    await expectDeniedBeforeDispatch(() => handleImage(streamRequest()));
  });

  it("codex stream: an unfinished provider stream spends nothing", async () => {
    state.credentials.mockResolvedValue({ connectionId: "account-i", apiKey: "provider-secret", accessToken: "tok", connectionName: "I" });
    fetch.mockImplementationOnce(async () => new Response(item));
    const response = await handleImage(new Request("http://localhost/v1/images/generations", {
      method: "POST", headers: { accept: "text/event-stream" }, body: imageBody({ model: "codex/gpt-image" }),
    }));
    expect(await response.text()).toContain("event: error");
    expect(rows()).toEqual([]);
    expect(await database.getApiKeyUsageTotals("media-key")).toMatchObject({ totalRequests: 0, totalCost: 0 });
  });
});

describe("embedding handler into the dollar budget", () => {
  const receipt = (cost) => ({
    success: true, status: 200,
    accounting: { state: "complete", modality: "embedding", tokens: { input_tokens: 9 }, nativeUnits: {}, cost,
      costStatus: cost === null ? "unknown" : "known", costSource: cost === null ? "unavailable" : "provider", meta: {} },
    response: json({ data: [{ embedding: [0.25] }], usage: { prompt_tokens: 9, total_tokens: 9 } }),
  });

  it("records tokens and cost attributed to the key, then denies before dispatch", async () => {
    state.embedding.mockResolvedValueOnce(receipt(0.5));
    const response = await handleEmbeddings(embedRequest());
    expect(response.status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ apiKey: "media-secret", provider: "paid", model: "embed", connectionId: "account-i", endpoint: "/v1/embeddings", cost: 0.5, promptTokens: 9 });
    expect(meta(rows()[0])).toMatchObject({ modality: "embedding", costStatus: "known" });
    const denied = await handleEmbeddings(embedRequest());
    expect(denied.status).toBe(429);
    expect(state.embedding).toHaveBeenCalledTimes(1);
    expect(await database.getApiKeyUsageTotals("media-key")).toMatchObject({ totalRequests: 1, totalCost: 0.5 });
  });

  it("unknown cost and upstream failure do not spend; unknown stays distinct from zero", async () => {
    state.embedding.mockResolvedValueOnce({ success: false, status: 503, error: "down", response: json({ error: "down" }, 503) });
    expect((await handleEmbeddings(embedRequest())).status).toBe(503);
    expect(rows()).toEqual([]);
    state.embedding.mockResolvedValueOnce(receipt(null));
    expect((await handleEmbeddings(embedRequest())).status).toBe(200);
    state.embedding.mockResolvedValueOnce(receipt(0));
    expect((await handleEmbeddings(embedRequest())).status).toBe(200);
    expect(rows().map((row) => row.cost)).toEqual([null, 0]);
    expect(await database.getApiKeyUsageTotals("media-key")).toMatchObject({ totalRequests: 2, totalCost: 0, unknownCostRequests: 1 });
    state.embedding.mockResolvedValueOnce(receipt(0.25));
    expect((await handleEmbeddings(embedRequest())).status).toBe(200);
  });
});

// New composition coverage: provider HTTP receipts, not manufactured core results.
describe("embedding raw provider receipt through real core and SQLite policy", () => {
  const model = "openrouter/openai/text-embedding-3-small";
  const send = (id) => new Request("http://localhost/v1/embeddings", {
    method: "POST", headers: { "x-request-id": id },
    body: JSON.stringify({ model, input: ["first", "second"] }),
  });
  const raw = (usage) => ({ object: "list", model: "openai/text-embedding-3-small",
    data: [{ object: "embedding", index: 0, embedding: [0.25, -0.5] },
      { object: "embedding", index: 1, embedding: [0.75, 0.125] }],
    ...(usage === undefined ? {} : { usage }) });
  const reopen = async () => {
    await global._dbAdapter.instance.close();
    delete global._dbAdapter;
    delete global._apiKeyLimitState;
    vi.resetModules();
    adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    database = await import("@/lib/db/index.js");
    ({ handleEmbeddings } = await import("@/sse/handlers/embeddings.js"));
  };
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
    vi.doUnmock("open-sse/handlers/embeddingsCore.js");
    vi.doUnmock("open-sse/executors/index.js");
    vi.resetModules();
    ({ handleEmbeddings } = await import("@/sse/handlers/embeddings.js"));
    database = await import("@/lib/db/index.js");
  });
  afterEach(() => vi.useRealTimers());

  it.each([["cost_usd", 0.5], ["cost_in_usd_ticks", 500_000_000_000]])("persists raw %s and denies before the next provider HTTP call", async (field, value) => {
    const usage = { [field]: value, prompt_tokens: 9, total_tokens: 9 };
    const payload = raw(usage);
    fetch.mockResolvedValueOnce(json(payload));
    const response = await handleEmbeddings(send(`paid-${field}`));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(payload.data);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ model: "openai/text-embedding-3-small", input: ["first", "second"] });
    await reopen();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ apiKey: "media-secret", provider: "openrouter", model: "openai/text-embedding-3-small", connectionId: "account-i", endpoint: "/v1/embeddings", cost: 0.5, promptTokens: 9 });
    expect(meta(rows()[0])).toMatchObject({ modality: "embedding", costStatus: "known", costSource: "provider",
      providerUsage: { path: "usage", value: usage }, providerCost: { path: `usage.${field}`, value } });
    const totals = await database.getApiKeyUsageTotals("media-key");
    expect(totals).toMatchObject({ totalRequests: 1, totalCost: 0.5, unknownCostRequests: 0 });
    expect((await handleEmbeddings(send(`denied-${field}`))).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await database.getApiKeyUsageTotals("media-key")).toEqual(totals);
  });

  it("keeps missing and invalid receipts unknown, explicit zero known, and failed requests outside allowance", async () => {
    adapter.run("UPDATE apiKeys SET policy = ? WHERE id = ?", [JSON.stringify({ maxCostUsd: 0.5, monthlyRequestLimit: 3 }), "media-key"]);
    fetch.mockResolvedValueOnce(json({ error: { message: "synthetic provider rejection" } }, 503));
    expect((await handleEmbeddings(send("failed"))).status).toBe(503);
    expect(rows()).toEqual([]);
    const usages = [undefined, { cost_usd: "invalid", prompt_tokens: 9 }, { cost_usd: 0, prompt_tokens: 9 }];
    for (const [index, usage] of usages.entries()) {
      const payload = raw(usage);
      fetch.mockResolvedValueOnce(json(payload));
      const response = await handleEmbeddings(send(`unknown-zero-${index}`));
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual(payload.data);
    }
    await reopen();
    expect(rows().map((row) => row.cost)).toEqual([null, null, 0]);
    expect(rows().map((row) => meta(row).costStatus)).toEqual(["unknown", "unknown", "known"]);
    expect(await database.getApiKeyUsageTotals("media-key")).toMatchObject({ totalRequests: 3, totalCost: 0, unknownCostRequests: 2 });
    expect((await handleEmbeddings(send("allowance-denied"))).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(rows()).toHaveLength(3);
  });
});
