import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;

const localDbMocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: localDbMocks.getProviderConnectionById,
  updateProviderConnection: localDbMocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: vi.fn(),
}));

describe("OmniRoute simple/default provider validation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("validates GigaChat keys by exchanging the saved authorization key first", async () => {
    const fetchSpy = vi.fn(async (url, options = {}) => {
      if (String(url).includes("/api/v2/oauth")) {
        expect(options.headers.Authorization).toBe("Basic basic-secret");
        expect(options.body.get("scope")).toBe("GIGACHAT_API_PERS");
        return new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
      }
      if (String(url).includes("/api/v1/models")) {
        expect(options.headers.Authorization).toBe("Bearer access-token");
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    global.fetch = fetchSpy;

    const { POST } = await import("../../src/app/api/providers/validate/route.js");
    const res = await POST(new Request("https://durindoor.local/api/providers/validate", {
      method: "POST",
      body: JSON.stringify({ provider: "gigachat", apiKey: "basic-secret" }),
    }));

    await expect(res.json()).resolves.toEqual({ valid: true, error: null });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("uses explicit modelsUrl for generic OpenAI-compatible provider validation", async () => {
    global.fetch = vi.fn(async (url, options = {}) => {
      expect(String(url)).toBe("https://api.freeaiapikey.com/v1/models");
      expect(options.headers.Authorization).toBe("Bearer faik-secret");
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    const { POST } = await import("../../src/app/api/providers/validate/route.js");
    const res = await POST(new Request("https://durindoor.local/api/providers/validate", {
      method: "POST",
      body: JSON.stringify({ provider: "freeaiapikey", apiKey: "faik-secret" }),
    }));

    await expect(res.json()).resolves.toEqual({ valid: true, error: null });
  });

  it("supports dashboard connection tests for registry OpenAI-compatible providers", async () => {
    localDbMocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-crof",
      provider: "crof",
      authType: "apikey",
      apiKey: "crof-secret",
      defaultModel: "deepseek-v4-pro",
      providerSpecificData: {},
    });
    global.fetch = vi.fn(async (url, options = {}) => {
      expect(String(url)).toBe("https://crof.ai/v1/models");
      expect(options.headers.Authorization).toBe("Bearer crof-secret");
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    const result = await testSingleConnection("conn-crof");

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(localDbMocks.updateProviderConnection).toHaveBeenCalledWith("conn-crof", expect.objectContaining({
      testStatus: "active",
      lastError: null,
    }));
  });

  it("validates dashboard GigaChat connection tests through the token flow", async () => {
    localDbMocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-giga",
      provider: "gigachat",
      authType: "apikey",
      apiKey: "basic-secret",
      defaultModel: "GigaChat-2-Max",
      providerSpecificData: {},
    });
    const fetchSpy = vi.fn(async (url, options = {}) => {
      if (String(url).includes("/api/v2/oauth")) {
        expect(options.headers.Authorization).toBe("Basic basic-secret");
        return new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
      }
      if (String(url).includes("/api/v1/models")) {
        expect(options.headers.Authorization).toBe("Bearer access-token");
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    global.fetch = fetchSpy;

    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    const result = await testSingleConnection("conn-giga");

    expect(result.valid).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
