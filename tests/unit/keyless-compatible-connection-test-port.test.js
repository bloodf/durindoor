import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

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

import { testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";

const originalFetch = global.fetch;

async function probe(provider, apiKey) {
  mocks.getProviderConnectionById.mockResolvedValue({
    id: "conn",
    provider,
    authType: "apikey",
    apiKey,
    providerSpecificData: { baseUrl: "https://gateway.test/v1" },
  });
  const result = await testSingleConnection("conn");
  expect(global.fetch).toHaveBeenCalledTimes(1);
  return { result, headers: new Headers(global.fetch.mock.calls[0][1].headers) };
}

describe("upstream 9router #5490: testing an explicitly keyless compatible connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A stacked gateway rejects any credential header on a keyless endpoint.
    global.fetch = vi.fn(async (_url, options) => {
      const headers = new Headers(options?.headers);
      const credential = headers.get("authorization") ?? headers.get("x-api-key");
      const rejected = credential !== null && credential !== "Bearer saved-key" && credential !== "saved-key";
      return new Response("{}", { status: rejected ? 401 : 200 });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe.each(["openai-compatible-chat-node", "anthropic-compatible-node"])("%s", (provider) => {
    it.each(["", undefined])("sends no credential header when the key is %o", async (apiKey) => {
      const { result, headers } = await probe(provider, apiKey);
      expect(headers.has("authorization")).toBe(false);
      expect(headers.has("x-api-key")).toBe(false);
      expect(result.valid).toBe(true);
    });

    it("keeps the credential headers when a key is saved", async () => {
      const { result, headers } = await probe(provider, "saved-key");
      expect(headers.get("authorization")).toBe("Bearer saved-key");
      expect(headers.get("x-api-key")).toBe(provider.startsWith("anthropic") ? "saved-key" : null);
      expect(result.valid).toBe(true);
    });
  });
});
