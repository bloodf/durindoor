import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admitKey: vi.fn(),
  selectAccount: vi.fn(),
  markUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  refresh: vi.fn(),
  persistCredentials: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: true }),
  getApiKeyByKey: async () => null,
  getCustomModels: async () => [],
  getSyncedModelCatalog: async () => null,
}));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: mocks.admitKey,
  getProviderCredentialsWithQuotaPreflight: mocks.selectAccount,
  markAccountUnavailable: mocks.markUnavailable,
  clearAccountError: mocks.clearAccountError,
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (id) => {
    const [provider, model] = id.split("/");
    return { provider, model };
  },
  getComboModels: async () => null,
}));
vi.mock("@/sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: () => false }));
vi.mock("@/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: async () => null,
  recordApiKeyUsageForResponse: async (_key, response) => response,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_provider, credentials) => credentials,
  updateProviderCredentials: mocks.persistCredentials,
}));
vi.mock("@/sse/utils/requestCorrelation.js", () => ({
  captureRequestBillingEpoch: async () => {},
  getRequestId: () => "image-test",
  withRequestCorrelation: (handler) => handler,
}));
vi.mock("open-sse/executors/index.js", async (importOriginal) => ({
  ...await importOriginal(),
  getExecutor: () => ({ refreshCredentials: mocks.refresh }),
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));

const { handleImageGeneration } = await import("@/sse/handlers/imageGeneration.js");
const { handleImageEdit } = await import("@/sse/handlers/imageEdit.js");

const image = { created: 123, data: [{ b64_json: "aGVsbG8=" }] };

function request(endpoint, { key = true, model = "openai/gpt-image-1", signal } = {}) {
  const headers = new Headers({ "x-connection-id": "pinned" });
  if (key) headers.set("authorization", "Bearer client-key");
  let body;
  if (endpoint === "edits") {
    body = new FormData();
    body.append("model", model);
    body.append("prompt", "fox");
    body.append("image", new Blob(["image"], { type: "image/png" }), "image.png");
  } else {
    headers.set("content-type", "application/json");
    body = JSON.stringify({ model, prompt: "fox" });
  }
  return new Request(`http://localhost/v1/images/${endpoint}`, { method: "POST", headers, body, signal });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.admitKey.mockImplementation(async (req) => req.headers.has("authorization")
    ? { apiKey: "client-key", auth: { ok: true, apiKeyId: "key-id", billingEpoch: null } }
    : { apiKey: null, auth: { ok: false, reason: "missing" } });
  mocks.selectAccount.mockImplementation(async (_provider, excluded, _model, options) => {
    if (excluded.size) return null;
    return { connectionId: options.strictConnectionId || "default", apiKey: "old-token" };
  });
  mocks.refresh.mockResolvedValue({ apiKey: "new-token" });
  mocks.markUnavailable.mockResolvedValue({ shouldFallback: true });
  mocks.fetch.mockImplementation(async () => Response.json(image));
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => vi.unstubAllGlobals());

describe.each([
  { endpoint: "generations", handler: handleImageGeneration },
  { endpoint: "edits", handler: handleImageEdit },
])("$endpoint shared media pipeline", ({ endpoint, handler }) => {
  it("rejects a missing API key before selecting an account", async () => {
    const response = await handler(request(endpoint, { key: false }));
    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe("Missing API key");
    expect(mocks.selectAccount).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects a known chat model before selecting an account", async () => {
    const response = await handler(request(endpoint, { model: "openai/gpt-4o" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/cannot be used for image/);
    expect(mocks.selectAccount).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("preserves the endpoint's account selection options", async () => {
    const response = await handler(request(endpoint));
    expect(response.status).toBe(200);
    expect(mocks.selectAccount).toHaveBeenCalledExactlyOnceWith(
      "openai", new Set(), "gpt-image-1",
      endpoint === "generations"
        ? { apiKeyId: "key-id", preferredConnectionId: "pinned", strictConnectionId: "pinned", allowedConnectionIds: null, restrictionApplied: false }
        : { apiKeyId: "key-id" },
    );
  });

  it("preserves the endpoint's handling of an upstream 401", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: { message: "expired" } }, { status: 401 }));
    const response = await handler(request(endpoint));
    if (endpoint === "generations") {
      expect(response.status).toBe(200);
      expect(mocks.refresh).toHaveBeenCalledOnce();
      expect(mocks.persistCredentials).toHaveBeenCalledWith("pinned", expect.any(Object));
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      expect(new Headers(mocks.fetch.mock.calls[1][1].headers).get("authorization")).toBe("Bearer new-token");
      expect(mocks.markUnavailable).not.toHaveBeenCalled();
    } else {
      expect(response.status).toBe(401);
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.markUnavailable).toHaveBeenCalledWith("default", 401, expect.any(String), "openai", "gpt-image-1", null, expect.any(Object));
      expect(mocks.selectAccount.mock.calls[1][1]).toEqual(new Set(["default"]));
      expect(mocks.fetch).toHaveBeenCalledOnce();
    }
  });
});

it("cancels generation without marking the account or attempting failover", async () => {
  const controller = new AbortController();
  const req = request("generations", { signal: controller.signal });
  mocks.fetch.mockImplementationOnce(async () => {
    controller.abort();
    throw controller.signal.reason;
  });

  expect((await handleImageGeneration(req)).status).toBe(499);
  expect(mocks.fetch.mock.calls[0][1].signal).toBe(req.signal);
  expect(mocks.selectAccount).toHaveBeenCalledOnce();
  expect(mocks.markUnavailable).not.toHaveBeenCalled();
});

it("cancels an edit without marking the account or attempting failover", async () => {
  const controller = new AbortController();
  const req = request("edits", { signal: controller.signal });
  mocks.fetch.mockImplementationOnce(async () => {
    controller.abort();
    throw controller.signal.reason;
  });

  expect((await handleImageEdit(req)).status).toBe(499);
  expect(mocks.fetch.mock.calls[0][1].signal).toBe(req.signal);
  expect(mocks.selectAccount).toHaveBeenCalledOnce();
  expect(mocks.markUnavailable).not.toHaveBeenCalled();
});

// #2669: a cancel mid body read is a cancel on both the error and success path.
it.each([200, 429])("cancels an edit while reading an upstream %s body without touching account health", async (status) => {
  const controller = new AbortController();
  const req = request("edits", { signal: controller.signal });
  mocks.fetch.mockResolvedValueOnce({
    ok: status === 200,
    status,
    headers: new Headers(),
    text: async () => {
      controller.abort();
      throw controller.signal.reason;
    },
  });

  expect((await handleImageEdit(req)).status).toBe(499);
  expect(mocks.selectAccount).toHaveBeenCalledOnce();
  expect(mocks.markUnavailable).not.toHaveBeenCalled();
  expect(mocks.clearAccountError).not.toHaveBeenCalled();
});
