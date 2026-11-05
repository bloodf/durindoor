import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ combo: null, policy: null, settings: {}, customModels: [], syncedCatalogs: {}, credentials: vi.fn(), mark: vi.fn(), ttsCore: vi.fn(), apiKeyId: null }));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => state.settings), getCombos: vi.fn(async () => []), getApiKeyByKey: vi.fn(), getComboForModel: vi.fn(async () => null), getCustomModels: vi.fn(async () => state.customModels), getSyncedModelCatalog: vi.fn(async (provider) => state.syncedCatalogs[provider]) }));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: vi.fn(async () => ({ apiKey: null, auth: { ok: true, apiKeyId: state.apiKeyId, billingEpoch: null } })),
  getProviderCredentialsWithQuotaPreflight: state.credentials, getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: state.mark, clearAccountError: vi.fn(),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async (id) => {
    const resolved = id === "my-image" ? "openai/gpt-image-1" : id === "my-custom" ? "openai/gpt-4o" : id;
    const [provider, ...model] = resolved.split("/");
    return { provider, model: model.join("/") };
  }),
  getComboModels: vi.fn(async () => state.combo), getComboCanonicalName: vi.fn(async () => null),
}));
vi.mock("@/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: vi.fn(async () => state.policy),
  recordApiKeyUsage: vi.fn(), recordApiKeyUsageForResponse: vi.fn(async (_key, response) => response),
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: vi.fn(async (_p, c) => c), updateProviderCredentials: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetch(...args) }));
vi.mock("open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: vi.fn(async () => null) }));
vi.mock("@/sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: () => false, resolveMediaRoute: vi.fn(), defaultRouteComboOptions: () => ({}) }));
vi.mock("@/sse/utils/requestCorrelation.js", () => ({ captureRequestBillingEpoch: vi.fn(), getRequestId: () => "test", withRequestCorrelation: (fn) => fn }));

vi.mock("open-sse/handlers/ttsCore.js", () => ({ handleTtsCore: state.ttsCore }));
vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected network request"); }));
const { handleSearch } = await import("@/sse/handlers/search.js");
const { handleTts } = await import("@/sse/handlers/tts.js");
const { handleStt } = await import("@/sse/handlers/stt.js");
const { handleEmbeddings } = await import("@/sse/handlers/embeddings.js");
const { handleRerank } = await import("@/sse/handlers/rerank.js");
const { handleMusicGeneration } = await import("@/sse/handlers/music.js");
const { handleVideoCreate } = await import("@/sse/handlers/video.js");
const { handleVideoGeneration } = await import("@/sse/handlers/video.js");
const jsonRequest = (path, body) => new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); state.combo = null; state.policy = null; state.settings = {}; state.customModels = []; state.syncedCatalogs = {}; state.apiKeyId = null;
  state.mark.mockResolvedValue({ shouldFallback: false });
  state.ttsCore.mockResolvedValue({ success: false, status: 503, error: "upstream failure", response: Response.json({ error: { message: "upstream failure" } }, { status: 503 }) });
  state.credentials.mockResolvedValue({ connectionId: "test", apiKey: "test" });
});
describe("non-chat model kinds", () => {
  it.each([
    ["rerank", () => handleRerank(jsonRequest("/v1/rerank", { model: "openai/gpt-4o", query: "hello", documents: ["hello"] }))],
    ["music", () => handleMusicGeneration(jsonRequest("/v1/music/generations", { model: "openai/gpt-4o", prompt: "hello" }))],
    ["speech", () => handleTts(jsonRequest("/v1/audio/speech", { model: "openai/gpt-4o", input: "hello" }))],
    ["embeddings", () => handleEmbeddings(jsonRequest("/v1/embeddings", { model: "openai/gpt-4o", input: "hello" }))],
    ["video", () => handleVideoGeneration(jsonRequest("/v1/video/generations", { model: "openai/gpt-4o", prompt: "hello" }))],
    ["translation", () => { const form = new FormData(); form.set("model", "openai/gpt-4o"); form.set("file", new Blob(["audio"]), "audio.wav"); return handleStt(new Request("http://localhost/v1/audio/translations", { method: "POST", body: form }), { kind: "translation" }); }],
    ["transcription", () => { const form = new FormData(); form.set("model", "openai/gpt-4o"); form.set("file", new Blob(["audio"]), "audio.wav"); return handleStt(new Request("http://localhost/v1/audio/transcriptions", { method: "POST", body: form })); }],
  ])("rejects chat models for %s before credentials", async (_name, call) => {
    const response = await call();
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("cannot be used for");
    expect(state.credentials).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a model ID as a search provider before credentials", async () => {
    const response = await handleSearch(jsonRequest("/v1/search", { model: "openai/gpt-4o", query: "hello" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("Unknown provider");
    expect(state.credentials).not.toHaveBeenCalled();
  });
  it("rejects a chat model on asynchronous video creation", async () => {
    state.apiKeyId = "key";
    const response = await handleVideoCreate(jsonRequest("/v1/videos", { model: "xai/grok-4.7", prompt: "hello" }), "generations");
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/cannot be used for video/);
    expect(state.credentials).not.toHaveBeenCalled();
  });
  it("does not penalize smart scoring for metadata failures", async () => {
    const db = await import("@/lib/localDb");
    const { getComboModelQuotaHealth, resetComboScoring } = await import("open-sse/services/combo.js");
    resetComboScoring("combo"); state.combo = ["openai/gpt-4o"];
    state.settings = { comboStrategies: { combo: { fallbackStrategy: "smart-scoring" } } };
    vi.mocked(db.getCustomModels).mockRejectedValueOnce(new Error("unavailable"));
    const response = await handleTts(jsonRequest("/v1/audio/speech", { model: "combo", input: "hello" }));
    expect(response.status).toBe(503);
    expect(getComboModelQuotaHealth("combo", "openai/gpt-4o")).toBe("healthy");
    expect(state.credentials).not.toHaveBeenCalled();
  });
  it("penalizes smart scoring for an upstream 503", async () => {
    const { getComboModelQuotaHealth, resetComboScoring } = await import("open-sse/services/combo.js");
    resetComboScoring("combo"); state.combo = ["openai/unknown-voice"];
    state.settings = { comboStrategies: { combo: { fallbackStrategy: "smart-scoring" } } };
    const response = await handleTts(jsonRequest("/v1/audio/speech", { model: "combo", input: "hello" }));
    expect(response.status).toBe(503);
    expect(state.ttsCore).toHaveBeenCalledOnce();
    expect(getComboModelQuotaHealth("combo", "openai/unknown-voice")).toBe("degraded");
  });
  it.each([
    ["llm", "xai", "grok-4.7"], ["image", "xai", "grok-imagine-image"],
    ["video", "xai", "grok-imagine-video"], ["tts", "xai", "tts"],
    ["stt", "xai", "stt"], ["embedding", "openai", "text-embedding-3-small"],
  ])("rejects %s models for every other validated kind", async (source, provider, model) => {
    const { modelKindError } = await import("@/sse/handlers/modelKind.js");
    for (const target of ["tts", "stt", "embedding", "video", "music", "rerank"]) {
      const response = await modelKindError(provider, model, {}, target);
      if (source === target) expect(response).toBeNull();
      else expect(response?.status, `${source} to ${target}`).toBe(400);
    }
  });
  it("honors an enabled synced kind override", async () => {
    const { modelKindError } = await import("@/sse/handlers/modelKind.js");
    state.syncedCatalogs = { openai: { syncedAt: "2026-01-01T00:00:00Z", models: [{ id: "gpt-4o", kind: "tts" }] } };
    expect(await modelKindError("openai", "gpt-4o", {}, "tts")).toBeNull();
  });
  it("accepts an explicitly overridden model kind", async () => {
    const { modelKindError } = await import("@/sse/handlers/modelKind.js");
    state.customModels = [{ providerAlias: "openai", id: "gpt-4o", kind: "tts" }];
    expect(await modelKindError("openai", "gpt-4o", {}, "tts")).toBeNull();
    expect(await modelKindError("openai", "unknown", {}, "tts")).toBeNull();
  });

});
