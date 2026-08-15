import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));
vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: mocks.testProxyUrl,
}));

const originalFetch = global.fetch;

function connection(provider = "llm7") {
  return {
    id: `connection-${provider}`,
    provider,
    authType: "apikey",
    apiKey: "llm7-key",
    providerSpecificData: {},
  };
}

async function testConnection(provider, fetchImpl) {
  mocks.getProviderConnectionById.mockResolvedValue(connection(provider));
  const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(fetchImpl);
  const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
  return { result: await testSingleConnection(`connection-${provider}`), fetchSpy };
}

describe("LLM7 provider connection test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(undefined);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      vercelRelayUrl: "",
    });
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("probes registry validateUrl with Bearer authentication", async () => {
    const { result, fetchSpy } = await testConnection("llm7", async (url, options) => {
      expect(String(url)).toBe("https://api.llm7.io/v1/models");
      expect(options.headers.Authorization).toBe("Bearer llm7-key");
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.redirect).toBe("manual");
      return new Response("{}", { status: 200 });
    });

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects LLM7 authentication failures without a fallback request", async () => {
    const { result, fetchSpy } = await testConnection("llm7", async () => new Response("", { status: 401 }));

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid API key");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("uses bounded registry fallback after LLM7 validation endpoint errors", async () => {
    const { result, fetchSpy } = await testConnection("llm7", async (url, options) => {
      if (String(url).endsWith("/models")) {
        expect(options.signal).toBeInstanceOf(AbortSignal);
        return new Response("", { status: 500 });
      }
      expect(String(url)).toBe("https://api.llm7.io/v1/chat/completions");
      expect(options.method).toBe("POST");
      expect(options.headers.Authorization).toBe("Bearer llm7-key");
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return new Response("{}", { status: 200 });
    });

    expect(result.valid).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("surfaces a timed-out fallback request as an error", async () => {
    const timeout = new DOMException("The operation was aborted", "TimeoutError");
    const { result, fetchSpy } = await testConnection("llm7", async () => {
      throw timeout;
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe(timeout.message);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not change another registry provider's request", async () => {
    const { result, fetchSpy } = await testConnection("ai21", async (url, options) => {
      expect(String(url)).toBe("https://api.ai21.com/studio/v1/models");
      expect(options.headers.Authorization).toBe("Bearer llm7-key");
      return new Response("{}", { status: 200 });
    });

    expect(result.valid).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
