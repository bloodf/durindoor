import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(),
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/shared/services/providerCredentials", () => ({
  refreshAndUpdateCredentials: vi.fn(),
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
}));

vi.mock("open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(),
}));

describe("quota auto-ping", () => {
  let runQuotaAutoPingTick;
  let notifyQuotaAutoPingSettingChanged;
  let startQuotaAutoPing;
  let deps;
  let state;
  let getCodexUsage;
  let getClaudeUsage;
  let getExecutor;
  let codexResponseText;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    delete global.__quotaAutoPing;

    ({ getCodexUsage } = await import("open-sse/services/usage/codex.js"));
    ({ getClaudeUsage } = await import("open-sse/services/usage/claude.js"));
    ({ getExecutor } = await import("open-sse/executors/index.js"));
    ({
      runQuotaAutoPingTick,
      notifyQuotaAutoPingSettingChanged,
      startQuotaAutoPing,
    } = await import("../../src/shared/services/quotaAutoPing.js"));

    deps = {
      getSettings: vi.fn(),
      getProviderConnections: vi.fn(),
      updateProviderConnection: vi.fn(),
      resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
      refreshAndUpdateCredentials: vi.fn(async (connection) => ({ connection, refreshed: false })),
      proxyAwareFetch: vi.fn().mockResolvedValue({ ok: true }),
      getExecutor: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue({ response: { ok: true, text: codexResponseText } }),
      })),
    };
    codexResponseText = vi.fn().mockResolvedValue("");
    getExecutor.mockReturnValue({
      execute: vi.fn().mockResolvedValue({ response: { ok: true, text: codexResponseText } }),
    });
    state = {
      running: false,
      resetCache: {},
      failureCache: {},
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
    expect(getCodexUsage).toHaveBeenCalledWith(
      "token", { workspaceId: "account-auto-ping" }, expect.objectContaining({ strictProxy: false }),
    );
    expect(state.resetCache["codex:codex-1"]).toBe("2026-01-01T13:00:00.000Z");
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
    expect(state.resetCache["codex:codex-1"]).toBe("2026-01-01T17:00:00.000Z");
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

  it("sends one tiny gpt-5.5 Codex request through the executor", async () => {
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
      model: "gpt-5.5",
      stream: true,
      credentials: expect.objectContaining({
        accessToken: "token",
        connectionId: "codex-1",
        providerSpecificData: { workspaceId: "ws-1" },
      }),
      body: {
        model: "gpt-5.5",
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
    });
  });

  it("drains a successful Claude response body before marking the ping", async () => {
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array([1]) })
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
    expect(state.failureCache).not.toHaveProperty("claude:claude-1");
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
    deps.resolveConnectionProxyConfig.mockReturnValue(new Promise(() => {}));

    await runQuotaAutoPingTick(deps, state);

    expect(state.running).toBe(false);
    expect(state.inflightControllers).not.toHaveProperty("claude:claude-1");
    expect(state.failureCache).toHaveProperty("claude:claude-1");

    deps.getSettings.mockResolvedValue({});
    await expect(runQuotaAutoPingTick(deps, state)).resolves.toBeUndefined();
    expect(state.running).toBe(false);
  });

  it("redacts credential refresh failures before logging", async () => {
    const canary = "opaqueautopingcredential987654321";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockResolvedValue([
      { id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" },
    ]);
    deps.refreshAndUpdateCredentials.mockRejectedValue(new Error(`refresh failed ${canary}`));

    try {
      await runQuotaAutoPingTick(deps, state);
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain(canary);
      expect(JSON.stringify(warn.mock.calls)).toContain("credential refresh failed");
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
    else deps.resolveConnectionProxyConfig.mockRejectedValue(new Error(canary));

    try {
      await runQuotaAutoPingTick(deps, state);
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain(canary);
      expect(JSON.stringify(warn.mock.calls)).toContain("provider ping failed");
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
