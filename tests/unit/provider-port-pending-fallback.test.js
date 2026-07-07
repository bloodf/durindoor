import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: mocks.validateApiKey,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
}));

describe("Provider port-pending guard fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([
      { id: "cgpt-web-1", provider: "chatgpt-web", email: "cg@example.com", backoffLevel: 0 },
    ]);
  });

  it("does not lock the connection when the guard error type is provider_port_pending", async () => {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const result = await markAccountUnavailable(
      "cgpt-web-1",
      501,
      '{"error":{"type":"provider_port_pending","provider":"chatgpt-web"}}',
      "chatgpt-web",
      "gpt-5.5",
    );

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});
