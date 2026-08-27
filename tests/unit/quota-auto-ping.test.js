import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(),
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  listProviderQuotaSnapshots: vi.fn(),
  getQuotaFetchState: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/shared/services/providerCredentials", () => ({
  refreshAndUpdateCredentials: vi.fn(),
}));

vi.mock("@/shared/services/providerQuotaTracker", () => ({
  refreshProviderQuota: vi.fn(),
}));

vi.mock("@/shared/constants/config", () => ({
  QUOTA_AUTOPING_CONFIG: {
    tickIntervalMs: 60000,
    pingTimeoutMs: 50,
    pingLeadMs: 5000,
    refreshAheadMs: 300000,
    failureCooldownMs: 900000,
    providers: {
      claude: {
        settingsKey: "claudeAutoPing",
        quotaKey: "session (5h)",
        pingModel: "claude-haiku-4-5-20251001",
        pingText: "hi",
        pingMaxTokens: 1,
      },
      codex: {
        settingsKey: "codexAutoPing",
        quotaKey: "session",
        pingWhenResetAtSlides: true,
        resetAtDriftMs: 30000,
        minPingIntervalMs: 600000,
        skipWhenBlockingQuotaExhausted: true,
        pingModel: "gpt-5.5",
        pingText: "hi",
        pingInstructions: "Reply with OK.",
        pingReasoningEffort: "none",
      },
    },
  },
}));

vi.mock("open-sse/providers/shared.js", () => ({
  CLAUDE_CLI_SPOOF_HEADERS: { "anthropic-version": "2023-06-01" },
  KIMI_CODING_USAGE_URL: "https://api.kimi.com/coding/v1/usages",
}));

vi.mock("open-sse/services/usage/shared.js", () => ({
  U: () => ({ baseUrl: "https://chatgpt.com/backend-api/codex/responses" }),
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("open-sse/services/usage/claude.js", () => ({
  getClaudeUsage: vi.fn(),
}));

vi.mock("open-sse/services/usage/codex.js", () => ({
  getCodexUsage: vi.fn(),
  getCodexModels: vi.fn(),
}));

vi.mock("open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(),
}));

describe("quota auto-ping", () => {
  const claudeTerminalSse = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
  const codexTerminalSse = 'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n';
  let runQuotaAutoPingTick;
  let notifyQuotaAutoPingSettingChanged;
  let startQuotaAutoPing;
  let deps;
  let state;
  let getCodexUsage;
  let getCodexModels;
  let getClaudeUsage;
  let getExecutor;
  let codexResponseText;
  let persistedSnapshots;

  function quotaSnapshots(connection, quotas = {}) {
    const now = Date.now();
    return Object.entries(quotas).map(([name, quota]) => {
      const remaining = Number(quota?.remaining);
      const used = Number(quota?.used);
      const total = Number(quota?.total);
      const exhausted = Number.isFinite(remaining)
        ? remaining <= 0
        : Number.isFinite(used) && Number.isFinite(total) && total > 0 && used >= total;
      const dimension = String(name).toLowerCase().includes("session") ? "session" : String(name).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
      return {
        identity: {
          connectionId: connection.id,
          provider: connection.provider,
          accountKey: "scope:connection",
          resourceKey: "scope:account",
          dimensionKey: `requests:${dimension}`,
        },
        state: exhausted ? "exhausted" : "available",
        amounts: { limitKind: "unknown", limit: null, used: null, remaining: null, remainingRatio: null, unit: null },
        timing: {
          observedAt: new Date(now - 1).toISOString(),
          staleAt: new Date(now + 60_000).toISOString(),
          resetAt: quota?.resetAt || null,
          cooldownUntil: null,
        },
        provenance: {
          sourceType: "provider_api",
          sourceId: connection.provider === "codex" ? "codex:wham-usage:v1" : "claude:oauth-usage:v1",
          reasonCode: null,
          metadata: {},
        },
      };
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    delete global.__quotaAutoPing;

    ({ getCodexUsage, getCodexModels } = await import("open-sse/services/usage/codex.js"));
    ({ getClaudeUsage } = await import("open-sse/services/usage/claude.js"));
    getCodexUsage.mockReset();
    getCodexModels.mockReset();
    getCodexModels.mockResolvedValue([
      { slug: "gpt-5.6-terra", priority: 1 },
      { slug: "gpt-5.5", priority: 9 },
    ]);
    getClaudeUsage.mockReset();
    ({ getExecutor } = await import("open-sse/executors/index.js"));
    ({
      runQuotaAutoPingTick,
      notifyQuotaAutoPingSettingChanged,
      startQuotaAutoPing,
    } = await import("../../src/shared/services/quotaAutoPing.js"));

    persistedSnapshots = new Map();
    deps = {
      getSettings: vi.fn(),
      getProviderConnections: vi.fn(),
      updateProviderConnection: vi.fn(),
      resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
      refreshAndUpdateCredentials: vi.fn(async (connection) => ({ connection, refreshed: false })),
      listProviderQuotaSnapshots: vi.fn(async ({ provider, connectionId }) => {
        const persisted = persistedSnapshots.get(`${provider}:${connectionId}`);
        if (persisted) return structuredClone(persisted);
        const priorResetAt = state?.resetCache?.[`${provider}:${connectionId}`];
        if (!priorResetAt) return [];
        return quotaSnapshots({ id: connectionId, provider }, {
          session: { used: 1, total: 100, remaining: 99, resetAt: priorResetAt },
        });
      }),
      refreshProviderQuota: vi.fn(async (connection) => {
        const usage = connection.provider === "codex"
          ? await getCodexUsage(connection.accessToken, connection.providerSpecificData, { strictProxy: false })
          : await getClaudeUsage(connection.accessToken, { strictProxy: false }, connection);
        const snapshots = quotaSnapshots(connection, usage?.quotas || {});
        persistedSnapshots.set(`${connection.provider}:${connection.id}`, structuredClone(snapshots));
        return { outcome: "success", snapshots };
      }),
      getQuotaFetchState: vi.fn().mockResolvedValue(null),
      proxyAwareFetch: vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(claudeTerminalSse),
      }),
      getExecutor: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue({ response: { ok: true, text: codexResponseText } }),
      })),
    };
    codexResponseText = vi.fn().mockResolvedValue(codexTerminalSse);
    getExecutor.mockReturnValue({
      execute: vi.fn().mockResolvedValue({ response: { ok: true, text: codexResponseText } }),
    });
    state = {
      running: false,
      resetCache: {},
      pingFailureUntil: {},
      inflightControllers: {},
      rerunRequested: false,
    };
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
  });

  it("does not ping Codex when setting is absent", async () => {
    deps.getSettings.mockResolvedValue({});

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getProviderConnections).not.toHaveBeenCalled();
    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("does not ping Codex on the first resetAt observation", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{
        id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token",
        providerSpecificData: { workspaceId: "account-auto-ping" },
      }] : []
    ));
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 1, resetAt: "2026-01-01T13:00:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
    expect(deps.refreshProviderQuota).toHaveBeenCalledWith(
      expect.objectContaining({ id: "codex-1", provider: "codex" }),
      expect.objectContaining({ force: true, signal: expect.anything() }),
    );
  });

  it("sends Codex ping when session resetAt slides", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    const executor = deps.getExecutor.mock.results[0].value;
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(deps.updateProviderConnection).toHaveBeenCalledWith("codex-1", expect.objectContaining({
      lastPingedResetAt: "2026-01-01T17:01:00.000Z",
      lastPingedResetKey: "2026-01-01T17:01:00.000Z",
    }));
  });

  it("skips proactive refresh for rotating providers (codex) on the auto-ping path", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex"
        ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }]
        : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    // Rotating providers must never proactive-refresh on the ping path:
    // parallel single-use-token presentation revokes the whole family. The
    // ping runs with the current token.
    expect(deps.refreshAndUpdateCredentials).not.toHaveBeenCalled();
    const executor = deps.getExecutor.mock.results[0].value;
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(deps.updateProviderConnection).toHaveBeenCalledWith("codex-1", expect.objectContaining({
      lastPingedResetAt: "2026-01-01T17:01:00.000Z",
      lastPingedResetKey: "2026-01-01T17:01:00.000Z",
    }));
  });

  it("does not ping Codex when resetAt is stable", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:00:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("does not repeat Codex ping inside the minimum ping interval", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex"
        ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token", lastPingAt: "2026-01-01T11:55:00.000Z" }]
        : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("does not ping Codex just because reported usage is zero", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 0, resetAt: "2026-01-01T17:00:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
    expect(deps.refreshProviderQuota).toHaveBeenCalledOnce();
  });

  it("does not ping Codex when weekly quota is exhausted", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: {
        session: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-01T17:01:00.000Z" },
        weekly: { used: 100, total: 100, remaining: 0, resetAt: "2026-01-03T12:00:00.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("does not ping Codex when monthly quota is exhausted", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: {
        session: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-01T17:01:00.000Z" },
        monthly: { used: 100, total: 100, remaining: 0, resetAt: "2026-02-01T00:00:00.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("does not ping Codex when session quota is exhausted", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 100, total: 100, remaining: 0, resetAt: "2026-01-01T17:01:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("sends one tiny Codex request using the account's catalog model", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex"
        ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token", providerSpecificData: { workspaceId: "ws-1" } }]
        : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    const executor = deps.getExecutor.mock.results[0].value;
    expect(deps.getExecutor).toHaveBeenCalledWith("codex");
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-terra",
      stream: true,
      credentials: expect.objectContaining({
        accessToken: "token",
        connectionId: "codex-1",
        providerSpecificData: { workspaceId: "ws-1" },
      }),
      body: {
        model: "gpt-5.6-terra",
        input: [{
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hi" }],
        }],
        instructions: "Reply with OK.",
        reasoning: { effort: "none", summary: "auto" },
        store: false,
        stream: true,
      },
    }));
    expect(codexResponseText).toHaveBeenCalledTimes(1);
    expect(deps.updateProviderConnection).toHaveBeenCalledWith("codex-1", expect.objectContaining({
      lastPingedResetAt: "2026-01-01T17:01:00.000Z",
      lastPingedResetKey: "2026-01-01T17:01:00.000Z",
    }));
  });

  // decolua/9router#3213 — the ping model comes from the account's live catalog.
  // A fixed model 400s on plans that do not expose it.
  it("queries the Codex catalog with the connection's account metadata", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex"
        ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token", idToken: "id-token", providerSpecificData: { workspaceId: "ws-1" } }]
        : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(getCodexModels).toHaveBeenCalledTimes(1);
    const [accessToken, , providerSpecificData, idToken] = getCodexModels.mock.calls[0];
    expect(accessToken).toBe("token");
    expect(providerSpecificData).toEqual({ workspaceId: "ws-1" });
    expect(idToken).toBe("id-token");
  });

  it("skips the ping entirely when the catalog returns no supported model", async () => {
    getCodexModels.mockResolvedValue([]);
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex"
        ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }]
        : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  // The blocking-window check keys quota resources BY MODEL, so it must run
  // against the model the catalog selected. This fixture is deliberately
  // model-scoped: the weekly window is exhausted for the selected model
  // (gpt-5.6-terra) and available for the old hardcoded default (gpt-5.5), so
  // the case can only pass when the selected model drives the check.
  it("does not ping when the selected catalog model's long window is exhausted", async () => {
    getCodexModels.mockResolvedValue([{ slug: "gpt-5.6-terra", priority: 1 }]);
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-01T17:01:00.000Z" } },
    });

    const nowMs = Date.now();
    const weeklyFor = (model, exhausted) => ({
      identity: {
        connectionId: "codex-1",
        provider: "codex",
        accountKey: "scope:connection",
        resourceKey: `model:${model}`,
        dimensionKey: "requests:weekly",
      },
      state: exhausted ? "exhausted" : "available",
      amounts: { limitKind: "unknown", limit: null, used: null, remaining: null, remainingRatio: null, unit: null },
      timing: {
        observedAt: new Date(nowMs - 1).toISOString(),
        staleAt: new Date(nowMs + 60_000).toISOString(),
        resetAt: "2026-01-03T12:00:00.000Z",
        cooldownUntil: null,
      },
      provenance: { sourceType: "provider_api", sourceId: "codex:wham-usage:v1", reasonCode: null, metadata: {} },
    });

    // Capture the original implementation BEFORE overriding: reading it back off
    // the same mock afterwards would return this override and recurse.
    const baseImpl = deps.listProviderQuotaSnapshots.getMockImplementation();
    deps.listProviderQuotaSnapshots.mockImplementation(async (query) => [
      ...(await baseImpl(query)),
      weeklyFor("gpt-5.6-terra", true),
      weeklyFor("gpt-5.5", false),
    ]);

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("reads the catalog through the same proxy the ping is dispatched with", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex"
        ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token", providerSpecificData: { connectionProxyEnabled: true } }]
        : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(getCodexModels).toHaveBeenCalledTimes(1);
    const [, catalogProxyOptions] = getCodexModels.mock.calls[0];
    // A catalog read that bypassed the connection's proxy could resolve a
    // different account than the one the ping is charged to.
    const executor = deps.getExecutor.mock.results[0].value;
    expect(catalogProxyOptions).toEqual(executor.execute.mock.calls[0][0].proxyOptions);
  });

  it("does not ping same Codex reset twice when seconds drift", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex"
        ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token", lastPingedResetAt: "2026-01-01T11:59:44.000Z" }]
        : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T11:59:44.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-01T11:59:47.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
  });

  it("skips non-OAuth Codex connections", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "apikey", accessToken: "token" }] : []
    ));

    await runQuotaAutoPingTick(deps, state);

    expect(getCodexUsage).not.toHaveBeenCalled();
    expect(deps.getExecutor).not.toHaveBeenCalled();
  });

  it("keeps Claude session quota key behavior", async () => {
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "claude" ? [{ id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" }] : []
    ));
    getClaudeUsage.mockResolvedValue({
      quotas: { "session (5h)": { resetAt: "2026-01-01T11:59:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(deps.proxyAwareFetch.mock.calls[0][1].body)).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
    expect(deps.proxyAwareFetch.mock.calls[0][1].headers.accept).toBe("text/event-stream");
  });

  it.each([
    ["drops the elapsed reset", "2026-01-01T12:00:00.000Z"],
    ["advances to the next window", "2026-01-01T17:00:00.000Z"],
  ])("pings Claude just after reset when the real normalizer %s", async (_label, providerResetAt) => {
    vi.setSystemTime(new Date("2026-01-01T12:00:30.000Z"));
    const connection = {
      id: "claude-1",
      provider: "claude",
      authType: "oauth",
      accessToken: "token",
      updatedAt: "2026-01-01T11:00:00.000Z",
    };
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockResolvedValue([connection]);
    persistedSnapshots.set("claude:claude-1", quotaSnapshots(connection, {
      session: {
        used: 0,
        total: 100,
        remaining: 100,
        resetAt: "2026-01-01T12:00:00.000Z",
      },
    }));
    const { normalizeClaudeQuota } = await import(
      "../../open-sse/services/quota/providers/claude.js"
    );
    deps.refreshProviderQuota.mockImplementation(async () => {
      const now = Date.now();
      const [row] = normalizeClaudeQuota({
        five_hour: { utilization: 0, resets_at: providerResetAt },
      }, { now });
      const observedAt = new Date(now).toISOString();
      const snapshots = [{
        identity: {
          connectionId: connection.id,
          provider: "claude",
          accountKey: "scope:connection",
          resourceKey: "scope:account",
          dimensionKey: row.dimensionKey,
        },
        state: row.state,
        amounts: row.amounts,
        timing: {
          observedAt,
          staleAt: new Date(now + 60_000).toISOString(),
          resetAt: row.resetAt,
          cooldownUntil: null,
        },
        provenance: {
          sourceType: "provider_api",
          sourceId: "claude:oauth-usage:v1",
          reasonCode: null,
          metadata: row.metadata,
        },
      }];
      persistedSnapshots.set("claude:claude-1", snapshots);
      return { outcome: "success", snapshots };
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.proxyAwareFetch).toHaveBeenCalledOnce();
    expect(deps.updateProviderConnection).toHaveBeenCalledWith("claude-1", expect.objectContaining({
      lastPingedResetAt: "2026-01-01T12:00:00.000Z",
      lastPingedResetKey: "2026-01-01T12:00:00.000Z",
    }));
  });

  it("drains a successful Claude response body before marking the ping", async () => {
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(claudeTerminalSse) })
        .mockResolvedValueOnce({ done: true }),
      releaseLock: vi.fn(),
    };
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockResolvedValue([
      { id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" },
    ]);
    getClaudeUsage.mockResolvedValue({
      quotas: { "session (5h)": { resetAt: "2026-01-01T11:59:00.000Z" } },
    });
    deps.proxyAwareFetch.mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(reader.read).toHaveBeenCalledTimes(2);
    expect(reader.releaseLock).toHaveBeenCalledOnce();
    expect(deps.updateProviderConnection).toHaveBeenCalledOnce();
  });

  it.each([
    ["empty", ""],
    ["malformed", "data: {not-json}\n\n"],
    ["truncated", 'event: message_delta\ndata: {"type":"message_delta"}\n\n'],
    ["failed", 'event: error\ndata: {"type":"error","error":{"message":"failed"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'],
    ["contradictory", 'event: error\ndata: {"type":"message_stop"}\n\n'],
    ["post-terminal data", 'event: message_stop\ndata: {"type":"message_stop"}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"late"}}\n\n'],
  ])("does not record a Claude ping for a %s 200 stream", async (_label, responseText) => {
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockResolvedValue([
      { id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" },
    ]);
    getClaudeUsage.mockResolvedValue({
      quotas: { "session (5h)": { resetAt: "2026-01-01T11:59:00.000Z" } },
    });
    deps.proxyAwareFetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(responseText),
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
    expect(state.pingFailureUntil).toHaveProperty("claude:claude-1");
  });

  it("does not record a Codex ping for an empty or failed 200 stream", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
    });
    for (const responseText of [
      "",
      'event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed"}}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"failed"}}\n\n',
      'event: response.completed\ndata: {"type":"response.failed","response":{"status":"failed"}}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\nevent: response.failed\ndata: {"type":"response.failed","response":{"status":"failed"}}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\nevent: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"late"}\n\n',
      'data: [DONE]\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\nevent: response.failed\ndata: [DONE]\n\n',
    ]) {
      persistedSnapshots.clear();
      state.pingFailureUntil = {};
      deps.updateProviderConnection.mockClear();
      codexResponseText.mockResolvedValueOnce(responseText);
      await runQuotaAutoPingTick(deps, state);
      expect(deps.updateProviderConnection).not.toHaveBeenCalled();
    }
  });

  it("does not send a Claude ping while weekly quota is exhausted", async () => {
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockResolvedValue([
      { id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" },
    ]);
    getClaudeUsage.mockResolvedValue({
      quotas: {
        "session (5h)": { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T11:59:00.000Z" },
        weekly: { used: 100, total: 100, remaining: 0, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("rechecks a fresh Claude runtime blocker before the paid ping", async () => {
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockResolvedValue([
      { id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" },
    ]);
    getClaudeUsage.mockResolvedValue({
      quotas: { "session (5h)": { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T11:59:00.000Z" } },
    });
    const originalList = deps.listProviderQuotaSnapshots;
    let snapshotReads = 0;
    deps.listProviderQuotaSnapshots = vi.fn(async (query) => {
      snapshotReads += 1;
      const snapshots = await originalList(query);
      // Rotating providers (claude) now skip the proactive refresh, so key the
      // fresh blocker on the final pre-ping snapshot re-read instead.
      if (snapshotReads < 3) return snapshots;
      return [...snapshots, {
        identity: {
          connectionId: "claude-1",
          provider: "claude",
          accountKey: "scope:connection",
          resourceKey: "scope:account",
          dimensionKey: "requests:runtime",
        },
        state: "exhausted",
        amounts: { limitKind: "unknown", limit: null, used: null, remaining: null, remainingRatio: null, unit: null },
        timing: {
          observedAt: "2026-01-01T11:59:59.000Z",
          staleAt: "2026-01-01T12:01:00.000Z",
          resetAt: null,
          cooldownUntil: null,
        },
        provenance: { sourceType: "response_headers", sourceId: "claude:runtime-test:v1", reasonCode: "quota_exhausted", metadata: {} },
      }];
    });

    await runQuotaAutoPingTick(deps, state);

    // Rotating-refresh providers skip the proactive refresh (OmniRoute
    // 697946381d Front 2): the pre-ping re-read still happens and the blocker
    // is honored.
    expect(deps.refreshAndUpdateCredentials).not.toHaveBeenCalled();
    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("rechecks the Claude session itself immediately before the paid ping", async () => {
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockResolvedValue([
      { id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" },
    ]);
    getClaudeUsage.mockResolvedValue({
      quotas: { "session (5h)": { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T11:59:00.000Z" } },
    });
    const originalList = deps.listProviderQuotaSnapshots;
    let snapshotReads = 0;
    deps.listProviderQuotaSnapshots = vi.fn(async (query) => {
      snapshotReads += 1;
      const snapshots = await originalList(query);
      // Rotating providers (claude) now skip the proactive refresh, so flip
      // the session dimension on the final pre-ping snapshot re-read instead.
      if (snapshotReads < 3) return snapshots;
      return snapshots.map((snapshot) => snapshot.identity.dimensionKey === "requests:session"
        ? {
            ...snapshot,
            state: "exhausted",
            timing: {
              ...snapshot.timing,
              observedAt: "2026-01-01T11:59:59.000Z",
              staleAt: "2026-01-01T12:01:00.000Z",
            },
          }
        : snapshot);
    });

    await runQuotaAutoPingTick(deps, state);

    // Rotating-refresh providers skip the proactive refresh: the pre-ping
    // session re-read still happens and the exhaustion is honored.
    expect(deps.refreshAndUpdateCredentials).not.toHaveBeenCalled();
    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("cancels a non-ok Claude response body and does not mark the ping", async () => {
    const cancel = vi.fn().mockResolvedValue();
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockResolvedValue([
      { id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" },
    ]);
    getClaudeUsage.mockResolvedValue({
      quotas: { "session (5h)": { resetAt: "2026-01-01T11:59:00.000Z" } },
    });
    deps.proxyAwareFetch.mockResolvedValue({ ok: false, body: { cancel } });

    await runQuotaAutoPingTick(deps, state);

    expect(cancel).toHaveBeenCalledOnce();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("cancels a hung Claude response reader when the lifecycle deadline expires", async () => {
    const reader = {
      read: vi.fn().mockReturnValue(new Promise(() => {})),
      cancel: vi.fn().mockResolvedValue(),
      releaseLock: vi.fn(),
    };
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockResolvedValue([
      { id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" },
    ]);
    getClaudeUsage.mockResolvedValue({
      quotas: { "session (5h)": { resetAt: "2026-01-01T11:59:00.000Z" } },
    });
    deps.proxyAwareFetch.mockResolvedValue({ ok: true, body: { getReader: () => reader } });

    await runQuotaAutoPingTick(deps, state);

    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
    expect(state.running).toBe(false);
  });

  it("revalidates settings immediately before the outbound request", async () => {
    deps.getSettings
      .mockResolvedValueOnce({ claudeAutoPing: { connections: { "claude-1": true } } })
      .mockResolvedValueOnce({ claudeAutoPing: { connections: {} } });
    deps.getProviderConnections.mockResolvedValue([
      { id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" },
    ]);
    getClaudeUsage.mockResolvedValue({
      quotas: { "session (5h)": { resetAt: "2026-01-01T11:59:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getSettings).toHaveBeenCalledTimes(2);
    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("aborts before send when a connection is disabled during quota lookup", async () => {
    let resolveUsage;
    const usageBarrier = new Promise((resolve) => { resolveUsage = resolve; });
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockResolvedValue([
      { id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" },
    ]);
    getClaudeUsage.mockReturnValue(usageBarrier);

    const tick = runQuotaAutoPingTick(deps, state);
    await vi.waitFor(() => expect(getClaudeUsage).toHaveBeenCalledOnce());
    notifyQuotaAutoPingSettingChanged("claude", "claude-1", false, state);
    resolveUsage({ quotas: { "session (5h)": { resetAt: "2026-01-01T11:59:00.000Z" } } });
    await tick;

    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
    expect(state.running).toBe(false);
    expect(state.pingFailureUntil).not.toHaveProperty("claude:claude-1");
  });

  it("propagates disable aborts into an in-flight provider request", async () => {
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockResolvedValue([
      { id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" },
    ]);
    getClaudeUsage.mockResolvedValue({
      quotas: { "session (5h)": { resetAt: "2026-01-01T11:59:00.000Z" } },
    });
    deps.proxyAwareFetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));

    const tick = runQuotaAutoPingTick(deps, state);
    await vi.waitFor(() => expect(deps.proxyAwareFetch).toHaveBeenCalledOnce());
    const signal = deps.proxyAwareFetch.mock.calls[0][1].signal;
    notifyQuotaAutoPingSettingChanged("claude", "claude-1", false, state);
    await tick;

    expect(signal.aborted).toBe(true);
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
    expect(state.running).toBe(false);
  });

  it("bounds a hung preflight and releases the global scheduler", async () => {
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockResolvedValue([
      { id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" },
    ]);
    deps.refreshProviderQuota.mockReturnValue(new Promise(() => {}));

    await runQuotaAutoPingTick(deps, state);

    expect(state.running).toBe(false);
    expect(state.inflightControllers).not.toHaveProperty("claude:claude-1");
    expect(state.pingFailureUntil).toHaveProperty("claude:claude-1");

    deps.getSettings.mockResolvedValue({});
    await expect(runQuotaAutoPingTick(deps, state)).resolves.toBeUndefined();
    expect(state.running).toBe(false);
  });

  it("redacts credential refresh failures before logging", async () => {
    const canary = "opaqueautopingcredential987654321";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockResolvedValue([
      { id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" },
    ]);
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { resetAt: "2026-01-01T17:01:00.000Z" } },
    });
    // The proactive refresh is skipped for rotating providers, so force the
    // failure through the ping path itself.
    deps.getExecutor.mockImplementation(() => ({
      execute: vi.fn().mockRejectedValue(new Error(`refresh failed ${canary}`)),
    }));

    try {
      await runQuotaAutoPingTick(deps, state);
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain(canary);
    } finally {
      warn.mockRestore();
    }
  });

  it.each(["usage", "proxy"])("never logs an arbitrary %s failure body", async (failureSite) => {
    const canary = `opaque-${failureSite}-body-987654321`;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockResolvedValue([
      { id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" },
    ]);
    if (failureSite === "usage") getClaudeUsage.mockRejectedValue(new Error(canary));
    else {
      getClaudeUsage.mockResolvedValue({
        quotas: { "session (5h)": { resetAt: "2026-01-01T11:59:00.000Z" } },
      });
      deps.resolveConnectionProxyConfig.mockRejectedValue(new Error(canary));
    }

    try {
      await runQuotaAutoPingTick(deps, state);
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain(canary);
      expect(JSON.stringify(warn.mock.calls)).toContain(
        failureSite === "usage" ? "quota refresh failed" : "credential refresh failed",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("never logs an arbitrary scheduler failure body", async () => {
    const canary = "opaque-scheduler-body-987654321";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deps.getSettings.mockRejectedValue(new Error(canary));

    try {
      await runQuotaAutoPingTick(deps, state);
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain(canary);
      expect(JSON.stringify(warn.mock.calls)).toContain("scheduler tick failed");
    } finally {
      warn.mockRestore();
    }
  });

  it("coalesces overlapping ticks into one follow-up run", async () => {
    let releaseFirst;
    deps.getSettings
      .mockReturnValueOnce(new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValue({});

    const first = runQuotaAutoPingTick(deps, state);
    await vi.waitFor(() => expect(deps.getSettings).toHaveBeenCalledOnce());
    await runQuotaAutoPingTick(deps, state);
    expect(state.rerunRequested).toBe(true);
    releaseFirst({});
    await first;
    await vi.waitFor(() => expect(deps.getSettings).toHaveBeenCalledTimes(2));

    expect(state.running).toBe(false);
    expect(state.rerunRequested).toBe(false);
  });

  it("starts exactly one process-wide interval", async () => {
    vi.useFakeTimers();
    const { getSettings } = await import("@/lib/localDb");
    getSettings.mockResolvedValue({});

    startQuotaAutoPing();
    startQuotaAutoPing();
    await Promise.resolve();

    expect(vi.getTimerCount()).toBe(1);
    expect(getSettings).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60000);
    expect(getSettings).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });
});
