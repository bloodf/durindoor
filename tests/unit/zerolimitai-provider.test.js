import { beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: network.fetch }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/offline-fixture",
  updateKimchiUserAgent: vi.fn(async () => "kimchi/offline-fixture"),
}));

import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { APIKEY_PROVIDERS, isRoutableProvider } from "../../src/shared/constants/providers.js";
import { parseModel } from "../../open-sse/services/model.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

const connection = { id: "offline", provider: "zerolimitai", apiKey: "fixture-key" };

beforeEach(() => vi.clearAllMocks());

describe("ZeroLimit AI registry callers", () => {
  it("offers auto and resolves nested discovered model ids without losing their namespace", () => {
    expect(APIKEY_PROVIDERS.zerolimitai).toBeDefined();
    expect(isRoutableProvider("zerolimitai")).toBe(true);
    expect(PROVIDER_MODELS.zerolimitai.map(({ id }) => id)).toEqual(["auto"]);
    expect(parseModel("zerolimitai/qwen/example:free")).toEqual({
      provider: "zerolimitai", model: "qwen/example:free", isAlias: false, providerAlias: "zerolimitai",
    });
  });

  it.each([false, true])("uses the documented www chat endpoint and Bearer auth, stream=%s", (stream) => {
    const executor = new DefaultExecutor("zerolimitai");
    expect(executor.buildUrl("auto", stream)).toBe("https://www.zerolimitai.com/api/v1/chat/completions");
    expect(executor.buildHeaders(connection, stream)).toMatchObject({ Authorization: "Bearer fixture-key" });
    const body = { model: "auto", stream, messages: [{ role: "user", content: "Hello" }] };
    expect(executor.transformRequest("auto", structuredClone(body), stream, connection)).toMatchObject(body);
  });

  it("discovers live ids through the existing authenticated models fetcher", async () => {
    network.fetch.mockResolvedValue(new Response(JSON.stringify({ object: "list", data: [
      { id: "auto", object: "model" }, { id: "qwen/example:free", object: "model" },
    ] })));
    const result = await fetchConnectionModels(connection);
    expect(result.models.map(({ id }) => id)).toEqual(["auto", "qwen/example:free"]);
    expect(network.fetch).toHaveBeenCalledWith("https://www.zerolimitai.com/api/v1/models",
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({ Authorization: "Bearer fixture-key" }) }), {});
  });

  it("reports discovery failure instead of inventing a catalog", async () => {
    network.fetch.mockResolvedValue(new Response('{"error":"upgrade_required"}', { status: 402 }));
    expect(await fetchConnectionModels(connection)).toEqual({ error: "Failed to fetch models: 402", status: 402 });
  });
});
