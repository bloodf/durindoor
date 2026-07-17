import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
  fetchKiroProfileArn: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

vi.mock("../../src/lib/oauth/providers.js", () => ({
  fetchKiroProfileArn: mocks.fetchKiroProfileArn,
}));

/**
 * Kiro may discover a missing profile ARN immediately after refreshing. Both
 * calls belong to one credential lifecycle and must use the same egress route;
 * otherwise a strict-pool refresh can leak the profile request to direct egress.
 */
describe("Kiro refresh proxy routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        accessToken: "new-kiro-access",
        refreshToken: "rotated-kiro-refresh",
        expiresIn: 3600,
      }),
    });
    mocks.fetchKiroProfileArn.mockResolvedValue(
      "arn:aws:codewhisperer:eu-west-1:123:profile/test"
    );
  });

  it("uses one strict-pool context for token refresh and profile discovery", async () => {
    const proxyOptions = {
      proxyMode: "strict-pool",
      proxyPoolId: "kiro-pool",
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://kiro-proxy.test:8080",
      strictProxy: true,
      disableEnvProxy: true,
    };
    const { refreshKiroToken } = await import("../../open-sse/services/tokenRefresh.js");

    const result = await refreshKiroToken(
      "kiro-refresh-route-test",
      { authMethod: "social", region: "eu-west-1" },
      null,
      proxyOptions
    );

    expect(result).toMatchObject({
      accessToken: "new-kiro-access",
      providerSpecificData: {
        profileArn: "arn:aws:codewhisperer:eu-west-1:123:profile/test",
      },
    });
    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "POST" }),
      proxyOptions
    );
    expect(mocks.fetchKiroProfileArn).toHaveBeenCalledWith(
      "new-kiro-access",
      "eu-west-1",
      proxyOptions
    );
  });
});
