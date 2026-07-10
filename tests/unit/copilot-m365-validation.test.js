import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
}));

vi.mock("@/models", () => ({ getProviderNodeById: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: mocks.testProxyUrl }));

import { POST } from "../../src/app/api/providers/validate/route.js";

function validateRequest(apiKey, providerSpecificData = {}) {
  return new Request("http://localhost/api/providers/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "copilot-m365-web", apiKey, providerSpecificData }),
  });
}

describe("M365 Copilot credential validation consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(undefined);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
    });
  });

  it("accepts only credentials the executor can route safely", async () => {
    const valid = await POST(validateRequest("access_token=tok; chathubPath=user@tenant"));
    await expect(valid.json()).resolves.toEqual({ valid: true, error: null });

    const badPath = await POST(validateRequest(
      "access_token=tok; chathubPath=user@tenant?redirect=evil",
    ));
    await expect(badPath.json()).resolves.toMatchObject({ valid: false });

    const badHost = await POST(validateRequest(
      "access_token=tok; chathubPath=user@tenant",
      { host: "attacker.example" },
    ));
    await expect(badHost.json()).resolves.toMatchObject({ valid: false });
  });

  it("applies the same host/path policy to saved-connection health checks", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-m365",
      provider: "copilot-m365-web",
      authType: "cookie",
      apiKey: "access_token=tok; chathubPath=user@tenant",
      providerSpecificData: { host: "attacker.example" },
    });
    const { testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );

    const result = await testSingleConnection("conn-m365");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/host/i);
  });
});
