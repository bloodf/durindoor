import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), proxy: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "kimchi/offline-fixture" }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.proxy }));

import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

describe("registry modelsFetcher excludeIdPattern", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.proxy.mockResolvedValue({ source: "offline-direct", disableEnvProxy: true });
  });

  it("drops non-chat logfare models and keeps chat ones", async () => {
    const data = [{ id: "kimi-k3" }, { id: "whisper-large-v3" }, { id: "text-embedding-3-small" }, { id: "tts-1" }, { id: "glm-5.2" }];
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200 }));
    const result = await fetchConnectionModels({ id: "c", provider: "logfare", apiKey: "k" });
    expect(result.models.map((m) => m.id)).toEqual(["kimi-k3", "glm-5.2"]);
  });

  it("leaves other registry fetchers unfiltered", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "whisper-1" }] }), { status: 200 }));
    const result = await fetchConnectionModels({ id: "c", provider: "llmgateway", apiKey: "k" });
    expect(result.models.map((m) => m.id)).toEqual(["whisper-1"]);
  });
});
