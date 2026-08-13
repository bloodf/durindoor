import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({ refreshCredentials: vi.fn().mockResolvedValue(null) })),
  hasSpecializedExecutor: vi.fn(() => false),
}));
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: vi.fn().mockResolvedValue(null),
}));

import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";
import { getEmbeddingAdapter } from "../../open-sse/handlers/embeddingProviders/index.js";

const MODEL = "@cf/baai/bge-m3";

describe("Cloudflare embeddings adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends an OpenAI-compatible request and returns the provider vector", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      object: "list",
      data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
      model: MODEL,
      usage: { prompt_tokens: 2, total_tokens: 2 },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const result = await handleEmbeddingsCore({
      body: { model: MODEL, input: "DurinDoor" },
      modelInfo: { provider: "cloudflare-ai", model: MODEL },
      credentials: { apiKey: "test-token", providerSpecificData: { accountId: "account-123" } },
      log: {},
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/account-123/ai/v1/embeddings");
    expect(JSON.parse(init.body)).toMatchObject({ model: MODEL, input: "DurinDoor" });
    expect((await result.response.json()).data[0].embedding).toEqual([0.1, 0.2, 0.3]);
  });
  it("interpolates the account id into the OpenAI-compatible embeddings URL", () => {
    const adapter = getEmbeddingAdapter("cloudflare-ai");

    expect(adapter.buildUrl(MODEL, {
      providerSpecificData: { accountId: "account-123" },
    })).toBe("https://api.cloudflare.com/client/v4/accounts/account-123/ai/v1/embeddings");
  });

  it("fails clearly when accountId is missing", () => {
    const adapter = getEmbeddingAdapter("cloudflare-ai");

    expect(() => adapter.buildUrl(MODEL, { providerSpecificData: {} }))
      .toThrow("cloudflare-ai embeddings require accountId in providerSpecificData");
  });
});
