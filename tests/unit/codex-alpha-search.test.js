import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { ok: true, apiKeyId: "key", billingEpoch: null },
  policy: null, credentials: null, fetch: vi.fn(), begin: vi.fn(), settle: vi.fn(),
  policyCheck: vi.fn(async () => mocks.policy), lifecycle: vi.fn(() => ({ beginDispatch: mocks.begin, settle: mocks.settle })),
  select: vi.fn(async () => mocks.credentials), mark: vi.fn(), clear: vi.fn(), usage: vi.fn(async (_key, response) => response),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ requireApiKey: true }) }));
vi.mock("@/lib/db/repos/usageRepo.js", () => ({ getBillingEpoch: async () => null }));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: async () => ({ apiKey: "gateway", auth: mocks.auth }),
  getProviderCredentialsWithQuotaPreflight: mocks.select,
  markAccountUnavailable: mocks.mark, clearAccountError: mocks.clear,
}));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: async (value) => ({ provider: value.startsWith("cx/") ? "codex" : "openai", model: value.split("/").slice(1).join("/") }) }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_provider, credential) => credential }));
vi.mock("@/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: mocks.policyCheck, recordApiKeyUsageForResponse: mocks.usage }));
vi.mock("@/shared/services/quotaSelection", () => ({ createQuotaReservationLifecycle: mocks.lifecycle }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));

const { POST } = await import("../../src/app/api/v1/alpha/search/route.js");
const { POST: alias } = await import("../../src/app/backend-api/codex/alpha/search/route.js");
const payload = { id: "request", model: "cx/gpt-5.4", input: [], commands: { search_query: [{ q: "test" }] }, settings: { external_web_access: true }, max_output_tokens: 1000 };
const request = (body = JSON.stringify(payload)) => new Request("http://localhost/v1/alpha/search", { method: "POST", headers: { authorization: "Bearer gateway", "chatgpt-account-id": "injected" }, body });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth = { ok: true, apiKeyId: "key", billingEpoch: null };
  mocks.policy = null;
  mocks.credentials = { authType: "oauth", accessToken: "stored-token", connectionId: "one", providerSpecificData: { accountId: "stored-account", proxyMode: "direct" } };
  mocks.begin.mockResolvedValue({}); mocks.settle.mockResolvedValue({});
  mocks.fetch.mockResolvedValue(Response.json({ encrypted_output: null, output: "result", results: [] }));
  mocks.mark.mockResolvedValue({ shouldFallback: false });
});

describe("Codex Alpha Search routes", () => {
  it.each([POST, alias])("forwards the native request through the selected account", async (handler) => {
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ encrypted_output: null, output: "result", results: [] });
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/alpha/search");
    expect(options.redirect).toBe("error");
    expect(options.headers.Authorization).toBe("Bearer stored-token");
    expect(options.headers["ChatGPT-Account-Id"]).toBe("stored-account");
    expect(JSON.parse(options.body).model).toBe("gpt-5.4");
    expect(mocks.settle).toHaveBeenCalledWith({ success: true, reason: "success" });
    expect(mocks.select).toHaveBeenCalledWith("codex", expect.any(Set), "websearch:codex", { apiKeyId: "key", webSearch: true, modelCandidates: ["gpt-5.4"] });
  });
  it.each(["missing", "invalid"])("denies %s gateway authentication before dispatch", async (reason) => {
    mocks.auth = { ok: false, reason };
    expect((await POST(request())).status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects policy denials and non-Codex models", async () => {
    mocks.policy = new Response(null, { status: 403 });
    expect((await POST(request())).status).toBe(403);
    mocks.policy = null;
    expect((await POST(request(JSON.stringify({ ...payload, model: "openai/gpt" })))).status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects invalid and oversized request bodies", async () => {
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request("x".repeat(1024 * 1024 + 1)))).status).toBe(413);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("fails closed when quota admission fails", async () => {
    mocks.begin.mockRejectedValue(new Error("capacity"));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each([401, 429])("sanitizes upstream %s and releases quota", async (status) => {
    mocks.fetch.mockResolvedValue(new Response("stored-token secret", { status }));
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("stored-token");
    expect(mocks.settle).toHaveBeenCalledWith({ success: false, reason: "upstream_error" });
    expect(mocks.mark).toHaveBeenCalled();
  });
});

it("uses the selected account's strict proxy settings and fails without fallback", async () => {
  mocks.credentials.providerSpecificData = { accountId: "stored-account", strictProxy: true, connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080" };
  mocks.fetch.mockRejectedValue(new Error("proxy failed"));
  expect((await POST(request())).status).toBe(502);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.fetch.mock.calls[0][2]).toMatchObject({ strictProxy: true, connectionProxyUrl: "http://proxy.invalid:8080" });
  expect(mocks.settle).toHaveBeenCalledWith({ success: false, reason: "upstream_error" });
});

it("accepts optional fields in the official request and response", async () => {
  mocks.fetch.mockResolvedValue(Response.json({ output: "result" }));
  expect((await POST(request(JSON.stringify({ id: "s", model: "cx/gpt-5.4", input: "hello" })))).status).toBe(200);
});

it("rejects non-OAuth accounts without dispatch", async () => {
  mocks.credentials.authType = "apikey";
  expect((await POST(request())).status).toBe(403);
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("rejects malformed and oversized upstream responses and releases quota", async () => {
  for (const data of ["not json", JSON.stringify({ output: "x".repeat(4 * 1024 * 1024 + 1) })]) {
    mocks.fetch.mockResolvedValueOnce(new Response(data));
    expect((await POST(request())).status).toBe(502);
  }
  expect(mocks.settle).toHaveBeenCalledTimes(2);
});

it("does not send unsupported cache fields or caller identity headers", async () => {
  await POST(request(JSON.stringify({ ...payload, prompt_cache_key: "cache", prompt_cache_retention: "24h" })));
  const options = mocks.fetch.mock.calls[0][1];
  expect(JSON.parse(options.body)).not.toHaveProperty("prompt_cache_key");
  expect(JSON.parse(options.body)).not.toHaveProperty("prompt_cache_retention");
  expect(options.headers).not.toHaveProperty("x-connection-id");
});

it("uses real proxy enforcement when strict egress has no proxy", async () => {
  const { proxyAwareFetch } = await vi.importActual("open-sse/utils/proxyFetch.js");
  mocks.fetch.mockImplementationOnce(proxyAwareFetch);
  mocks.credentials.providerSpecificData = { accountId: "stored-account", strictProxy: true, disableEnvProxy: true };
  expect((await POST(request())).status).toBe(502);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.settle).toHaveBeenCalledWith({ success: false, reason: "upstream_error" });
});

it("routes /v1 through the existing versioned rewrite", async () => {
  const { default: config } = await import("../../next.config.mjs");
  const rewrites = await config.rewrites();
  expect(rewrites).toContainEqual({ source: "/v1/:path*", destination: "/api/v1/:path*" });
});


it("isolates search cooldowns while preserving model policy and quota identity", async () => {
  mocks.auth.billingEpoch = "admission-epoch";
  const req = request();
  expect((await POST(req)).status).toBe(200);
  expect(mocks.policyCheck).toHaveBeenCalledWith(req, "codex/gpt-5.4", "gateway");
  expect(mocks.lifecycle).toHaveBeenCalledWith(expect.objectContaining({ routeKey: "codex/gpt-5.4" }));
  expect(mocks.usage).toHaveBeenCalledWith("gateway", expect.any(Response), expect.objectContaining({ apiKeyId: "key", billingEpoch: "admission-epoch" }));
  expect(mocks.select).toHaveBeenCalledWith("codex", expect.any(Set), "websearch:codex", { apiKeyId: "key", webSearch: true, modelCandidates: ["gpt-5.4"] });
  expect(mocks.clear).toHaveBeenCalledWith("one", mocks.credentials, "websearch:codex", { provider: "codex", webSearch: true, credentialFingerprint: null, dispatchedAt: expect.any(Number) });
  expect(mocks.mark).not.toHaveBeenCalled();
  mocks.fetch.mockResolvedValueOnce(new Response("failed", { status: 429 }));
  expect((await POST(request())).status).toBe(429);
  expect(mocks.mark).toHaveBeenCalledWith("one", 429, "Codex search failed", "codex", "websearch:codex", null, { usedCredential: "stored-token", webSearch: true, credentialFingerprint: null, dispatchedAt: expect.any(Number) });
  expect(mocks.clear).toHaveBeenCalledTimes(1);
});
