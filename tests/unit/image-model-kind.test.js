import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ combo: null, policy: null, settings: {}, customModels: [], syncedCatalogs: {}, credentials: vi.fn(), mark: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => state.settings), getApiKeyByKey: vi.fn(), getComboForModel: vi.fn(async () => null), getCustomModels: vi.fn(async () => state.customModels), getSyncedModelCatalog: vi.fn(async (provider) => state.syncedCatalogs[provider]) }));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: vi.fn(async () => ({ apiKey: null, auth: { ok: true, apiKeyId: null, billingEpoch: null } })),
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

const { handleImageGeneration } = await import("@/sse/handlers/imageGeneration.js");
const { handleImageEdit } = await import("@/sse/handlers/imageEdit.js");
const fixture = { created: 123, data: [{ b64_json: "aGVsbG8=" }] };
const request = (model) => new Request("http://localhost/v1/images/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, prompt: "fox" }) });
beforeEach(() => {
  vi.clearAllMocks(); state.combo = null; state.policy = null; state.settings = {}; state.customModels = []; state.syncedCatalogs = {};
  state.credentials.mockResolvedValue({ connectionId: "test", apiKey: "test", connectionName: "test" });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fixture)));
});

describe("image model kind", () => {
  it("rejects a known chat model before credentials and upstream", async () => {
    const response = await handleImageGeneration(request("openai/gpt-4o"));
    expect(response.status).toBe(400);
    expect(state.credentials).not.toHaveBeenCalled();
    expect(state.mark).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["openai/gpt-image-1", "openai/custom-image", "my-image"])("passes image or unknown model %s", async (id) => {
    const response = await handleImageGeneration(request(id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(fixture);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("allows a custom image row sharing a registered chat id", async () => {
    state.customModels = [{ providerAlias: "openai", id: "gpt-4o", kind: "image" }];
    expect((await handleImageGeneration(request("openai/gpt-4o"))).status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("honors an image row produced by synced catalog normalization", async () => {
    const { normalizeSyncedModels } = await import("@/lib/modelAutoSync/catalog.js");
    const { default: openai } = await import("../../open-sse/providers/registry/openai.js");
    const models = normalizeSyncedModels([{ id: "gpt-4o", kind: "image" }], openai.models);
    expect(models[0].kind).toBe("image");
    state.syncedCatalogs = { openai: { syncedAt: "2026-01-01T00:00:00Z", models } };
    expect((await handleImageGeneration(request("openai/gpt-4o"))).status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("preserves explicit registry kind precedence in synced normalization", async () => {
    const { normalizeSyncedModels } = await import("@/lib/modelAutoSync/catalog.js");
    const { default: openai } = await import("../../open-sse/providers/registry/openai.js");
    const models = normalizeSyncedModels([{ id: "text-embedding-3-small", kind: "image" }], openai.models);
    expect(models[0].kind).toBe("embedding");
    state.syncedCatalogs = { openai: { syncedAt: "2026-01-01T00:00:00Z", models } };
    expect((await handleImageGeneration(request("openai/text-embedding-3-small"))).status).toBe(400);
    expect(state.credentials).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["custom", "synced"])("does not infer image kind from an untyped %s row", async (source) => {
    if (source === "custom") state.customModels = [{ providerAlias: "openai", id: "gpt-4o" }];
    else state.syncedCatalogs = { openai: { syncedAt: "2026-01-01T00:00:00Z", models: [{ id: "gpt-4o" }] } };
    expect((await handleImageGeneration(request("openai/gpt-4o"))).status).toBe(400);
    expect(state.credentials).not.toHaveBeenCalled();
    expect(state.mark).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns 503 if custom metadata cannot be read for an aliased model", async () => {
    const db = await import("@/lib/localDb");
    state.customModels = [{ providerAlias: "openai", id: "gpt-4o", kind: "image" }];
    vi.mocked(db.getCustomModels).mockRejectedValueOnce(new Error("unavailable"));
    expect((await handleImageGeneration(request("my-custom"))).status).toBe(503);
    expect(state.credentials).not.toHaveBeenCalled();
    expect(state.mark).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns 503 if the enabled synced catalog cannot be read", async () => {
    const db = await import("@/lib/localDb");
    vi.mocked(db.getSyncedModelCatalog).mockRejectedValueOnce(new Error("unavailable"));
    expect((await handleImageGeneration(request("my-custom"))).status).toBe(503);
    expect(state.credentials).not.toHaveBeenCalled();
    expect(state.mark).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("enforces policy before attempting unavailable metadata", async () => {
    const db = await import("@/lib/localDb");
    state.policy = new Response("denied", { status: 403 });
    vi.mocked(db.getCustomModels).mockRejectedValueOnce(new Error("unavailable"));
    expect((await handleImageGeneration(request("my-custom"))).status).toBe(403);
    expect(db.getCustomModels).not.toHaveBeenCalled();
    expect(state.credentials).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(db.getCustomModels).mockReset().mockImplementation(async () => state.customModels);
  });
  it("rejects a known chat model on image edits before credentials", async () => {
    const form = new FormData();
    form.append("model", "openai/gpt-4o");
    form.append("prompt", "fox");
    form.append("image", new Blob(["image"], { type: "image/png" }), "image.png");
    const response = await handleImageEdit(new Request("http://localhost/v1/images/edits", { method: "POST", body: form }));
    expect(response.status).toBe(400);
    expect(state.credentials).not.toHaveBeenCalled();
    expect(state.mark).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("dispatches an image edit and preserves its response", async () => {
    const form = new FormData();
    form.append("model", "openai/gpt-image-1");
    form.append("prompt", "fox");
    form.append("image", new Blob(["image"], { type: "image/png" }), "image.png");
    const response = await handleImageEdit(new Request("http://localhost/v1/images/edits", { method: "POST", body: form }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(fixture);
    expect(fetch.mock.calls[0][1].body.get("model")).toBe("gpt-image-1");
  });
  it("preserves policy precedence", async () => {
    state.policy = new Response("denied", { status: 403 });
    expect((await handleImageGeneration(request("openai/gpt-4o"))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not penalize a smart-scoring combo for local metadata failure", async () => {
    const db = await import("@/lib/localDb");
    const { getComboModelQuotaHealth, resetComboScoring } = await import("open-sse/services/combo.js");
    const comboName = "combo";
    resetComboScoring(comboName);
    state.combo = ["openai/gpt-4o"];
    state.settings = { comboStrategies: { combo: { fallbackStrategy: "smart-scoring" } } };
    vi.mocked(db.getCustomModels).mockRejectedValueOnce(new Error("unavailable"));
    const schedule = vi.spyOn(globalThis, "setTimeout");
    const response = await handleImageGeneration(request(comboName));
    expect(schedule).not.toHaveBeenCalled();
    schedule.mockRestore();
    expect(response.status).toBe(503);
    expect((await response.json()).error.message).toMatch(/metadata.*unavailable/i);
    expect(getComboModelQuotaHealth(comboName, "openai/gpt-4o")).toBe("healthy");
    expect(state.credentials).not.toHaveBeenCalled();
    expect(state.mark).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("still penalizes a genuine upstream server failure", async () => {
    const { getComboModelQuotaHealth, resetComboScoring } = await import("open-sse/services/combo.js");
    resetComboScoring("combo");
    state.combo = ["openai/gpt-image-1"];
    state.settings = { comboStrategies: { combo: { fallbackStrategy: "smart-scoring" } } };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { message: "upstream error" } }, { status: 503 }));
    state.mark.mockResolvedValue({ shouldFallback: false });
    expect((await handleImageGeneration(request("combo"))).status).toBe(503);
    expect(fetch).toHaveBeenCalledOnce();
    expect(getComboModelQuotaHealth("combo", "openai/gpt-image-1")).toBe("degraded");
  });
  it("preserves combo fallback after a rejected model", async () => {
    state.combo = ["openai/gpt-4o", "openai/gpt-image-1"];
    const response = await handleImageGeneration(request("combo"));
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe("gpt-image-1");
    expect(state.mark).not.toHaveBeenCalled();
  });
});
