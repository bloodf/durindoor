import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), proxy: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: mocks.get, updateProviderConnection: mocks.update }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.proxy }));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: vi.fn() }));
import { __setProviderTestFetchForTesting, testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";

it("tests Cohere credentials against the current models endpoint", async () => {
  mocks.get.mockResolvedValue({ id: "cohere", provider: "cohere", authType: "apikey", apiKey: "test" });
  mocks.update.mockResolvedValue(undefined);
  mocks.proxy.mockResolvedValue({ connectionProxyEnabled: false });
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  const restore = __setProviderTestFetchForTesting(fetch);
  try {
    expect((await testSingleConnection("cohere")).valid).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe("https://api.cohere.com/v1/models");
  } finally { restore(); }
});
