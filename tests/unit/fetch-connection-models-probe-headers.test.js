import { beforeEach, describe, expect, it, vi } from "vitest";

const routedFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: routedFetch }));
vi.mock("@/shared/constants/providers", async () => {
  const actual = await vi.importActual("@/shared/constants/providers");
  return {
    ...actual,
    AI_PROVIDERS: {
      ...actual.AI_PROVIDERS,
      "xkey-test": { modelsFetcher: { url: "https://x.test/models", type: "openai" } },
      "ua-test": { modelsFetcher: { url: "https://u.test/models", type: "openai" } },
    },
  };
});
vi.mock("open-sse/config/providers.js", async () => {
  const actual = await vi.importActual("open-sse/config/providers.js");
  return {
    ...actual,
    PROVIDERS: {
      ...actual.PROVIDERS,
      "xkey-test": { auth: { combined: true, header: "x-api-key", scheme: "raw" } },
      "ua-test": { headers: { "User-Agent": "Pinned/1.0" } },
    },
  };
});

import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

describe("registry modelsFetcher request headers", () => {
  beforeEach(() => {
    routedFetch.mockReset();
    routedFetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "m1" }] }) });
  });

  it("sends the registry auth header, not Bearer, for x-api-key providers", async () => {
    await fetchConnectionModels({ id: "c", provider: "xkey-test", apiKey: "k1" });
    const headers = routedFetch.mock.calls[0][1].headers;
    expect(headers["x-api-key"]).toBe("k1");
    expect(headers.Authorization).toBeUndefined();
  });

  it("sends pinned transport headers such as User-Agent with the Bearer token", async () => {
    await fetchConnectionModels({ id: "c", provider: "ua-test", apiKey: "k2" });
    const headers = routedFetch.mock.calls[0][1].headers;
    expect(headers["User-Agent"]).toBe("Pinned/1.0");
    expect(headers.Authorization).toBe("Bearer k2");
  });
});
