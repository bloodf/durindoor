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
  getCombos: vi.fn(),
  getComboById: vi.fn(),
  getApiKeys: vi.fn(),
  getAllApiKeyUsageTotals: vi.fn(),
  listProviderQuotaSnapshots: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  createComboManaged: vi.fn(),
  updateComboManaged: vi.fn(),
  deleteComboManaged: vi.fn(),
  refreshProviderQuota: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getCombos: mocks.getCombos,
  getComboById: mocks.getComboById,
  getApiKeys: mocks.getApiKeys,
  getAllApiKeyUsageTotals: mocks.getAllApiKeyUsageTotals,
  listProviderQuotaSnapshots: mocks.listProviderQuotaSnapshots,
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));

vi.mock("@/lib/combos/comboManagement", () => ({
  createComboManaged: mocks.createComboManaged,
  updateComboManaged: mocks.updateComboManaged,
  deleteComboManaged: mocks.deleteComboManaged,
}));

vi.mock("@/shared/services/providerQuotaTracker", () => ({
  refreshProviderQuota: mocks.refreshProviderQuota,
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
const { mergeProviderConnection } = await import("../../src/lib/db/helpers/mergeProviderMetadata.js");

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
      "list_combos",
      "get_combo",
      "create_combo",
      "update_combo",
      "delete_combo",
      "quota_snapshots",
      "refresh_quota",
      "list_api_keys",
      "get_settings",
      "update_settings",
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

  it("toggle_connection_active clears a persisted automatic-disable event on re-enable", async () => {
    const existing = {
      id: "c1",
      provider: "openai",
      isActive: false,
      testStatus: "unavailable",
      lastError: "Qoder quota exhausted (code 112)",
      errorCode: 403,
      lastErrorAt: "2026-08-21T12:00:00.000Z",
      autoDisabledReason: "Qoder quota exhausted (code 112)",
      autoDisabledAt: "2026-08-21T12:00:00.000Z",
    };
    mocks.getProviderConnectionById.mockResolvedValue(existing);
    mocks.updateProviderConnection.mockImplementation(async (_id, patch) => mergeProviderConnection(existing, patch));
    mocks.sanitizeProviderConnectionForClient.mockImplementation((connection) => connection);

    const result = await callTool("toggle_connection_active", { connectionId: "c1", isActive: true });

    expect(result.connection).toMatchObject({
      isActive: true,
      testStatus: null,
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      autoDisabledReason: null,
      autoDisabledAt: null,
    });
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

  it("toggle_provider_active clears automatic-disable events for every re-enabled connection", async () => {
    const connections = ["c1", "c2"].map((id) => ({
      id,
      provider: "openai",
      isActive: false,
      lastError: "Qoder quota exhausted (code 112)",
      lastErrorAt: "2026-08-21T12:00:00.000Z",
      autoDisabledReason: "Qoder quota exhausted (code 112)",
      autoDisabledAt: "2026-08-21T12:00:00.000Z",
    }));
    mocks.getProviderConnections.mockResolvedValue(connections);
    mocks.updateProviderConnection.mockImplementation(async (id, patch) => (
      mergeProviderConnection(connections.find((connection) => connection.id === id), patch)
    ));
    mocks.sanitizeProviderConnectionForClient.mockImplementation((connection) => connection);

    const result = await callTool("toggle_provider_active", { providerId: "openai", isActive: true });

    expect(result.connections).toHaveLength(2);
    for (const connection of result.connections) {
      expect(connection).toMatchObject({
        isActive: true,
        lastError: null,
        lastErrorAt: null,
        autoDisabledReason: null,
        autoDisabledAt: null,
      });
    }
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

  it("model_list filters by requested kinds", async () => {
    mocks.buildModelsList.mockResolvedValue([{ id: "dall-e-3" }]);

    const result = await callTool("model_list", { kinds: ["image", "tts"] });

    expect(mocks.buildModelsList).toHaveBeenCalledWith(["image", "tts"], {});
    expect(result.models).toEqual([{ id: "dall-e-3" }]);
  });

  it("model_list rejects an unknown kind", async () => {
    await expect(callTool("model_list", { kinds: ["telepathy"] }))
      .rejects.toThrow("Invalid kind: telepathy");
    expect(mocks.buildModelsList).not.toHaveBeenCalled();
  });

  it("list_combos returns every combo", async () => {
    mocks.getCombos.mockResolvedValue([{ id: "cb1", name: "fast" }]);

    const result = await callTool("list_combos", {});

    expect(result.combos).toEqual([{ id: "cb1", name: "fast" }]);
  });

  it("get_combo rejects an unknown id with 404", async () => {
    mocks.getComboById.mockResolvedValue(null);

    await expect(callTool("get_combo", { id: "nope" })).rejects.toMatchObject({
      message: "Combo not found",
      status: 404,
    });
  });

  it("create_combo delegates to the shared combo manager", async () => {
    mocks.createComboManaged.mockResolvedValue({ id: "cb1", name: "fast" });

    const result = await callTool("create_combo", { name: "fast", models: ["openai/gpt-4"] });

    expect(mocks.createComboManaged).toHaveBeenCalledWith({ name: "fast", models: ["openai/gpt-4"] });
    expect(result.combo).toEqual({ id: "cb1", name: "fast" });
  });

  it("create_combo surfaces a validation failure with its status", async () => {
    const invalid = Object.assign(new Error("Name can only contain letters, numbers, -, _ and ."), { status: 400 });
    mocks.createComboManaged.mockRejectedValue(invalid);

    await expect(callTool("create_combo", { name: "bad name!" })).rejects.toMatchObject({
      message: "Name can only contain letters, numbers, -, _ and .",
      status: 400,
    });
  });

  it("create_combo surfaces a duplicate-name failure", async () => {
    mocks.createComboManaged.mockRejectedValue(
      Object.assign(new Error("Combo name already exists"), { status: 400 })
    );

    await expect(callTool("create_combo", { name: "fast" })).rejects.toThrow("Combo name already exists");
  });

  it("update_combo passes the id separately from the patch", async () => {
    mocks.updateComboManaged.mockResolvedValue({ id: "cb1", name: "slow" });

    const result = await callTool("update_combo", { id: "cb1", name: "slow" });

    expect(mocks.updateComboManaged).toHaveBeenCalledWith("cb1", { name: "slow" });
    expect(result.combo.name).toBe("slow");
  });

  it("delete_combo surfaces a missing combo as 404", async () => {
    mocks.deleteComboManaged.mockRejectedValue(
      Object.assign(new Error("Combo not found"), { status: 404 })
    );

    await expect(callTool("delete_combo", { id: "gone" })).rejects.toMatchObject({ status: 404 });
  });

  it("quota_snapshots requires a provider or connection filter", async () => {
    await expect(callTool("quota_snapshots", {}))
      .rejects.toThrow("A connectionId or provider filter is required");
    expect(mocks.listProviderQuotaSnapshots).not.toHaveBeenCalled();
  });

  it("quota_snapshots passes its filters through", async () => {
    mocks.listProviderQuotaSnapshots.mockResolvedValue([{ resource: "messages", remaining: 12 }]);

    const result = await callTool("quota_snapshots", { provider: "claude", includeStale: true });

    expect(mocks.listProviderQuotaSnapshots).toHaveBeenCalledWith({
      provider: "claude",
      connectionId: undefined,
      includeStale: true,
    });
    expect(result.snapshots[0].remaining).toBe(12);
  });

  it("refresh_quota rejects an unknown connection with 404", async () => {
    mocks.getProviderConnectionById.mockResolvedValue(null);

    await expect(callTool("refresh_quota", { connectionId: "gone" })).rejects.toMatchObject({
      message: "Connection not found",
      status: 404,
    });
    expect(mocks.refreshProviderQuota).not.toHaveBeenCalled();
  });

  it("refresh_quota forces a live refresh and re-reads the snapshots", async () => {
    const connection = { id: "c1", provider: "claude" };
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.refreshProviderQuota.mockResolvedValue({ status: "refreshed" });
    mocks.listProviderQuotaSnapshots.mockResolvedValue([{ resource: "messages", remaining: 3 }]);

    const result = await callTool("refresh_quota", { connectionId: "c1" });

    expect(mocks.refreshProviderQuota).toHaveBeenCalledWith(connection, { force: true });
    expect(mocks.listProviderQuotaSnapshots).toHaveBeenCalledWith({
      connectionId: "c1",
      provider: "claude",
      includeStale: true,
    });
    expect(result.result).toEqual({ status: "refreshed" });
    expect(result.snapshots[0].remaining).toBe(3);
  });

  it("refresh_quota reports an unsupported provider as a caller error", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({ id: "c1", provider: "openai" });
    mocks.refreshProviderQuota.mockRejectedValue(new Error("Quota tracking unsupported"));

    await expect(callTool("refresh_quota", { connectionId: "c1" })).rejects.toMatchObject({
      message: "Quota tracking unsupported",
      status: 400,
    });
  });

  it("list_api_keys never returns the raw secret", async () => {
    mocks.getApiKeys.mockResolvedValue([
      { id: "k1", name: "ci", key: "sk-supersecret", isActive: true },
    ]);
    mocks.getAllApiKeyUsageTotals.mockResolvedValue([
      { apiKeyId: "k1", totalTokens: 10, totalCost: 0.1, totalRequests: 2, updatedAt: "2026-01-01" },
    ]);

    const result = await callTool("list_api_keys", {});

    expect(result.keys).toHaveLength(1);
    expect(result.keys[0]).not.toHaveProperty("key");
    expect(JSON.stringify(result)).not.toContain("sk-supersecret");
    expect(result.keys[0].usage.totalTokens).toBe(10);
  });

  it("list_api_keys defaults usage for a key with no recorded totals", async () => {
    mocks.getApiKeys.mockResolvedValue([{ id: "k2", name: "fresh", key: "sk-x" }]);
    mocks.getAllApiKeyUsageTotals.mockResolvedValue([]);

    const result = await callTool("list_api_keys", {});

    expect(result.keys[0].usage).toEqual({ totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null });
  });

  it("get_settings withholds secrets", async () => {
    mocks.getSettings.mockResolvedValue({
      requireApiKey: true,
      password: "hashed",
      passwordSessionEpoch: 4,
      oidcClientSecret: "oidc-secret",
      mitmSudoEncrypted: "blob",
    });

    const result = await callTool("get_settings", {});

    expect(result.settings.requireApiKey).toBe(true);
    expect(result.settings).not.toHaveProperty("password");
    expect(result.settings).not.toHaveProperty("passwordSessionEpoch");
    expect(result.settings).not.toHaveProperty("oidcClientSecret");
    expect(result.settings).not.toHaveProperty("mitmSudoEncrypted");
  });

  it("get_settings redacts proxy credentials but keeps the endpoint readable", async () => {
    // outboundProxyUrl is operational config an agent legitimately inspects,
    // but its userinfo is a live credential and the MCP surface authenticates
    // with an application API key, never an operator session.
    mocks.getSettings.mockResolvedValue({
      outboundProxyEnabled: true,
      outboundProxyUrl: "http://proxyuser:s3cret@proxy.internal:8080",
    });

    const result = await callTool("get_settings", {});

    expect(result.settings.outboundProxyUrl).not.toContain("s3cret");
    expect(result.settings.outboundProxyUrl).not.toContain("proxyuser");
    expect(result.settings.outboundProxyUrl).toContain("proxy.internal:8080");
    expect(result.settings.outboundProxyEnabled).toBe(true);
  });

  it("update_settings strips auth-critical and secret keys before writing", async () => {
    mocks.getSettings.mockResolvedValue({ hidePaidModels: true });

    await callTool("update_settings", {
      settings: {
        hidePaidModels: true,
        requireApiKey: false,
        requireLogin: false,
        password: "pwned",
        claudeAutoPing: true,
      },
    });

    expect(mocks.updateSettings).toHaveBeenCalledWith({ hidePaidModels: true });
  });

  it("update_settings rejects a patch left with nothing to write", async () => {
    await expect(callTool("update_settings", { settings: { requireApiKey: false } }))
      .rejects.toThrow("No updatable settings provided");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("update_settings rejects a non-object payload", async () => {
    await expect(callTool("update_settings", { settings: ["requireApiKey"] }))
      .rejects.toThrow("Invalid settings: expected object");
  });
});
