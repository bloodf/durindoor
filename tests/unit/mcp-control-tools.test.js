import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  getUsageStats: vi.fn(),
  getTokenSaverStats: vi.fn(),
  getProviderNodeById: vi.fn(),
  getProviderValidationGuard: vi.fn().mockReturnValue({}),
  buildModelsList: vi.fn(),
  notifyQuotaAutoPingSettingChanged: vi.fn(),
  sanitizeProviderConnectionForClient: vi.fn((c) => c),
  AI_PROVIDERS: { openai: { id: "openai", alias: "openai", category: "llm", authType: "token" } },
  isOpenAICompatibleProvider: vi.fn((id) => id.startsWith("openai-compatible-")),
  isAnthropicCompatibleProvider: vi.fn((id) => id.startsWith("anthropic-compatible-")),
  isCustomEmbeddingProvider: vi.fn((id) => id.startsWith("embedding-custom-")),
}));

vi.mock("@/models", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
  getProviderNodeById: mocks.getProviderNodeById,
}));

vi.mock("@/lib/usageDb", () => ({
  getUsageStats: mocks.getUsageStats,
  getTokenSaverStats: mocks.getTokenSaverStats,
}));

vi.mock("@/app/api/v1/models/buildModelsList", () => ({
  buildModelsList: mocks.buildModelsList,
  LLM_KIND: "llm",
}));

vi.mock("open-sse/utils/outboundUrlGuard.js", () => ({
  getProviderValidationGuard: mocks.getProviderValidationGuard,
}));

vi.mock("@/shared/services/quotaAutoPing", () => ({
  notifyQuotaAutoPingSettingChanged: mocks.notifyQuotaAutoPingSettingChanged,
}));

vi.mock("@/lib/providers/sanitizeProviderConnectionForClient.js", () => ({
  sanitizeProviderConnectionForClient: mocks.sanitizeProviderConnectionForClient,
}));

vi.mock("@/shared/constants/providers", () => ({
  AI_PROVIDERS: mocks.AI_PROVIDERS,
  isOpenAICompatibleProvider: mocks.isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider: mocks.isAnthropicCompatibleProvider,
  isCustomEmbeddingProvider: mocks.isCustomEmbeddingProvider,
}));

const { listTools, callTool } = await import("../../src/lib/mcp/control/tools");

describe("mcp-control tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists exactly the expected tools", () => {
    const tools = listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "list_providers",
      "list_connections",
      "toggle_connection_active",
      "toggle_provider_active",
      "usage_stats",
      "token_saver_stats",
      "model_list",
    ]);
  });

  it("list_providers returns provider metadata", async () => {
    const result = await callTool("list_providers", {});
    expect(result.providers).toBeInstanceOf(Array);
    expect(result.providers.length).toBeGreaterThan(0);
    const p = result.providers[0];
    expect(p).toHaveProperty("id");
    expect(p).toHaveProperty("alias");
  });

  it("list_connections returns sanitized connections", async () => {
    const conn = { id: "c1", provider: "openai", apiKey: "secret" };
    mocks.getProviderConnections.mockResolvedValue([conn]);
    mocks.sanitizeProviderConnectionForClient.mockReturnValue({ id: "c1", provider: "openai" });

    const result = await callTool("list_connections", {});

    expect(mocks.getProviderConnections).toHaveBeenCalled();
    expect(mocks.sanitizeProviderConnectionForClient).toHaveBeenCalledWith(conn);
    expect(result.connections).toEqual([{ id: "c1", provider: "openai" }]);
  });

  it("list_connections drops connectionProxyUrl from providerSpecificData", async () => {
    const conn = {
      id: "c1",
      provider: "openai",
      providerSpecificData: {
        connectionProxyUrl: "http://user:pass@proxy.example:8080",
        connectionNoProxy: "localhost",
      },
    };
    mocks.getProviderConnections.mockResolvedValue([conn]);
    mocks.sanitizeProviderConnectionForClient.mockReturnValue({
      id: "c1",
      provider: "openai",
      providerSpecificData: {
        connectionProxyUrl: "http://user:pass@proxy.example:8080",
        connectionNoProxy: "localhost",
      },
    });

    const result = await callTool("list_connections", {});

    expect(result.connections[0].providerSpecificData.connectionProxyUrl).toBeUndefined();
    expect(result.connections[0].providerSpecificData.connectionNoProxy).toBe("localhost");
  });

  it("toggle_connection_active updates a connection and returns sanitized result", async () => {
    const existing = { id: "c1", provider: "openai", isActive: true };
    const updated = { id: "c1", provider: "openai", isActive: false };
    mocks.getProviderConnectionById.mockResolvedValue(existing);
    mocks.updateProviderConnection.mockResolvedValue(updated);
    mocks.sanitizeProviderConnectionForClient.mockReturnValue({ id: "c1", provider: "openai", isActive: false });

    const result = await callTool("toggle_connection_active", { connectionId: "c1", isActive: false });

    expect(mocks.getProviderConnectionById).toHaveBeenCalledWith("c1");
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("c1", { isActive: false });
    expect(result.connection.isActive).toBe(false);
    expect(mocks.notifyQuotaAutoPingSettingChanged).toHaveBeenCalledWith("openai", "c1", false);
  });

  it("toggle_connection_active rejects missing connection", async () => {
    mocks.getProviderConnectionById.mockResolvedValue(null);

    await expect(callTool("toggle_connection_active", { connectionId: "missing", isActive: false }))
      .rejects.toThrow("Connection not found");
  });

  it("toggle_connection_active requires boolean isActive", async () => {
    await expect(callTool("toggle_connection_active", { connectionId: "c1", isActive: "no" }))
      .rejects.toThrow("Invalid isActive");
  });

  it("toggle_provider_active updates all matching connections", async () => {
    const conn1 = { id: "c1", provider: "openai" };
    const conn2 = { id: "c2", provider: "openai" };
    mocks.getProviderConnections.mockResolvedValue([conn1, conn2]);
    mocks.updateProviderConnection
      .mockResolvedValueOnce({ ...conn1, isActive: false })
      .mockResolvedValueOnce({ ...conn2, isActive: false });
    mocks.sanitizeProviderConnectionForClient
      .mockReturnValueOnce({ id: "c1", provider: "openai", isActive: false })
      .mockReturnValueOnce({ id: "c2", provider: "openai", isActive: false });

    const result = await callTool("toggle_provider_active", { providerId: "openai", isActive: false });

    expect(mocks.getProviderConnections).toHaveBeenCalledWith({ provider: "openai" });
    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(2);
    expect(mocks.notifyQuotaAutoPingSettingChanged).toHaveBeenCalledTimes(2);
    expect(result.connections).toHaveLength(2);
  });

  it("toggle_provider_active accepts a custom OpenAI-compatible provider", async () => {
    const customId = "openai-compatible-custom-abc";
    mocks.getProviderNodeById.mockResolvedValue({ id: customId });
    const conn = { id: "cc1", provider: customId };
    mocks.getProviderConnections.mockResolvedValue([conn]);
    mocks.updateProviderConnection.mockResolvedValue({ ...conn, isActive: true });
    mocks.sanitizeProviderConnectionForClient.mockReturnValue({ id: "cc1", provider: customId, isActive: true });

    const result = await callTool("toggle_provider_active", { providerId: customId, isActive: true });

    expect(mocks.getProviderNodeById).toHaveBeenCalledWith(customId);
    expect(mocks.getProviderConnections).toHaveBeenCalledWith({ provider: customId });
    expect(result.connections).toHaveLength(1);
  });

  it("toggle_provider_active accepts a custom embedding provider", async () => {
    const customId = "embedding-custom-abc";
    mocks.getProviderNodeById.mockResolvedValue({ id: customId });
    const conn = { id: "ec1", provider: customId };
    mocks.getProviderConnections.mockResolvedValue([conn]);
    mocks.updateProviderConnection.mockResolvedValue({ ...conn, isActive: true });
    mocks.sanitizeProviderConnectionForClient.mockReturnValue({ id: "ec1", provider: customId, isActive: true });

    const result = await callTool("toggle_provider_active", { providerId: customId, isActive: true });

    expect(mocks.getProviderNodeById).toHaveBeenCalledWith(customId);
    expect(mocks.getProviderConnections).toHaveBeenCalledWith({ provider: customId });
    expect(result.connections).toHaveLength(1);
  });

  it("toggle_provider_active rejects a faked custom embedding ID with no node", async () => {
    mocks.getProviderNodeById.mockResolvedValue(null);

    await expect(callTool("toggle_provider_active", { providerId: "embedding-custom-does-not-exist", isActive: false }))
      .rejects.toThrow("Unknown provider");
    expect(mocks.getProviderNodeById).toHaveBeenCalledWith("embedding-custom-does-not-exist");
  });

  it("toggle_provider_active rejects a faked compatible ID with no node", async () => {
    mocks.getProviderNodeById.mockResolvedValue(null);

    await expect(callTool("toggle_provider_active", { providerId: "openai-compatible-does-not-exist", isActive: false }))
      .rejects.toThrow("Unknown provider");
    expect(mocks.getProviderNodeById).toHaveBeenCalledWith("openai-compatible-does-not-exist");
  });

  it("toggle_provider_active rejects unknown provider", async () => {
    await expect(callTool("toggle_provider_active", { providerId: "unknown-provider", isActive: false }))
      .rejects.toThrow("Unknown provider");
  });

  it("toggle_provider_active rejects provider with no connections", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);

    await expect(callTool("toggle_provider_active", { providerId: "openai", isActive: false }))
      .rejects.toThrow("No connections found");
  });

  it("usage_stats returns stats for a valid period", async () => {
    mocks.getUsageStats.mockResolvedValue({ total: 42 });

    const result = await callTool("usage_stats", { period: "24h" });

    expect(mocks.getUsageStats).toHaveBeenCalledWith("24h");
    expect(result.stats).toEqual({ total: 42 });
  });

  it("usage_stats rejects invalid period", async () => {
    await expect(callTool("usage_stats", { period: "nope" }))
      .rejects.toThrow("Invalid period");
  });

  it("token_saver_stats returns stats for a valid period", async () => {
    mocks.getTokenSaverStats.mockResolvedValue({ saved: 10 });

    const result = await callTool("token_saver_stats", { period: "7d" });

    expect(mocks.getTokenSaverStats).toHaveBeenCalledWith("7d");
    expect(result.stats).toEqual({ saved: 10 });
  });

  it("model_list returns models", async () => {
    mocks.buildModelsList.mockResolvedValue([{ id: "gpt-4" }]);

    const result = await callTool("model_list", {});

    expect(mocks.buildModelsList).toHaveBeenCalledWith(["llm"], {});
    expect(result.models).toEqual([{ id: "gpt-4" }]);
  });
});
