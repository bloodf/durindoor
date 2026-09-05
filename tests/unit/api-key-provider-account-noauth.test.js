import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-key-noauth-"));
const originalDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = tempDir;
const originalFetch = global.fetch;

const mocks = vi.hoisted(() => ({
  image: vi.fn(),
  search: vi.fn(),
  fetch: vi.fn(),
  tts: vi.fn(),
  stt: vi.fn(),
  rerank: vi.fn(),
  moderation: vi.fn(),
  handleChat: vi.fn(),
}));

vi.mock("../../open-sse/handlers/imageGenerationCore.js", () => ({ handleImageGenerationCore: mocks.image }));
vi.mock("../../open-sse/handlers/search/index.js", () => ({ handleSearchCore: mocks.search }));
vi.mock("../../open-sse/handlers/fetch/index.js", () => ({ handleFetchCore: mocks.fetch }));
vi.mock("../../open-sse/handlers/ttsCore.js", () => ({ handleTtsCore: mocks.tts }));
vi.mock("../../open-sse/handlers/sttCore.js", () => ({ handleSttCore: mocks.stt }));
vi.mock("../../open-sse/handlers/rerankCore.js", () => ({ handleRerankCore: mocks.rerank }));
vi.mock("../../open-sse/handlers/moderationsCore.js", () => ({ handleModerationsCore: mocks.moderation }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async (model) => {
    const [provider, ...rest] = String(model).split("/");
    return { provider, model: rest.join("/") || "default" };
  }),
  getComboModels: vi.fn(async () => null),
  getComboCanonicalName: vi.fn(async () => null),
  getAutoComboCatalog: vi.fn(async () => []),
}));

vi.resetModules();

const db = await import("@/lib/localDb");
const { getAdapter } = await import("@/lib/db/driver.js");
const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");
const { handleSearch } = await import("../../src/sse/handlers/search.js");
const { handleFetch } = await import("../../src/sse/handlers/fetch.js");
const { handleTts } = await import("../../src/sse/handlers/tts.js");
const { handleStt } = await import("../../src/sse/handlers/stt.js");
const { handleRerank } = await import("../../src/sse/handlers/rerank.js");
const { handleModerations } = await import("../../src/sse/handlers/moderations.js");
const { POST: handleGeminiNative } = await import("../../src/app/api/v1beta/models/[...path]/route.js");

await db.updateSettings({ requireApiKey: true });
const unrelated = await db.createProviderConnection({
  provider: "openai",
  authType: "apikey",
  name: "Unrelated account",
  apiKey: "unrelated-secret",
});
const scopedKey = await db.createApiKey("Scoped caller", "scope-machine", [], null, null, {
  providerConnectionIds: [unrelated.id],
});
const storedLocal = await db.createProviderConnection({
  provider: "sdwebui",
  authType: "none",
  name: "Allowed local account",
  providerSpecificData: { baseUrl: "http://127.0.0.1:7860" },
});
const localScopedKey = await db.createApiKey("Local scoped caller", "local-machine", [], null, null, {
  providerConnectionIds: [storedLocal.id],
});
const legacyKey = "sk-deadbeef";
const adapter = await getAdapter();
adapter.run(
  `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, dailyLimitTokens, policy, expiresAt, createdAt)
   VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ["legacy-key-row", legacyKey, "Legacy caller", "legacy-machine", 1, "[]", null, null, null, new Date().toISOString()],
);

function jsonRequest(pathname, body, key = scopedKey.key) {
  return new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

function sttRequest(key = scopedKey.key) {
  const form = new FormData();
  form.set("model", "local-device/transcribe");
  form.set("file", new Blob(["audio"], { type: "audio/wav" }), "sample.wav");
  return new Request("http://localhost/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
}

const successfulCore = () => ({ success: true, response: new Response("ok", { status: 200 }), data: {} });

describe("API-key provider scope at no-auth handler entrypoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const core of [mocks.image, mocks.search, mocks.fetch, mocks.tts, mocks.stt, mocks.rerank, mocks.moderation]) {
      core.mockResolvedValue(successfulCore());
    }
    global.fetch = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
  });

  it.each([
    ["image generation", handleImageGeneration, () => jsonRequest("/v1/images/generations", { model: "sdwebui/sdxl", prompt: "cat" }), mocks.image],
    ["search", handleSearch, () => jsonRequest("/v1/search", { provider: "searxng", query: "durindoor" }), mocks.search],
    ["fetch", handleFetch, () => jsonRequest("/v1/fetch", { provider: "firecrawl_custom", url: "https://example.com" }), mocks.fetch],
    ["TTS", handleTts, () => jsonRequest("/v1/audio/speech", { model: "coqui/default", input: "hello" }), mocks.tts],
    ["STT", handleStt, () => sttRequest(), mocks.stt],
    ["rerank", handleRerank, () => jsonRequest("/v1/rerank", { model: "auggie/rerank", query: "q", documents: ["doc"] }), mocks.rerank],
    ["moderation", handleModerations, () => jsonRequest("/v1/moderations", { model: "auggie/moderation", input: "hello" }), mocks.moderation],
  ])("blocks scoped keys before %s no-auth core execution", async (_label, handler, makeRequest, core) => {
    const response = await handler(makeRequest());
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("No credentials for provider");
    expect(core).not.toHaveBeenCalled();
  });

  it("blocks a scoped key before the native Gemini fetch path", async () => {
    const request = jsonRequest(
      "/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
      {
        contents: [{ parts: [{ text: "hello" }] }],
        generationConfig: { responseModalities: ["AUDIO"] },
      },
    );
    const response = await handleGeminiNative(request, {
      params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:generateContent"] }),
    });
    expect(response.status).toBe(503);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("projects an explicitly allowed stored no-auth connection into the core", async () => {
    const response = await handleImageGeneration(jsonRequest(
      "/v1/images/generations",
      { model: "sdwebui/sdxl", prompt: "cat" },
      localScopedKey.key,
    ));
    expect(response.status).toBe(200);
    expect(mocks.image).toHaveBeenCalledWith(expect.objectContaining({
      credentials: expect.objectContaining({ connectionId: storedLocal.id, connectionName: "Allowed local account" }),
    }));
  });

  it("authenticates a real stored legacy sk-<8 hex> key with zero relations and keeps no-auth routing unrestricted", async () => {
    expect(await db.getApiKeyProviderConnectionIds("legacy-key-row")).toEqual([]);
    const response = await handleImageGeneration(jsonRequest(
      "/v1/images/generations",
      { model: "sdwebui/sdxl", prompt: "legacy cat" },
      legacyKey,
    ));
    expect(response.status).toBe(200);
    expect(mocks.image).toHaveBeenCalledOnce();
    expect(mocks.image).toHaveBeenCalledWith(expect.objectContaining({ credentials: null }));
  });
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  global.fetch = originalFetch;
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
