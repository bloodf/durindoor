import { describe, expect, it, vi, afterEach } from "vitest";
import {
  testSingleConnection,
  resolveLocalOpenAICompatibleBaseUrl,
} from "../../src/app/api/providers/[id]/test/testUtils.js";

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: vi.fn(() => Promise.resolve({ ok: true })),
}));

import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

const originalFetch = global.fetch;

describe("local OpenAI-compatible providers connection test", () => {
  afterEach(() => {
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  it("resolves default and override base URLs for the local set", () => {
    expect(resolveLocalOpenAICompatibleBaseUrl({ provider: "lm-studio" })).toBe(
      "http://localhost:1234/v1"
    );
    expect(
      resolveLocalOpenAICompatibleBaseUrl({
        provider: "llama-cpp",
        providerSpecificData: { baseUrl: "http://127.0.0.1:8080/v1" },
      })
    ).toBe("http://127.0.0.1:8080/v1");
    expect(
      resolveLocalOpenAICompatibleBaseUrl({
        provider: "vllm",
        baseUrl: "http://host:8000/v1/chat/completions",
      })
    ).toBe("http://host:8000/v1");
    expect(resolveLocalOpenAICompatibleBaseUrl({ provider: "openai" })).toBeNull();
  });

  it("returns valid for every local OpenAI-compatible provider when /models responds 200", async () => {
    const localIds = [
      "9router",
      "lm-studio",
      "vllm",
      "lemonade",
      "llamafile",
      "llama-cpp",
      "triton",
      "docker-model-runner",
      "xinference",
      "oobabooga",
    ];

    const fetchCalls = [];
    global.fetch = vi.fn((url, options) => {
      fetchCalls.push({ url, options });
      return Promise.resolve({ ok: true, status: 200 });
    });

    for (const provider of localIds) {
      getProviderConnectionById.mockResolvedValue({
        id: provider,
        provider,
        apiKey: "",
        authType: "apikey",
        providerSpecificData: {},
      });
      updateProviderConnection.mockResolvedValue({});
      resolveConnectionProxyConfig.mockResolvedValue({});

      const result = await testSingleConnection(provider);
      expect(result.valid, `${provider} should be valid`).toBe(true);
      expect(result.error).toBeNull();
    }

    const modelsCalls = fetchCalls.filter((c) => c.url.endsWith("/models"));
    expect(modelsCalls.length).toBeGreaterThanOrEqual(localIds.length);
    for (const call of modelsCalls) {
      expect(call.options?.headers || {}).not.toHaveProperty("Authorization");
    }
  });

  it("falls back to POST /chat/completions when /models fails and sends bearer when apiKey is set", async () => {
    global.fetch = vi.fn((url) => {
      if (url.endsWith("/models")) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      return Promise.resolve({ ok: true, status: 200 });
    });

    getProviderConnectionById.mockResolvedValue({
      id: "vllm",
      provider: "vllm",
      apiKey: "test-key",
      authType: "apikey",
      providerSpecificData: {},
    });
    updateProviderConnection.mockResolvedValue({});

    const result = await testSingleConnection("vllm");
    expect(result.valid).toBe(true);

    const chatCall = global.fetch.mock.calls.find((c) =>
      c[0].endsWith("/chat/completions")
    );
    expect(chatCall).toBeTruthy();
    expect(chatCall[1].headers.Authorization).toBe("Bearer test-key");
  });

  it("returns invalid API key for 401 on /models", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 401 }));

    getProviderConnectionById.mockResolvedValue({
      id: "lm-studio",
      provider: "lm-studio",
      apiKey: "bad",
      authType: "apikey",
      providerSpecificData: {},
    });
    updateProviderConnection.mockResolvedValue({});

    const result = await testSingleConnection("lm-studio");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid API key");
  });
});
