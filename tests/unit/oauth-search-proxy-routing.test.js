import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.hoisted(() => vi.fn());

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

import { handleSearchCore } from "../../open-sse/handlers/search/index.js";

const xaiProvider = {
  id: "xai",
  searchViaChat: { defaultModel: "grok-test" },
};

function successfulSearchResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      output: [{
        content: [{
          text: "answer",
          annotations: [{ url: "https://example.com", title: "Example" }],
        }],
      }],
      usage: { total_tokens: 7 },
    }),
  };
}

describe("OAuth web-search proxy routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes xAI search through the resolved strict OAuth pool", async () => {
    proxyAwareFetch.mockResolvedValue(successfulSearchResponse());

    const result = await handleSearchCore({
      body: { query: "durindoor" },
      provider: xaiProvider,
      credentials: {
        accessToken: "xai-token",
        providerSpecificData: {
          oauthProxy: { mode: "strict-pool", poolId: "pool-1" },
          connectionProxyPoolId: "pool-1",
          connectionProxyEnabled: true,
          connectionProxyUrl: "http://proxy.internal:8080",
          strictProxy: true,
          disableEnvProxy: true,
        },
      },
    });

    expect(result.success).toBe(true);
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      expect.stringContaining("api.x.ai"),
      expect.objectContaining({ method: "POST" }),
      expect.objectContaining({
        proxyMode: "strict-pool",
        proxyPoolId: "pool-1",
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://proxy.internal:8080",
        strictProxy: true,
        disableEnvProxy: true,
      })
    );
  });

  it("suppresses ambient and stale configured proxies for direct OAuth search", async () => {
    proxyAwareFetch.mockResolvedValue(successfulSearchResponse());

    const result = await handleSearchCore({
      body: { query: "durindoor" },
      provider: xaiProvider,
      credentials: {
        accessToken: "xai-token",
        providerSpecificData: {
          oauthProxy: { mode: "direct" },
          connectionProxyEnabled: true,
          connectionProxyUrl: "http://stale-proxy.internal:8080",
        },
      },
    });

    expect(result.success).toBe(true);
    expect(proxyAwareFetch.mock.calls[0][2]).toMatchObject({
      proxyMode: "direct",
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      strictProxy: false,
      disableEnvProxy: true,
    });
  });

  it("redacts proxy credentials from xAI search transport errors", async () => {
    proxyAwareFetch.mockRejectedValue(
      new Error("connect failed via http://alice:secret@proxy.internal:8080")
    );
    const error = vi.fn();

    const result = await handleSearchCore({
      body: { query: "durindoor" },
      provider: xaiProvider,
      credentials: {
        accessToken: "xai-token",
        providerSpecificData: { oauthProxy: { mode: "direct" } },
      },
      log: { error },
    });

    expect(result.success).toBe(false);
    const output = `${result.error} ${JSON.stringify(error.mock.calls)}`;
    expect(output).not.toContain("alice");
    expect(output).not.toContain("secret");
    expect(output).toContain("[redacted]");
  });
});
