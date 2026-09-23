/**
 * #4176 port: Qoder CN region threading through qoderModels.js.
 * Same catalog fetch, but the CN gateway host and a region-scoped cache
 * key so the same account's intl/CN catalogs never collide.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import {
  clearQoderCatalog,
  resolveQoderModels,
} from "../../open-sse/services/qoderModels.js";
import { getQoderUsage } from "../../open-sse/services/usage/misc.js";
import { QoderExecutor } from "../../open-sse/executors/qoder.js";

function catalog(chat) {
  mocks.proxyAwareFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ chat }),
  });
}

const MODEL_ENTRY = [{
  key: "auto",
  enable: true,
  display_name: "Auto",
  max_input_tokens: 131072,
  max_output_tokens: 32768,
}];

describe("Qoder CN region threading (#4176)", () => {
  beforeEach(() => {
    clearQoderCatalog();
    mocks.proxyAwareFetch.mockReset();
  });

  it("fetches the CN gateway model-list URL when credentials.provider is qoder-cn", async () => {
    catalog(MODEL_ENTRY);
    const credentials = {
      provider: "qoder-cn",
      accessToken: "access-token",
      providerSpecificData: { userId: "user-id" },
    };

    await resolveQoderModels(credentials);

    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url] = mocks.proxyAwareFetch.mock.calls[0];
    expect(url).toContain("gateway.qoder.com.cn");
  });

  it("fetches the intl host when credentials.provider is qoder (or absent)", async () => {
    catalog(MODEL_ENTRY);
    const credentials = {
      provider: "qoder",
      accessToken: "access-token",
      providerSpecificData: { userId: "user-id" },
    };

    await resolveQoderModels(credentials);

    const [url] = mocks.proxyAwareFetch.mock.calls[0];
    expect(url).toContain("api3.qoder.sh");
  });

  it("keeps the intl and CN catalog caches separate for the same userId", async () => {
    catalog(MODEL_ENTRY);
    const intlCreds = {
      provider: "qoder",
      accessToken: "access-token",
      providerSpecificData: { userId: "shared-user-id" },
    };
    const cnCreds = {
      provider: "qoder-cn",
      accessToken: "access-token",
      providerSpecificData: { userId: "shared-user-id" },
    };

    await resolveQoderModels(intlCreds);
    await resolveQoderModels(cnCreds);

    // One fetch per region — a shared cache key would have short-circuited
    // the second resolveQoderModels call as an already-cached hit.
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
    const urls = mocks.proxyAwareFetch.mock.calls.map(([url]) => url);
    expect(urls[0]).toContain("api3.qoder.sh");
    expect(urls[1]).toContain("gateway.qoder.com.cn");
  });

  it("honors an explicit options.region override even without credentials.provider", async () => {
    catalog(MODEL_ENTRY);
    const credentials = {
      accessToken: "access-token",
      providerSpecificData: { userId: "user-id" },
    };

    await resolveQoderModels(credentials, { region: "cn" });

    const [url] = mocks.proxyAwareFetch.mock.calls[0];
    expect(url).toContain("gateway.qoder.com.cn");
  });
});

describe("Qoder CN usage endpoint (#4176)", () => {
  beforeEach(() => mocks.proxyAwareFetch.mockReset());

  it("hits the CN quota endpoint for a qoder-cn connection", async () => {
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ userQuota: {}, orgResourcePackage: {} }),
    });

    await getQoderUsage("access-token", null, "qoder-cn");

    const [url] = mocks.proxyAwareFetch.mock.calls[0];
    expect(url).toContain("openapi.qoder.com.cn");
  });

  it("hits the intl quota endpoint by default", async () => {
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ userQuota: {}, orgResourcePackage: {} }),
    });

    await getQoderUsage("access-token");

    const [url] = mocks.proxyAwareFetch.mock.calls[0];
    expect(url).toContain("openapi.qoder.sh");
  });
});

describe("QoderExecutor CN routing end-to-end (#4176)", () => {
  beforeEach(() => {
    clearQoderCatalog();
    mocks.proxyAwareFetch.mockReset();
  });

  it("routes a PAT connection's job-token exchange, model catalog, and chat POST all through the CN gateway", async () => {
    mocks.proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes("/api/v1/jobToken/exchange")) {
        return { ok: true, json: async () => ({ token: "jt-cn-token", expires_in: 3600 }) };
      }
      if (url.includes("/api/v1/userinfo")) {
        return { ok: true, json: async () => ({ id: "cn-user-1" }) };
      }
      if (url.includes("/api/v2/model/list")) {
        return { ok: true, json: async () => ({ chat: MODEL_ENTRY }) };
      }
      // Chat POST — statusCodeValue 200 body [DONE] is enough to satisfy wrapQoderSSE.
      return new Response('data: {"statusCodeValue":200,"body":"[DONE]"}\n\n');
    });

    const executor = new QoderExecutor("qoder-cn");
    executor.config = { timeoutMs: 2000 };
    const result = await executor.execute({
      model: "qoder-cn/auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { apiKey: "pt-cn-token" },
    });
    await result.response.text?.();

    const urls = mocks.proxyAwareFetch.mock.calls.map(([u]) => u);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toContain(".qoder.com.cn");
  });
});
