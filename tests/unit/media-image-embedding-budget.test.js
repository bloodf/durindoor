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
  originalEnv = { DATA_DIR: process.env.DATA_DIR, DURINDOOR_DATABASE_ENGINE: process.env.DURINDOOR_DATABASE_ENGINE };
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "image-embedding-budget-"));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
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
