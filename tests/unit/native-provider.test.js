import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(), getApiKeyById: vi.fn(), getApiKeyByKey: vi.fn(), getApiKeyUsageLimitStatus: vi.fn(), saveRequestUsage: vi.fn(), readOwner: vi.fn(), createOwner: vi.fn(), resolveOwner: vi.fn(), proxyOptions: vi.fn(), resolveClientApiKey: vi.fn(), credentials: vi.fn(), policy: vi.fn(), model: vi.fn(), fetch: vi.fn(), registry: [],
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, getApiKeyById: mocks.getApiKeyById, getApiKeyByKey: mocks.getApiKeyByKey, getApiKeyUsageLimitStatus: mocks.getApiKeyUsageLimitStatus, saveRequestUsage: mocks.saveRequestUsage }));
vi.mock("@/sse/services/auth", () => ({ resolveClientApiKey: mocks.resolveClientApiKey, getProviderCredentialsWithQuotaPreflight: mocks.credentials }));
vi.mock("@/sse/services/apiKeyPolicy", async (importOriginal) => ({ ...await importOriginal(), enforceApiKeyModelPolicy: mocks.policy }));
vi.mock("@/sse/services/model", () => ({ getModelInfo: mocks.model }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));
vi.mock("@/sse/services/nativeResourceOwners", () => ({ readNativeResourceOwner: mocks.readOwner, createNativeResourceOwner: mocks.createOwner }));
vi.mock("@/sse/services/resourceOwnership", () => ({ resolveResourceOwner: mocks.resolveOwner }));
vi.mock("open-sse/providers/registry/index.js", () => ({ default: mocks.registry }));
vi.mock("open-sse/services/oauthCredentialManager.js", () => ({ resolveCredentialProxyOptions: mocks.proxyOptions }));

const { handleNativeProvider } = await import("@/sse/handlers/nativeProvider.js");

function request(url, body, headers = {}) {
  return new Request(url, { method: "POST", headers: { authorization: "Bearer gateway", "content-type": "application/json", cookie: "private", ...headers }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.registry.length = 0;
  mocks.registry.push(
    { id: "openai", models: ["gpt-realtime", "gpt-4.1", "gpt-4.1-mini", "gpt-live-1", "gpt-6-astra"].map((id) => ({ id })) },
    { id: "minimax", models: [{ id: "H3" }, { id: "M3" }] },
    { id: "xai", models: [{ id: "video" }] },
    { id: "anthropic", models: [{ id: "claude-haiku-4-5" }, { id: "claude-opus-5-5" }] },
    { id: "cohere", models: [{ id: "embed-v5.0-fast" }] },
  );
  mocks.getSettings.mockResolvedValue({ requireApiKey: true });
  mocks.resolveClientApiKey.mockResolvedValue({ apiKey: "gateway", auth: { ok: true, apiKeyId: "key" } });
  mocks.model.mockImplementation(async (id) => ({ provider: id.split("/")[0], model: id.slice(id.indexOf("/") + 1) }));
  mocks.policy.mockResolvedValue(null);
  mocks.getApiKeyByKey.mockResolvedValue(null);
  mocks.getApiKeyById.mockResolvedValue({ id: "key", key: "gateway" });
  mocks.getApiKeyUsageLimitStatus.mockResolvedValue({ exceeded: false });
  mocks.readOwner.mockResolvedValue({ ownerId: "key", usageEventId: "native-creation-operation" });
  mocks.resolveOwner.mockResolvedValue({ authorized: true, ownerId: "key", allowAllOwners: false });
  mocks.saveRequestUsage.mockResolvedValue(true);
  mocks.proxyOptions.mockImplementation((credentials) => credentials.providerSpecificData);
  mocks.credentials.mockResolvedValue({ connectionId: "conn-a", apiKey: "vendor", providerSpecificData: {} });
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ client_secret: { value: "ephemeral" } }), { headers: { "content-type": "application/json", "set-cookie": "never-forward" } }));
});

describe("native provider facade", () => {
  it("rejects unknown operation before auth", async () => {
    const result = await handleNativeProvider(request("http://local/v1/native/openai/nope?model=openai/gpt-realtime"), "openai", "/nope");
    expect(result.status).toBe(404); expect(mocks.resolveClientApiKey).not.toHaveBeenCalled();
  });

  it("rejects an unregistered built-in native model before credential selection or dispatch", async () => {
    const result = await handleNativeProvider(request("http://local/v1/native/cohere/v2/embed", {
      model: "cohere/not-a-model", texts: ["fixture"], input_type: "search_document",
    }), "cohere", "/v2/embed");
    expect(result.status).toBe(400);
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects provider mismatch before credential selection", async () => {
    const result = await handleNativeProvider(request("http://local/v1/native/openai/realtime/client_secrets?model=xai/grok"), "openai", "/v1/realtime/client_secrets");
    expect(result.status).toBe(400); expect(mocks.credentials).not.toHaveBeenCalled();
  });

  it("pins account-bound polls strictly", async () => {
    const result = await handleNativeProvider(new Request("http://local/v1/native/minimax/v2/query/video_generation?model=minimax/H3&task_id=job-a", { headers: { authorization: "Bearer gateway", "x-connection-id": "conn-a" } }), "minimax", "/v2/query/video_generation");
    expect(result.status).toBe(200);
    expect(mocks.credentials).toHaveBeenCalledWith("minimax", null, "H3", expect.objectContaining({ preferredConnectionId: "conn-a", strictConnectionId: "conn-a" }));
  });

  it("denies foreign owner before native completion poll dispatch", async () => {
    mocks.readOwner.mockResolvedValueOnce({ ownerId: "other-key" });
    const result = await handleNativeProvider(new Request("http://local/v1/native/minimax/v2/query/video_generation?model=minimax/H3&task_id=job-a", { headers: { authorization: "Bearer gateway", "x-connection-id": "conn-a" } }), "minimax", "/v2/query/video_generation");
    expect(result.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("accounts terminal completion poll to resource creator", async () => {
    mocks.getApiKeyById.mockResolvedValueOnce({ key: "creator-secret" });
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed", usage: { input_tokens: 3, output_tokens: 5 } }), { headers: { "content-type": "application/json" } }));
    const result = await handleNativeProvider(new Request("http://local/v1/native/minimax/v2/query/video_generation?model=minimax/H3&task_id=job-a", { headers: { authorization: "Bearer gateway", "x-connection-id": "conn-a" } }), "minimax", "/v2/query/video_generation");
    await result.text();
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "creator-secret", usageEventId: "native-creation-operation", tokens: { input_tokens: 3, output_tokens: 5 }, cost: null, costStatus: "unknown", costSource: "provider-cost-unavailable" }));
  });

  it("rejects missing account pin before selection", async () => {
    const result = await handleNativeProvider(new Request("http://local/v1/native/minimax/v2/query/video_generation?model=minimax/H3", { headers: { authorization: "Bearer gateway" } }), "minimax", "/v2/query/video_generation");
    expect(result.status).toBe(400); expect(mocks.credentials).not.toHaveBeenCalled();
  });

  it("blocks foreign response cancel before upstream dispatch", async () => {
    mocks.readOwner.mockResolvedValueOnce({ ownerId: "creator" });
    const result = await handleNativeProvider(new Request("http://local/v1/native/openai/v1/responses/resp-a/cancel?model=openai/gpt-realtime", { method: "POST", headers: { authorization: "Bearer gateway", "content-type": "application/json", "x-connection-id": "conn-a" }, body: "{}" }), "openai", "/v1/responses/resp-a/cancel");
    expect(result.status).toBe(403);
    expect(mocks.readOwner).toHaveBeenCalledWith("openai", "conn-a", "resp-a");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("forwards resolved native model identity only in execution slots", async () => {
    mocks.model.mockImplementation(async (id) => id === "openai/alias" ? { provider: "openai", model: "gpt-4.1" } : { provider: "openai", model: id.split("/")[1] });
    await handleNativeProvider(request("http://local/v1/native/openai/chat/completions?model=openai/alias", { model: "openai/alias", messages: [{ content: "openai/alias" }] }), "openai", "/v1/chat/completions");
    const body = await new Response(mocks.fetch.mock.calls[0][1].body).text();
    expect(JSON.parse(body)).toMatchObject({ model: "gpt-4.1", messages: [{ content: "openai/alias" }] });
  });
  it("rewrites execution models without rounding native int64 IDs or other JSON values", async () => {
    const body = '{"model":"openai/gpt-4.1","file_id":9223372036854775807,"threshold":1.2300e-10,"messages":[{"content":"openai/gpt-4.1"}]}';
    const input = new Request("http://local/v1/native/openai/chat/completions", {
      method: "POST", headers: { authorization: "Bearer gateway", "content-type": "application/json" }, body,
    });
    await handleNativeProvider(input, "openai", "/v1/chat/completions");
    expect(await new Response(mocks.fetch.mock.calls[0][1].body).text()).toBe(body.replace('"model":"openai/gpt-4.1"', '"model":"gpt-4.1"'));
  });

  it("persists exact nested MiniMax file IDs before upload body completes", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('{"file":{"file_id":9223372036854775807}}', { headers: { "content-type": "application/json" } }));
    const result = await handleNativeProvider(request("http://local/v1/native/minimax/v1/files/upload?model=minimax/H3", {}), "minimax", "/v1/files/upload");
    await result.text();
    expect(mocks.createOwner).toHaveBeenCalledWith(expect.objectContaining({ resourceId: "9223372036854775807" }));
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });

  it("rejects a successful native create body lacking its ownership ID", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('{"status":"queued"}', { headers: { "content-type": "application/json" } }));
    const result = await handleNativeProvider(request("http://local/v1/native/openai/v1/responses?model=openai/gpt-4.1", { input: "x" }), "openai", "/v1/responses");
    await expect(result.text()).rejects.toThrow("Native resource response omitted its ownership ID");
    expect(mocks.createOwner).not.toHaveBeenCalled();
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });

  it("records queued creation ownership without charging terminal usage", async () => {
    const body = '{"id":"resp-queued","status":"queued","usage":{"input_tokens":3,"output_tokens":5}}';
    mocks.fetch.mockResolvedValueOnce(new Response(body, { headers: { "content-type": "application/json" } }));
    const result = await handleNativeProvider(request("http://local/v1/native/openai/v1/responses?model=openai/gpt-4.1", { input: "x" }), "openai", "/v1/responses");
    expect(await result.text()).toBe(body);
    expect(mocks.createOwner).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "key", provider: "openai", model: "gpt-4.1", connectionId: "conn-a", resourceId: "resp-queued", usageEventId: expect.any(String),
    }));
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });
  it("rejects completion polling after the creator key is deleted without charging an operator", async () => {
    mocks.resolveOwner.mockResolvedValueOnce({ authorized: true, ownerId: "operator", allowAllOwners: true });
    mocks.getApiKeyById.mockResolvedValueOnce(null);
    const result = await handleNativeProvider(new Request("http://local/v1/native/openai/v1/responses/resp-a?model=openai/gpt-4.1", {
      headers: { authorization: "Bearer gateway", "x-connection-id": "conn-a" },
    }), "openai", "/v1/responses/resp-a");
    expect(result.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });

  it("rejects poll-model substitution rather than changing completion pricing", async () => {
    mocks.readOwner.mockResolvedValueOnce({ ownerId: "key", model: "gpt-4.1" });
    const result = await handleNativeProvider(new Request("http://local/v1/native/openai/v1/responses/resp-a?model=openai/gpt-4.1-mini", {
      headers: { authorization: "Bearer gateway", "x-connection-id": "conn-a" },
    }), "openai", "/v1/responses/resp-a");
    expect(result.status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("permits authorized local-owned completion without billing the polling key", async () => {
    mocks.resolveOwner.mockResolvedValueOnce({ authorized: true, ownerId: "local", allowAllOwners: false });
    mocks.readOwner.mockResolvedValueOnce({ ownerId: "local", model: "gpt-4.1", usageEventId: "local-creation-operation" });
    mocks.fetch.mockResolvedValueOnce(new Response('{"id":"local-response","status":"completed","usage":{"input_tokens":3,"output_tokens":5}}', { headers: { "content-type": "application/json" } }));
    const result = await handleNativeProvider(new Request("http://local/v1/native/openai/v1/responses/local-response?model=openai/gpt-4.1", {
      headers: { "authorization": "Bearer gateway", "x-connection-id": "conn-a" },
    }), "openai", "/v1/responses/local-response");
    expect(result.status).toBe(200);
    await result.text();
    expect(mocks.getApiKeyById).not.toHaveBeenCalled();
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ apiKey: undefined, usageEventId: "local-creation-operation", tokens: { input_tokens: 3, output_tokens: 5 } }));
  });



  it("persists xAI request_id owner while streaming response", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ request_id: "req-xai" }), { headers: { "content-type": "application/json" } }));
    const result = await handleNativeProvider(request("http://local/v1/native/xai/v1/videos/generations?model=xai/video", { model: "xai/video", prompt: "x" }), "xai", "/v1/videos/generations");
    await result.text();
    expect(mocks.createOwner).toHaveBeenCalledWith(expect.objectContaining({ resourceId: "req-xai", provider: "xai" }));
  });

  it("waits for streamed owner persistence before response EOF", async () => {
    let release;
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ task_id: "job-owner" }), { headers: { "content-type": "application/json" } }));
    mocks.createOwner.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const result = await handleNativeProvider(request("http://local/v1/native/minimax/v2/video_generation?model=minimax/H3", { model: "minimax/H3", prompt: "x" }), "minimax", "/v2/video_generation");
    let done = false;
    const body = result.text().then((text) => { done = true; return text; });
    await vi.waitFor(() => expect(mocks.createOwner).toHaveBeenCalledWith(expect.objectContaining({ resourceId: "job-owner" })));
    expect(done).toBe(false);
    release();
    expect(await body).toBe(JSON.stringify({ task_id: "job-owner" }));
  });

  it("blocks unavailable model before credentials", async () => {
    mocks.registry.find((provider) => provider.id === "openai").models[0].routingUnavailableReason = "Unavailable";
    const result = await handleNativeProvider(request("http://local/v1/realtime/client_secrets?model=openai/gpt-realtime"), "openai", "/v1/realtime/client_secrets");
    expect(result.status).toBe(400); expect(mocks.credentials).not.toHaveBeenCalled();
  });

  it("denies exhausted daily key before native inference dispatch", async () => {
    mocks.getApiKeyUsageLimitStatus.mockResolvedValueOnce({ exceeded: true });
    const result = await handleNativeProvider(request("http://local/v1/native/openai/chat/completions?model=openai/gpt-realtime", { model: "openai/gpt-realtime", messages: [] }), "openai", "/v1/chat/completions");
    expect(result.status).toBe(429);
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("records native image inference without fabricating token usage or free cost", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ base_resp: { status_code: 0 } }), { headers: { "content-type": "application/json" } }));
    const result = await handleNativeProvider(request("http://local/v1/native/minimax/v1/image_generation?model=minimax/H3", { model: "minimax/H3", prompt: "draw" }), "minimax", "/v1/image_generation");
    await result.text();
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ tokens: {}, cost: null, costStatus: "unknown", costSource: "provider-cost-unavailable", nativeUnits: {} }));
  });

  it("preserves provider TTS token components without estimating from input text", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ base_resp: { status_code: 0 }, data: { status: 2 }, usage: { input_tokens: 3, output_tokens: 5, output_tokens_details: { audio_tokens: 4, text_tokens: 1 } } }), { headers: { "content-type": "application/json" } }));
    const result = await handleNativeProvider(request("http://local/v1/native/minimax/v1/t2a_v2?model=minimax/H3", { model: "minimax/H3", text: "speak" }), "minimax", "/v1/t2a_v2");
    await result.text();
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ tokens: { input_tokens: 3, output_tokens: 5, output_tokens_details: { audio_tokens: 4, text_tokens: 1 } }, cost: null, costStatus: "unknown" }));
  });

  it("does not charge a native provider failure envelope returned with HTTP 200", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ base_resp: { status_code: 1000 }, usage: { input_tokens: 3, output_tokens: 5 } }));
    const result = await handleNativeProvider(request("http://local/v1/native/minimax/v1/t2a_v2?model=minimax/H3", { model: "minimax/H3", text: "speak" }), "minimax", "/v1/t2a_v2");
    await result.text();
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });

  it("rejects malformed native model field arrays before upstream dispatch", async () => {
    const result = await handleNativeProvider(request("http://local/v1/native/openai/live/sessions?model=openai/gpt-live-1", { session: { model: "openai/gpt-live-1" }, tools: {} }), "openai", "/v1/live/sessions");
    expect(result.status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed native batch model fields before upstream dispatch", async () => {
    const result = await handleNativeProvider(request("http://local/v1/native/anthropic/v1/messages/batches?model=anthropic/claude-haiku-4-5", { requests: {} }), "anthropic", "/v1/messages/batches");
    expect(result.status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("uses MiniMax Anthropic x-api-key auth", async () => {
    const result = await handleNativeProvider(request("http://local/v1/native/minimax/anthropic/v1/messages?model=minimax/M3", { messages: [] }), "minimax", "/anthropic/v1/messages");
    expect(result.status).toBe(200); expect(mocks.fetch.mock.calls[0][1].headers.get("x-api-key")).toBe("vendor");
    expect(mocks.fetch.mock.calls[0][1].headers.get("authorization")).toBeNull();
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
  it.each([
    ["openai", "/v1/responses", { model: "openai/gpt-4.1", input: "x", background: true }],
    ["anthropic", "/v1/messages/batches", { model: "anthropic/claude-haiku-4-5", requests: [] }],
  ])("denies capped %s delegated inference before provider dispatch", async (provider, operation, body) => {
    mocks.getApiKeyByKey.mockResolvedValueOnce({ dailyLimitTokens: 100, policy: {} });
    const result = await handleNativeProvider(request(`http://local/v1/native/${provider}${operation}`, body), provider, operation);
    expect(result.status).toBe(403);
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
