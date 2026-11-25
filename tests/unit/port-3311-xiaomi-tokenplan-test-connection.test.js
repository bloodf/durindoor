import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));

vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: mocks.get, updateProviderConnection: mocks.update }));

import {
  __setProviderTestFetchForTesting,
  testSingleConnection,
} from "../../src/app/api/providers/[id]/test/testUtils.js";

async function testConnection(provider, status) {
  mocks.get.mockResolvedValue({ id: "mimo", provider, authType: "apikey", apiKey: "tp-synthetic", providerSpecificData: { region: "cn" } });
  const probe = vi.fn().mockResolvedValue(Response.json({}, { status }));
  const restore = __setProviderTestFetchForTesting(probe);
  try {
    return { result: await testSingleConnection("mimo"), url: probe.mock.calls[0]?.[0] };
  } finally {
    restore();
  }
}

beforeEach(() => vi.clearAllMocks());

describe("port(upstream): #3311 - Xiaomi Token Plan Test Connection", () => {
  it.each([
    [200, true],
    [403, true],
    [401, false],
    [500, false],
  ])("reads HTTP %i from the regional model list as valid=%s", async (status, valid) => {
    const { result, url } = await testConnection("xiaomi-tokenplan", status);
    expect(url).toBe("https://token-plan-cn.xiaomimimo.com/v1/models");
    expect(result.valid).toBe(valid);
  });

  it("keeps a 403 invalid for the pay-as-you-go Xiaomi provider", async () => {
    const { result } = await testConnection("xiaomi-mimo", 403);
    expect(result.valid).toBe(false);
  });
});
