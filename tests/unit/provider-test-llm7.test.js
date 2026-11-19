import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.fn();
proxyAwareFetch.mockImplementation(async () => ({ ok: true, status: 200, text: async () => "{}", json: async () => ({}) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

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

function connection(provider = "llm7") {
  return {
    id: `connection-${provider}`,
    provider,
    authType: "apikey",
    apiKey: "llm7-key",
    providerSpecificData: {},
  };
}

async function runTest(provider, fetchImpl) {
  mocks.getProviderConnectionById.mockResolvedValue(connection(provider));
  proxyAwareFetch.mockImplementation(fetchImpl);
  const { testSingleConnection } = await import(
    "../../src/app/api/providers/[id]/test/testUtils.js"
  );
  const result = await testSingleConnection(`connection-${provider}`);
  return { result, proxyAwareFetch };
}

describe("LLM7 provider connection test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proxyAwareFetch.mockImplementation(async () => ({ ok: true, status: 200, text: async () => "{}", json: async () => ({}) }));
    mocks.updateProviderConnection.mockResolvedValue(undefined);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      vercelRelayUrl: "",
    });
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
  });

  it("probes registry validateUrl with Bearer authentication", async () => {
    const { result, proxyAwareFetch: fetchSpy } = await runTest("llm7", async (url, options) => {
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
    const { result, proxyAwareFetch: fetchSpy } = await runTest("llm7", async () =>
      new Response("", { status: 401 }),
    );

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid API key");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("uses bounded registry fallback after LLM7 validation endpoint errors", async () => {
    const { result, proxyAwareFetch: fetchSpy } = await runTest("llm7", async (url, options) => {
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

  it("surfaces a timed-out fallback request as an unavailable error", async () => {
    const timeout = new DOMException("The operation was aborted", "TimeoutError");
    const { result, proxyAwareFetch: fetchSpy } = await runTest("llm7", async () => {
      throw timeout;
    });

    // 4d84b4d5: the fallback is still attempted, but the raw timeout text
    // stays off the result. Outage is unavailable, not a rejected key.
    expect(result.valid).toBe(false);
    expect(result.unavailable).toBe(true);
    expect(result.error).toBe("Provider unavailable - network request failed");
    expect(result.error).not.toBe(timeout.message);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not accept a malformed non-auth fallback body as a valid key", async () => {
    const { result, proxyAwareFetch: fetchSpy } = await runTest("llm7", async (url) => {
      if (String(url).endsWith("/models")) {
        return new Response("502 Bad Gateway", { status: 502 });
      }
      return new Response("<html>oops</html>", { status: 400, headers: { "content-type": "text/html" } });
    });

    // 4d84b4d5: HTTP 400 on the chat fallback is not proof the key works,
    // and it is not an outage. The models 502 still falls through.
    expect(result.valid).toBe(false);
    expect(result.unavailable).not.toBe(true);
    expect(result.error).toBe("Provider validation failed (HTTP 400)");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not change another registry provider's request", async () => {
    const { result, proxyAwareFetch: fetchSpy } = await runTest("ai21", async (url, options) => {
      expect(String(url)).toBe("https://api.ai21.com/studio/v1/models");
      expect(options.headers.Authorization).toBe("Bearer llm7-key");
      return new Response("{}", { status: 200 });
    });

    expect(result.valid).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
