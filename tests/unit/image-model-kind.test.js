import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ combo: null, policy: null, customModels: [], syncedCatalogs: {}, credentials: vi.fn(), mark: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({})), getApiKeyByKey: vi.fn(), getComboForModel: vi.fn(async () => null), getCustomModels: vi.fn(async () => state.customModels), getSyncedModelCatalog: vi.fn(async (provider) => state.syncedCatalogs[provider]) }));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: vi.fn(async () => ({ apiKey: null, auth: { ok: true, apiKeyId: null, billingEpoch: null } })),
  getProviderCredentialsWithQuotaPreflight: state.credentials, getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: state.mark, clearAccountError: vi.fn(),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async (id) => {
    const resolved = id === "my-image" ? "openai/gpt-image-1" : id;
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
  vi.clearAllMocks(); state.combo = null; state.policy = null; state.customModels = []; state.syncedCatalogs = {};
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
  it("allows a synced image row sharing a registered chat id", async () => {
    state.syncedCatalogs = { openai: { syncedAt: "2026-01-01T00:00:00Z", models: [{ id: "gpt-4o", kind: "image" }] } };
    expect((await handleImageGeneration(request("openai/gpt-4o"))).status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("preserves dispatch if custom metadata cannot be read", async () => {
    const db = await import("@/lib/localDb");
    vi.mocked(db.getCustomModels).mockRejectedValueOnce(new Error("unavailable"));
    expect((await handleImageGeneration(request("openai/gpt-4o"))).status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
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
  it("preserves combo fallback after a rejected model", async () => {
    state.combo = ["openai/gpt-4o", "openai/gpt-image-1"];
    const response = await handleImageGeneration(request("combo"));
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe("gpt-image-1");
    expect(state.mark).not.toHaveBeenCalled();
  });
});
