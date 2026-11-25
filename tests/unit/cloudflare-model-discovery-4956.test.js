import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxy: vi.fn(async () => ({ connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.fixture", strictProxy: true })),
  fetch: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.proxy }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));

const { fetchConnectionModels } = await import("../../src/app/api/providers/[id]/models/fetchConnectionModels.js");
const { clearLiveModelLimitsCache, resolveLiveCloudflareModels } = await import("../../open-sse/services/liveModelLimits.js");
const { isModelAutoSyncEligible } = await import("../../src/lib/modelAutoSync/runner.js");
const { canDiscoverModels } = await import("../../src/lib/providerRouteHandlers.js");

const connection = {
  id: "fixture", provider: "cloudflare-ai", apiKey: "fixture-token",
  providerSpecificData: { accountId: "fixture-account" },
};
const page = (result, extra = {}) => Response.json({ success: true, errors: [], result, ...extra });
const entry = (name, task) => ({ id: `uuid-${name}`, name, ...(task ? { task: { name: task } } : null) });

describe("9router #4956 Cloudflare Workers AI model discovery", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    // Anything that bypasses the mocked transport must fail instead of reaching Cloudflare.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline test"); }));
    clearLiveModelLimitsCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists chat and image models by inference id through the connection proxy", async () => {
    mocks.fetch.mockResolvedValue(page([
      entry("@cf/meta/llama-3.3-70b-instruct", "Text Generation"),
      entry("@cf/black-forest-labs/flux-2-dev", "Text-to-Image"),
      entry("@cf/baai/bge-base-en-v1.5", "Text Embeddings"),
      entry("@cf/openai/whisper", "Automatic Speech Recognition"),
      entry("@cf/meta/m2m100-1.2b", "Translation"),
      // No task: the id and the static catalog kind decide.
      entry("@hf/vendor/untasked-chat"),
      entry("@cf/baai/bge-m3"),
      { id: "uuid-only", name: "Not routable" },
    ]));
    const result = await fetchConnectionModels(connection);

    expect(result.models.map(({ id, kind }) => [id, kind])).toEqual([
      ["@cf/meta/llama-3.3-70b-instruct", "llm"],
      ["@cf/black-forest-labs/flux-2-dev", "image"],
      ["@hf/vendor/untasked-chat", "llm"],
    ]);
    expect(result.warning).toBeUndefined();
    const [url, init, proxy] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/fixture-account/ai/models/search?page=1&per_page=100");
    expect(init.headers.Authorization).toBe("Bearer fixture-token");
    expect(proxy.strictProxy).toBe(true);
  });

  it("follows pagination and accepts a routing id in the id field", async () => {
    mocks.fetch
      .mockResolvedValueOnce(page([{ id: "@cf/vendor/first", name: "First model" }], { result_info: { total_pages: 2 } }))
      .mockResolvedValueOnce(page([entry("@cf/vendor/second")], { result_info: { total_pages: 2 } }));
    const result = await fetchConnectionModels(connection);

    expect(result.models.map(({ id, name }) => [id, name])).toEqual([["@cf/vendor/first", "First model"], ["@cf/vendor/second", "Second"]]);
    expect(mocks.fetch.mock.calls[1][0]).toContain("page=2");
  });

  it.each([
    ["an HTTP error", () => new Response("denied", { status: 403 }), "403"],
    ["API errors on HTTP 200", () => Response.json({ success: false, errors: [{ message: "denied" }] }), "API error"],
    ["an oversized catalog", () => page([entry("@cf/vendor/a")], { result_info: { total_pages: 21 } }), "20 pages"],
    ["an empty catalog", () => page([]), "no supported"],
  ])("falls back to the static catalog on %s", async (_label, respond, reason) => {
    mocks.fetch.mockImplementation(async () => respond());
    const result = await fetchConnectionModels(connection);

    expect(result.models.map(({ id }) => id)).toContain("@cf/zai-org/glm-5.3");
    expect(result.warning).toContain(reason);
    expect(result.source).toBe("local_catalog");
    expect(result.degraded).toBe(true);
  });

  it("encodes the account id and does not fetch without one", async () => {
    mocks.fetch.mockResolvedValue(page([entry("@cf/vendor/a")]));
    await fetchConnectionModels({ ...connection, providerSpecificData: { accountId: "account/other" } });
    expect(mocks.fetch.mock.calls[0][0]).toContain("/accounts/account%2Fother/ai/");

    mocks.fetch.mockClear();
    await expect(fetchConnectionModels({ ...connection, providerSpecificData: {} })).resolves.toMatchObject({ status: 400 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("offers discovery only with a token and account id, and stays out of auto-sync", () => {
    expect(canDiscoverModels(connection)).toBe(true);
    expect(canDiscoverModels({ ...connection, providerSpecificData: {} })).toBe(false);
    expect(canDiscoverModels({ ...connection, apiKey: "" })).toBe(false);
    expect(isModelAutoSyncEligible("cloudflare-ai")).toBe(false);
  });

  it("matches live context limits to inference ids, not Cloudflare's internal ids", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page([{
      ...entry("@cf/zai-org/glm-5.3", "Text Generation"),
      properties: [{ property_id: "context_window", value: "262144" }],
    }])));
    const live = await resolveLiveCloudflareModels(connection);

    expect(live.models).toEqual([{ id: "@cf/zai-org/glm-5.3", capabilities: { contextWindow: 262144 } }]);
  });
});
