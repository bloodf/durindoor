import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #1085 acceptance: the REAL stt/tts handlers, the real policy enforcer and
// real isolated SQLite, with only the cost limit key. Same synthetic finite
// fetch fixtures as media-audio-usage.test.js; the policy enforcer and the
// policy row are real, so the committed spend drives the next decision.

const state = vi.hoisted(() => ({ combo: null }));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: async () => ({ apiKey: "audio-secret", auth: { ok: true, apiKeyId: "audio-key" } }),
  hasValidCliToken: async () => false,
  getNoAuthProviderCredentials: vi.fn(async () => ({ connectionId: null })),
  getProviderCredentialsWithQuotaPreflight: vi.fn(async () => ({ apiKey: "provider-secret", connectionId: "account-a" })),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (value) => { const [provider, ...model] = value.split("/"); return { provider, model: model.join("/") }; },
  getComboModels: async () => state.combo,
  getComboCanonicalName: async () => (state.combo ? "audio-combo" : null),
}));
vi.mock("@/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: (model) => !model, resolveMediaRoute: async () => ({ models: state.combo }),
  defaultRouteComboOptions: () => ({}), supportsTranslation: () => true,
}));
vi.mock("open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: async () => ({ allowedConnectionIds: ["account-a"], restrictionApplied: true }) }));
vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: async ({ body, models, handleSingleModel }) => {
    let response;
    for (const model of models) { response = await handleSingleModel(body, model); if (response.ok) return response; }
    return response;
  },
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetch(...args) }));

const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let directory; let originalEnv; let listeners; let adapter; let database; let handleStt; let handleTts;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function sttRequest(model = "openai/whisper-1", kind = "transcriptions") {
  const body = new FormData();
  body.set("model", model);
  body.set("file", new Blob(["audio"], { type: "audio/wav" }), "input.wav");
  return new Request(`http://localhost/v1/audio/${kind}`, { method: "POST", body });
}
const ttsRequest = (model = "openai/tts-1/alloy", input = "hello", options = {}) =>
  new Request("http://localhost/v1/audio/speech", { method: "POST", body: JSON.stringify({ model, input, ...options }) });
const rows = () => adapter.all("SELECT * FROM usageHistory ORDER BY id");
const metadata = (row) => JSON.parse(row.meta);

beforeEach(async () => {
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  originalEnv = { DATA_DIR: process.env.DATA_DIR, DURINDOOR_DATABASE_ENGINE: process.env.DURINDOOR_DATABASE_ENGINE };
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "audio-budget-"));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
  vi.clearAllMocks();
  state.combo = null;
  vi.stubGlobal("fetch", vi.fn());
  database = await import("@/lib/db/index.js");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, policy, createdAt) VALUES(?, ?, ?, 1, '[]', ?, ?)",
    ["audio-key", "audio-secret", "Audio budget", JSON.stringify({ maxCostUsd: 0.006 }), new Date().toISOString()]);
  ({ handleStt } = await import("@/sse/handlers/stt.js"));
  ({ handleTts } = await import("@/sse/handlers/tts.js"));
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

describe("stt priced seconds drive the next request's dollar decision", () => {
  it("commits one attributed record, then denies the next request before transport", async () => {
    fetch.mockResolvedValueOnce(json({ text: "hello", duration: 60 }));
    const response = await handleStt(sttRequest());
    expect(response.status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ apiKey: "audio-secret", provider: "openai", model: "whisper-1", connectionId: "account-a", endpoint: "/v1/audio/transcriptions", cost: 0.006 });
    expect(metadata(rows()[0])).toMatchObject({ modality: "stt", nativeUnits: { audioSeconds: 60 }, costStatus: "estimated" });
    fetch.mockClear();
    fetch.mockResolvedValue(json({ text: "hello", duration: 60 }));
    const denied = await handleStt(sttRequest());
    expect(denied.status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(1);
    expect(await database.getApiKeyUsageTotals("audio-key")).toMatchObject({ totalRequests: 1, totalCost: 0.006 });
  });

  it("unpriced and failed transcriptions spend nothing and stay allowed", async () => {
    fetch.mockResolvedValueOnce(json({ text: "hello" }));
    expect((await handleStt(sttRequest())).status).toBe(200);
    expect(rows()[0].cost).toBeNull();
    expect(metadata(rows()[0])).toMatchObject({ costStatus: "unknown", nativeUnits: {} });
    fetch.mockResolvedValueOnce(json({ error: { message: "down" } }, 500));
    expect((await handleStt(sttRequest())).status).toBeGreaterThanOrEqual(500);
    expect(rows()).toHaveLength(1);
    fetch.mockResolvedValueOnce(json({ text: "hello", duration: 1 }));
    expect((await handleStt(sttRequest())).status).toBe(200);
    expect(rows()).toHaveLength(2);
  });
});

describe("tts receipts drive the next request's dollar decision", () => {
  const ttsReceipt = (cost) => new Response(
    `data: ${JSON.stringify({ id: "receipt-id", choices: [{ delta: { audio: { data: "AQI=" } } }] })}\n\ndata: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8, cost } })}\n\ndata: [DONE]\n\n`);

  it("a priced receipt commits once, then denies", async () => {
    fetch.mockResolvedValueOnce(ttsReceipt(0.006));
    const response = await handleTts(ttsRequest("openrouter/openai/gpt-4o-mini-tts/alloy"));
    expect(response.status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ apiKey: "audio-secret", provider: "openrouter", connectionId: "account-a", endpoint: "/v1/audio/speech", cost: 0.006, promptTokens: 3, completionTokens: 5 });
    expect(metadata(rows()[0])).toMatchObject({ modality: "tts", costStatus: "known", costSource: "provider:openrouter" });
    fetch.mockClear();
    const denied = await handleTts(ttsRequest("openrouter/openai/gpt-4o-mini-tts/alloy"));
    expect(denied.status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(1);
  });

  it("known zero and unknown speech cost stay distinct and never spend", async () => {
    fetch.mockResolvedValueOnce(ttsReceipt(0));
    expect((await handleTts(ttsRequest("openrouter/openai/gpt-4o-mini-tts/alloy"))).status).toBe(200);
    expect(rows()[0].cost).toBe(0);
    fetch.mockResolvedValueOnce(new Response("audio"));
    const unknown = await handleTts(ttsRequest("openai/gpt-4o-mini-tts/alloy"));
    expect(unknown.status).toBe(200);
    await unknown.arrayBuffer();
    expect(rows()[1].cost).toBeNull();
    expect(metadata(rows()[1])).toMatchObject({ costStatus: "unknown", costSource: "unavailable" });
    expect(await database.getApiKeyUsageTotals("audio-key")).toMatchObject({ totalRequests: 2, totalCost: 0, unknownCostRequests: 1 });
  });

  it("binary synthesis charges trimmed characters and is denied afterwards", async () => {
    fetch.mockImplementation(async () => new Response(new Uint8Array([0, 255, 1, 128])));
    const response = await handleTts(ttsRequest("openai/tts-1/alloy", "  hello 🌍  "));
    expect(response.bodyUsed).toBe(false);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 255, 1, 128]));
    expect(rows()).toHaveLength(1);
    expect(metadata(rows()[0])).toMatchObject({ modality: "tts", nativeUnits: { characters: 7 } });
    // The seeded maxCostUsd is 0.006 and one 7-character tts-1 synthesis only
    // costs 0.000105, so the key must actually reach its limit before the gate
    // can deny. 400 more trimmed characters commit 0.006 more on clean EOF, which
    // puts the real committed total at 0.006105.
    const spending = await handleTts(ttsRequest("openai/tts-1/alloy", "a".repeat(400)));
    expect(spending.status).toBe(200);
    await spending.arrayBuffer();
    expect((await database.getApiKeyUsageTotals("audio-key")).totalCost).toBeGreaterThanOrEqual(0.006);
    fetch.mockClear();
    const denied = await handleTts(ttsRequest("openai/tts-1/alloy", "hello"));
    expect(denied.status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });
});
