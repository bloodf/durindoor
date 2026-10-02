import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(), resolveClientApiKey: vi.fn(), credentials: vi.fn(), policy: vi.fn(), model: vi.fn(), fetch: vi.fn(), registry: [],
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/sse/services/auth", () => ({ resolveClientApiKey: mocks.resolveClientApiKey, getProviderCredentialsWithQuotaPreflight: mocks.credentials }));
vi.mock("@/sse/services/apiKeyPolicy", () => ({ enforceApiKeyModelPolicy: mocks.policy }));
vi.mock("@/sse/services/model", () => ({ getModelInfo: mocks.model }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));
vi.mock("open-sse/providers/registry/index.js", () => ({ default: mocks.registry }));

const { handleNativeProvider } = await import("@/sse/handlers/nativeProvider.js");

function request(url, body, headers = {}) {
  return new Request(url, { method: "POST", headers: { authorization: "Bearer gateway", "content-type": "application/json", cookie: "private", ...headers }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.registry.length = 0;
  mocks.getSettings.mockResolvedValue({ requireApiKey: true });
  mocks.resolveClientApiKey.mockResolvedValue({ apiKey: "gateway", auth: { ok: true, apiKeyId: "key" } });
  mocks.model.mockImplementation(async (id) => ({ provider: id.split("/")[0], model: id.slice(id.indexOf("/") + 1) }));
  mocks.policy.mockResolvedValue(null);
  mocks.credentials.mockResolvedValue({ connectionId: "conn-a", apiKey: "vendor", providerSpecificData: {} });
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ client_secret: { value: "ephemeral" } }), { headers: { "content-type": "application/json", "set-cookie": "never-forward" } }));
});

describe("native provider facade", () => {
  it("rejects unknown operation before auth", async () => {
    const result = await handleNativeProvider(request("http://local/v1/native/openai/nope?model=openai/gpt-realtime"), "openai", "/nope");
    expect(result.status).toBe(404); expect(mocks.resolveClientApiKey).not.toHaveBeenCalled();
  });

  it("rejects provider mismatch before credential selection", async () => {
    const result = await handleNativeProvider(request("http://local/v1/native/openai/realtime/client_secrets?model=xai/grok"), "openai", "/v1/realtime/client_secrets");
    expect(result.status).toBe(400); expect(mocks.credentials).not.toHaveBeenCalled();
  });

  it("pins account-bound polls strictly", async () => {
    const result = await handleNativeProvider(new Request("http://local/v1/native/minimax/v2/query/video_generation?model=minimax/H3", { headers: { authorization: "Bearer gateway", "x-connection-id": "conn-a" } }), "minimax", "/v2/query/video_generation");
    expect(result.status).toBe(200);
    expect(mocks.credentials).toHaveBeenCalledWith("minimax", null, "H3", expect.objectContaining({ preferredConnectionId: "conn-a", strictConnectionId: "conn-a" }));
  });

  it("rejects missing account pin before selection", async () => {
    const result = await handleNativeProvider(new Request("http://local/v1/native/minimax/v2/query/video_generation?model=minimax/H3", { headers: { authorization: "Bearer gateway" } }), "minimax", "/v2/query/video_generation");
    expect(result.status).toBe(400); expect(mocks.credentials).not.toHaveBeenCalled();
  });


  it("blocks unavailable model before credentials", async () => {
    mocks.registry.push({ id: "openai", models: [{ id: "gpt-realtime", routingUnavailableReason: "Unavailable" }] });
    const result = await handleNativeProvider(request("http://local/v1/realtime/client_secrets?model=openai/gpt-realtime"), "openai", "/v1/realtime/client_secrets");
    expect(result.status).toBe(400); expect(mocks.credentials).not.toHaveBeenCalled();
  });

  it("uses MiniMax Anthropic x-api-key auth", async () => {
    const result = await handleNativeProvider(request("http://local/v1/native/minimax/anthropic/v1/messages?model=minimax/M3", { messages: [] }), "minimax", "/anthropic/v1/messages");
    expect(result.status).toBe(200); expect(mocks.fetch.mock.calls[0][1].headers.get("x-api-key")).toBe("vendor");
    expect(mocks.fetch.mock.calls[0][1].headers.get("authorization")).toBeNull();
  });

  it("returns account pin after native async creation", async () => {
    const result = await handleNativeProvider(request("http://local/v1/native/minimax/v2/video_generation?model=minimax/H3", { model: "minimax/H3", prompt: "x" }), "minimax", "/v2/video_generation");
    expect(result.status).toBe(200); expect(result.headers.get("x-9router-connection-id")).toBe("conn-a");
  });

  it("strips routing query, excludes gateway headers, returns ephemeral CORS no-store", async () => {
    const result = await handleNativeProvider(request("http://local/v1/realtime/client_secrets?model=openai/gpt-realtime&foo=ok", {}), "openai", "/v1/realtime/client_secrets");
    expect(result.status).toBe(200); expect(mocks.fetch.mock.calls[0][0].toString()).toBe("https://api.openai.com/v1/realtime/client_secrets?foo=ok");
    expect(mocks.fetch.mock.calls[0][1].headers.get("authorization")).toBe("Bearer vendor"); expect(mocks.fetch.mock.calls[0][1].headers.get("cookie")).toBeNull();
    expect(result.headers.get("cache-control")).toBe("no-store"); expect(result.headers.get("access-control-allow-origin")).toBe("*"); expect(result.headers.get("set-cookie")).toBeNull();
  });

  it("denies a nested native Live backend outside the key's model scope", async () => {
    mocks.policy.mockImplementation(async (_request, model) => model === "openai/gpt-6-astra" ? new Response("Forbidden", { status: 403 }) : null);
    const result = await handleNativeProvider(request("http://local/v1/live/sessions", {
      session: { model: "openai/gpt-live-1", delegation: { type: "responses", responses: { model: "gpt-6-astra" } } },
      transport: { type: "webrtc", sdp: "v=0" }
    }), "openai", "/v1/live/sessions");
    expect(result.status).toBe(403);
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("denies an unauthorized batch child even when the routing model is allowed", async () => {
    mocks.policy.mockImplementation(async (_request, model) => model === "anthropic/claude-opus-5-5" ? new Response("Forbidden", { status: 403 }) : null);
    const result = await handleNativeProvider(request("http://local/v1/native/anthropic/v1/messages/batches?model=anthropic/claude-haiku-4-5", {
      requests: [{ custom_id: "expensive", params: { model: "claude-opus-5-5", max_tokens: 128, messages: [{ role: "user", content: "hello" }] } }]
    }), "anthropic", "/v1/messages/batches");
    expect(result.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not switch a pinned creation to another provider account", async () => {
    mocks.credentials.mockResolvedValueOnce({ connectionId: "wrong-account", apiKey: "vendor", providerSpecificData: {} });
    const result = await handleNativeProvider(request("http://local/v1/native/minimax/v2/video_generation?model=minimax/H3", { prompt: "x" }, { "x-connection-id": "conn-a" }), "minimax", "/v2/video_generation");
    expect(result.status).toBe(503);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("redacts a provider credential echoed in an upstream error", async () => {
    const secret = "credential-fixture-987";
    mocks.credentials.mockResolvedValueOnce({ connectionId: "conn-a", apiKey: secret, providerSpecificData: {} });
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Rejected " + secret } }), { status: 401 }));
    const result = await handleNativeProvider(request("http://local/v1/realtime/client_secrets?model=openai/gpt-realtime", {}), "openai", "/v1/realtime/client_secrets");
    expect(result.status).toBe(401);
    expect(await result.text()).not.toContain(secret);
  });
});
