import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshProviderCredentials: vi.fn(),
  refreshVertexToken: vi.fn(),
  refreshGoogleToken: vi.fn(),
  refreshCodebuddyToken: vi.fn(),
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
  refreshCodebuddyToken: mocks.refreshCodebuddyToken,
}));

describe("specialized OAuth executor refresh routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshProviderCredentials.mockResolvedValue({ accessToken: "rotated" });
    mocks.refreshVertexToken.mockResolvedValue({
      accessToken: "vertex-rotated",
      expiresAt: "2026-07-11T00:00:00.000Z",
    });
    mocks.refreshCodebuddyToken.mockResolvedValue({
      accessToken: "codebuddy-access",
      refreshToken: "codebuddy-refresh-rotated",
      expiresIn: 3600,
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

  it("routes the shared coordinator through the real CodeBuddy executor shape", async () => {
    const { CodeBuddyExecutor } = await import("../../open-sse/executors/codebuddy-cn.js");
    const { refreshAndUpdateCredentials } = await import("../../src/shared/services/providerCredentials.js");
    const executor = new CodeBuddyExecutor();
    const proxyOptions = { disableEnvProxy: true, strictProxy: true };
    const original = {
      id: "codebuddy-connection",
      provider: "codebuddy-cn",
      authType: "oauth",
      accessToken: "codebuddy-access-old",
      refreshToken: "codebuddy-refresh-old",
      providerSpecificData: {},
    };
    const updateProviderConnectionImpl = vi.fn().mockResolvedValue(undefined);

    const result = await refreshAndUpdateCredentials(original, true, proxyOptions, {
      getExecutorImpl: () => executor,
      updateProviderConnectionImpl,
      now: () => Date.parse("2026-07-10T00:00:00.000Z"),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(mocks.refreshCodebuddyToken).toHaveBeenCalledWith(
      "codebuddy-refresh-old",
      expect.objectContaining({ info: expect.any(Function) }),
      proxyOptions,
    );
    expect(updateProviderConnectionImpl).toHaveBeenCalledWith(
      "codebuddy-connection",
      expect.objectContaining({
        accessToken: "codebuddy-access",
        refreshToken: "codebuddy-refresh-rotated",
        expiresIn: 3600,
      }),
      expect.objectContaining({ returnCommitResult: true }),
    );
    expect(result).toMatchObject({ refreshed: true, connection: { accessToken: "codebuddy-access" } });
  });
});
