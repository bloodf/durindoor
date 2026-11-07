import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Gitlawb GMI validates with a minimal chat request rather than a GET-only
// catalog probe. The source `/v1/gmi-cloud` prefix must survive DurinDoor's
// full-endpoint registry convention.
const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/models", () => ({ getProviderConnections: mocks.getProviderConnections }));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    vercelRelayUrl: "",
  }),
}));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));

const originalFetch = global.fetch;

describe("baseUrl-only API-key provider connection test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() => { throw new Error("Unexpected network request"); });
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-glb",
      provider: "gitlawb-gmi",
      apiKey: "glb-test-key",
      authType: "apikey",
      priority: 1,
      providerSpecificData: {},
    });
    mocks.updateProviderConnection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("probes gitlawb-gmi baseUrl when no validateUrl exists", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url, options) => {
      expect(String(url)).toBe("https://opengateway.gitlawb.com/v1/gmi-cloud/chat/completions");
      expect(options.headers.Authorization).toBe("Bearer glb-test-key");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body).model).toBe("XiaomiMiMo/MiMo-V2.5-Pro");
      return new Response("", { status: 200 });
    });

    const { testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const result = await testSingleConnection("conn-glb");

    expect(result.valid).toBe(true);
    expect(result.error).not.toBe("Provider test not supported");
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("conn-glb", expect.objectContaining({ testStatus: "active", lastError: null }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps runtime and model discovery on the source gmi-cloud prefix", async () => {
    const [{ PROVIDERS }, { APIKEY_PROVIDERS }, { DefaultExecutor }] = await Promise.all([
      import("../../open-sse/config/providers.js"),
      import("../../src/shared/constants/providers.js"),
      import("../../open-sse/executors/default.js"),
    ]);

    expect(PROVIDERS["gitlawb-gmi"].baseUrl).toBe(
      "https://opengateway.gitlawb.com/v1/gmi-cloud/chat/completions",
    );
    expect(PROVIDERS["gitlawb-gmi"].modelsUrl).toBe(
      "https://opengateway.gitlawb.com/v1/gmi-cloud/models",
    );
    expect(APIKEY_PROVIDERS["gitlawb-gmi"].modelsFetcher).toEqual({
      url: "https://opengateway.gitlawb.com/v1/gmi-cloud/models",
      type: "openai",
    });
    expect(new DefaultExecutor("gitlawb-gmi").buildUrl("unused", true, 0, {})).toBe(
      "https://opengateway.gitlawb.com/v1/gmi-cloud/chat/completions",
    );
  });

  it.each([
    [200, true, null],
    [400, true, null],
    [422, true, null],
    [429, true, null],
    [401, false, "Invalid API key"],
    [403, false, "Invalid API key"],
    [404, false, "Provider validation endpoint not found"],
    [500, false, "Provider unavailable - try again later"],
  ])("classifies source chat-probe status %i as valid=%s", async (status, valid, error) => {
    const { probeRegistryProvider } = await import(
      "../../src/app/api/providers/providerProbe.js"
    );
    const result = await probeRegistryProvider(
      "gitlawb-gmi",
      "glb-test-key",
      async () => new Response("", { status }),
    );
    expect(result).toEqual({ valid, status, ...(error ? { error } : {}) });
    expect(JSON.stringify(result)).not.toContain("glb-test-key");
  });

  it("reports network failures as unavailable without leaking credentials", async () => {
    const { probeRegistryProvider } = await import(
      "../../src/app/api/providers/providerProbe.js"
    );
    const result = await probeRegistryProvider(
      "gitlawb-gmi",
      "glb-test-key",
      async () => {
        throw new Error("network failure for glb-test-key");
      },
    );

    expect(result).toEqual({
      valid: false,
      status: null,
      unavailable: true,
      error: "Provider unavailable - network request failed",
    });
    expect(JSON.stringify(result)).not.toContain("glb-test-key");
  });

  it.each([
    [401, "Invalid API key"],
    [403, "Invalid API key"],
    [404, "Provider validation endpoint not found"],
    [500, "Provider unavailable - try again later"],
  ])("propagates status %i without mislabeling the failure", async (status, error) => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status }));

    const [{ testSingleConnection }, { POST }] = await Promise.all([
      import("../../src/app/api/providers/[id]/test/testUtils.js"),
      import("../../src/app/api/providers/validate/route.js"),
    ]);

    const connectionResult = await testSingleConnection("conn-glb");
    expect(connectionResult).toMatchObject({ valid: false, error, ...(status >= 500 ? { unavailable: true } : {}) });
    if (status >= 500) {
      expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
    } else {
      expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
        "conn-glb",
        expect.objectContaining({ testStatus: "error", lastError: error }),
      );
    }

    const response = await POST(new Request("http://localhost/api/providers/validate", {
      method: "POST",
      body: JSON.stringify({ provider: "gitlawb-gmi", apiKey: "glb-test-key" }),
    }));
    expect(await response.json()).toEqual({ valid: false, error, ...(status >= 500 ? { unavailable: true } : {}) });
  });

  it.each([
    [500, { valid: false, skipped: false, unavailable: true, error: "Provider unavailable - try again later", refreshed: false }, null],
    [502, { valid: false, skipped: false, unavailable: true, error: "Provider unavailable - try again later", refreshed: false }, null],
    [504, { valid: false, skipped: false, unavailable: true, error: "Provider unavailable - try again later", refreshed: false }, null],
    [503, { valid: false, skipped: false, unavailable: true, error: "Provider unavailable - try again later", refreshed: false }, null],
    [401, { valid: false, skipped: false, error: "Invalid API key", refreshed: false }, "error"],
    [403, { valid: false, skipped: false, error: "Invalid API key", refreshed: false }, "error"],
    [200, { valid: true, skipped: false, error: null, refreshed: false }, "active"],
  ])("preserves saved connection semantics for HTTP %i", async (status, expected, storedStatus) => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status }));
    const { POST } = await import("../../src/app/api/providers/[id]/test/route.js");
    const response = await POST(new Request("http://localhost/api/providers/conn-glb/test", { method: "POST" }), { params: Promise.resolve({ id: "conn-glb" }) });
    expect(await response.json()).toEqual(expected);
    if (storedStatus === null) expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
    else expect(mocks.updateProviderConnection).toHaveBeenCalledWith("conn-glb", expect.objectContaining({ testStatus: storedStatus, lastError: expected.error }));
  });
  it("preserves saved readiness when the real probe reports a network failure with null status", async () => {
    global.fetch = vi.fn(async () => { throw new Error("network failure for glb-test-key"); });
    const { POST } = await import("../../src/app/api/providers/[id]/test/route.js");
    const response = await POST(new Request("http://localhost/api/providers/conn-glb/test", { method: "POST" }), { params: Promise.resolve({ id: "conn-glb" }) });
    expect(await response.json()).toEqual({ valid: false, skipped: false, unavailable: true, error: "Provider unavailable - network request failed", refreshed: false });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([null, 500, 502, 503, 504, 401, 403])("runs the batch caller through the real probe for status %s", async (status) => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "conn-glb", provider: "gitlawb-gmi", authType: "apikey" }]);
    global.fetch = vi.fn(async () => {
      if (status === null) throw new Error("offline");
      return new Response("", { status });
    });
    const { POST } = await import("../../src/app/api/providers/test-batch/route.js");
    const response = await POST(new Request("http://localhost/api/providers/test-batch", { method: "POST", body: JSON.stringify({ mode: "all" }) }));
    const body = await response.json();
    const unavailable = status === null || status >= 500;
    expect(body.summary).toEqual({ total: 1, passed: 0, failed: unavailable ? 0 : 1, skipped: 0, unavailable: unavailable ? 1 : 0 });
    expect(body.results[0]).toMatchObject({ valid: false, unavailable, error: unavailable ? status === null ? "Provider unavailable - network request failed" : "Provider unavailable - try again later" : "Invalid API key" });
    if (unavailable) expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
    else expect(mocks.updateProviderConnection).toHaveBeenCalledWith("conn-glb", expect.objectContaining({ testStatus: "error", lastError: "Invalid API key" }));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["single", "batch"])("persists malformed saved ChatGPT cookies as errors through %s", async (caller) => {
    const connection = { id: "conn-glb", provider: "chatgpt-web", apiKey: "foo=bar; theme=dark", authType: "cookie", providerSpecificData: {} };
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.getProviderConnections.mockResolvedValue([connection]);
    const { probeRegistryProvider } = await import("../../src/app/api/providers/providerProbe.js");
    const probe = await probeRegistryProvider(connection.provider, connection.apiKey);
    expect(probe).toEqual({ valid: false, status: null, error: "No __Secure-next-auth.session-token cookie found in the pasted value" });
    const { POST } = caller === "single" ? await import("../../src/app/api/providers/[id]/test/route.js") : await import("../../src/app/api/providers/test-batch/route.js");
    const response = await POST(new Request("http://localhost/api/providers/test", { method: "POST", body: JSON.stringify({ mode: "all" }) }), { params: Promise.resolve({ id: connection.id }) });
    const body = await response.json();
    expect(caller === "single" ? body : body.results[0]).toMatchObject({ valid: false, error: probe.error });
    expect((caller === "single" ? body : body.results[0]).unavailable).not.toBe(true);
    if (caller === "batch") expect(body.summary).toEqual({ total: 1, passed: 0, failed: 1, skipped: 0, unavailable: 0 });
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(connection.id, expect.objectContaining({ testStatus: "error", lastError: probe.error }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(["network", "blocked"])("distinguishes %s null-status ChatGPT probes in saved callers", async (failure) => {
    const connection = { id: "conn-glb", provider: "chatgpt-web", apiKey: "__Secure-next-auth.session-token=test-session", authType: "cookie", providerSpecificData: {} };
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.getProviderConnections.mockResolvedValue([connection]);
    const { OutboundUrlGuardError } = await import("../../open-sse/utils/outboundUrlGuard.js");
    global.fetch = vi.fn(async () => { throw failure === "blocked" ? new OutboundUrlGuardError("Blocked test URL", { code: "OUTBOUND_URL_GUARD_BLOCKED", url: "https://chatgpt.com/api/auth/session" }) : new Error("offline"); });
    const { probeRegistryProvider } = await import("../../src/app/api/providers/providerProbe.js");
    const probe = await probeRegistryProvider(connection.provider, connection.apiKey);
    expect(probe).toMatchObject({ valid: false, status: null, ...(failure === "blocked" ? { blocked: true } : { unavailable: true }) });
    const { POST } = await import("../../src/app/api/providers/test-batch/route.js");
    const response = await POST(new Request("http://localhost/api/providers/test-batch", { method: "POST", body: JSON.stringify({ mode: "all" }) }));
    const body = await response.json();
    const unavailable = failure === "network";
    expect(body.results[0]).toMatchObject({ valid: false, unavailable, error: probe.error });
    expect(body.summary).toEqual({ total: 1, passed: 0, failed: unavailable ? 0 : 1, skipped: 0, unavailable: unavailable ? 1 : 0 });
    if (unavailable) expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
    else expect(mocks.updateProviderConnection).toHaveBeenCalledWith(connection.id, expect.objectContaining({ testStatus: "error", lastError: probe.error }));
  });

});
