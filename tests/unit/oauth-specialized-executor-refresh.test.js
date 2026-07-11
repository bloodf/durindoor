import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshProviderCredentials: vi.fn(),
  refreshVertexToken: vi.fn(),
  refreshGoogleToken: vi.fn(),
}));

vi.mock("../../open-sse/services/oauthCredentialManager.js", () => ({
  refreshProviderCredentials: mocks.refreshProviderCredentials,
  shouldRefreshCredentials: vi.fn(() => true),
}));
vi.mock("../../open-sse/services/tokenRefresh.js", async (importOriginal) => ({
  ...(await importOriginal()),
  parseVertexSaJson: vi.fn(() => ({ client_email: "vertex@example.test" })),
  refreshVertexToken: mocks.refreshVertexToken,
  refreshGoogleToken: mocks.refreshGoogleToken,
}));

describe("specialized OAuth executor refresh routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshProviderCredentials.mockResolvedValue({ accessToken: "rotated" });
    mocks.refreshVertexToken.mockResolvedValue({
      accessToken: "vertex-rotated",
      expiresAt: "2026-07-11T00:00:00.000Z",
    });
  });

  it.each([
    ["gemini-cli", async () => new (await import("../../open-sse/executors/gemini-cli.js")).GeminiCLIExecutor()],
    ["qwen", async () => new (await import("../../open-sse/executors/qwen.js")).QwenExecutor()],
    ["grok-cli", async () => new (await import("../../open-sse/executors/grok-cli.js")).GrokCliExecutor()],
  ])("passes the exact proxy context through the %s override", async (provider, createExecutor) => {
    const executor = await createExecutor();
    const credentials = { refreshToken: "refresh-token", providerSpecificData: {} };
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example.test:8080",
      disableEnvProxy: true,
      strictProxy: true,
    };

    await executor.refreshCredentials(credentials, null, proxyOptions);

    expect(mocks.refreshProviderCredentials).toHaveBeenCalledWith(
      provider,
      credentials,
      null,
      proxyOptions,
    );
  });

  it("passes the exact proxy context through Vertex service-account refresh", async () => {
    const { VertexExecutor } = await import("../../open-sse/executors/vertex.js");
    const executor = new VertexExecutor("vertex");
    const credentials = { apiKey: "service-account-json" };
    const proxyOptions = { disableEnvProxy: true, strictProxy: false };

    const result = await executor.refreshCredentials(credentials, null, proxyOptions);

    expect(result).toEqual({
      accessToken: "vertex-rotated",
      expiresAt: "2026-07-11T00:00:00.000Z",
    });
    expect(mocks.refreshVertexToken).toHaveBeenCalledWith(
      { client_email: "vertex@example.test" },
      null,
      proxyOptions,
    );
  });
});
