import { beforeEach, describe, expect, it, vi } from "vitest";
import { quotaIdentityKey } from "../../src/shared/utils/quotaSnapshot.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  projectProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  evaluateApiKeyAuth: vi.fn(),
  handleChatCore: vi.fn(),
  refreshAndUpdateCredentials: vi.fn(),
  refreshProviderQuota: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getApiKeyByKey: mocks.getApiKeyByKey,
  getApiKeyUsageLimitStatus: mocks.getApiKeyUsageLimitStatus,
}));

vi.mock("../../src/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
  loadCustomCapabilities: async () => null,
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentials,
  projectProviderCredentials: mocks.projectProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: vi.fn(() => null),
  evaluateApiKeyAuth: mocks.evaluateApiKeyAuth,
  resolveClientApiKey: async (request, options) => ({
    apiKey: null,
    auth: await mocks.evaluateApiKeyAuth(null, { ...options, request }),
  }),
  providerAllowsPublicNoAuthFallback: vi.fn(() => false),
}));

vi.mock("@/shared/services/providerCredentials", () => ({
  refreshAndUpdateCredentials: mocks.refreshAndUpdateCredentials,
}));

vi.mock("@/shared/services/providerQuotaTracker", () => ({
  refreshProviderQuota: mocks.refreshProviderQuota,
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
}));

vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));

vi.mock("../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));

vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: vi.fn(async () => null),
}));


const { handleChat, rankComboModelsByQuota, __resetAntigravity429StrikesForTests } = await import("../../src/sse/handlers/chat.js");

function request(model = "codex/gpt-5.4", signal = null) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    }),
    ...(signal ? { signal } : {}),
  });
}

function selected(id, provider = "codex") {
  const connection = {
    id,
    provider,
    authType: "oauth",
    accessToken: `access-${id}`,
    refreshToken: `refresh-${id}`,
    providerSpecificData: {},
  };
  return {
    connectionId: id,
    connectionName: id,
    accessToken: connection.accessToken,
    providerSpecificData: {},
    _connection: connection,
    _quotaPreflight: { eligible: true, skip: false, reason: "available", freshness: "fresh", shouldRefresh: false },
  };
}

function exhaustedQuotaSnapshot(connectionId, provider, model, resetAt) {
  const now = Date.now();
  return {
    identity: {
      connectionId,
      provider,
      accountKey: "scope:connection",
      resourceKey: `model:${model}`,
      dimensionKey: "requests:quota",
    },
    state: "exhausted",
    amounts: { limitKind: "unknown", limit: null, used: null, remaining: 0, remainingRatio: 0, unit: "requests" },
    timing: {
      observedAt: new Date(now - 1_000).toISOString(),
      staleAt: new Date(now + 60_000).toISOString(),
      resetAt,
      cooldownUntil: null,
    },
    provenance: {
      sourceType: "provider_api",
      sourceId: `${provider}:retrieve-user-quota:v1`,
      reasonCode: "quota_exhausted",
      metadata: {},
    },
  };
}

function antigravityFailure(options, status = 429, extra = {}) {
  return {
    success: false,
    status,
    error: `HTTP ${status}`,
    response: new Response(`HTTP ${status}`, { status }),
    attemptStartedAt: options.onProviderAttempt(),
    ...extra,
  };
}

function comboProfile(provider, connectionId, model, ratio, {
  reason = "available",
  dimensionKey = "requests:session",
  unit = "requests",
  limit = 100,
} = {}) {
  const resourceKey = `model:${model}`;
  return {
    tracked: true,
    freshness: "fresh",
    gateMode: "all-required",
    effectiveRatio: ratio,
    unreservedEffectiveRatio: null,
    comparisonKey: `all-required|model:${dimensionKey}:${unit}`,
    routingWindows: [{ resourceKey, dimensionKey, unit, ratio }],
    reservationAlternatives: [[{
      accountKey: "scope:connection",
      resourceKey,
      dimensionKey,
      requiredAmount: 1,
      limitValue: limit,
      remainingValue: ratio * limit,
    }]],
    reason,
    provider,
    connectionId,
  };
}

function comboDependencies({
  connections,
  decisions,
  pressure = new Map(),
  locked = new Set(),
  publicNoAuthProviders = new Set(),
  health = () => "healthy",
}) {
  return {
    getModelInfo: async (modelStr) => {
      const [provider, ...rest] = modelStr.split("/");
      return { provider, model: rest.join("/") };
    },
    getProviderConnections: async ({ provider }) => connections.get(provider) || [],
    inspectProviderQuota: async (rows) => new Map(rows.map((row) => [row.id, decisions.get(row.id) || {
      eligible: true,
      skip: false,
      reason: "missing",
      freshness: "missing",
      quotaProfile: null,
    }])),
    getQuotaReservationPressure: async ({ connectionIds }) => new Map(
      connectionIds.map((id) => [id, pressure.get(id) || { activeCount: 0, lastSelectedAt: null, debits: new Map() }]),
    ),
    isProviderConnectionModelLocked: (connection) => locked.has(connection.id),
    providerAllowsPublicNoAuthFallback: (provider) => publicNoAuthProviders.has(provider),
    getComboModelQuotaHealth: health,
  };
}

describe("chat combo quota preview", () => {
  const connection = (id, provider, priority = 1) => ({ id, provider, priority, isActive: true, testStatus: "active" });
  const decision = (quotaProfile, extra = {}) => ({
    eligible: true,
    skip: false,
    reason: quotaProfile?.reason || "available",
    freshness: quotaProfile?.freshness || "missing",
    quotaProfile,
    ...extra,
  });

  it("uses committed debit pressure in the final model order", async () => {
    const a = connection("a-1", "a");
    const b = connection("b-1", "b");
    const aProfile = comboProfile("a", a.id, "model", 1, { limit: 1 });
    const bProfile = comboProfile("b", b.id, "model", 0.5);
    const pressureKey = quotaIdentityKey({
      connectionId: a.id,
      provider: "a",
      accountKey: "scope:connection",
      resourceKey: "model:model",
      dimensionKey: "requests:session",
    });
    const ordered = await rankComboModelsByQuota(
      ["a/model", "b/model"],
      {},
      Date.now(),
      "combo",
      "fallback",
      comboDependencies({
        connections: new Map([["a", [a]], ["b", [b]]]),
        decisions: new Map([[a.id, decision(aProfile)], [b.id, decision(bProfile)]]),
        pressure: new Map([[a.id, { activeCount: 0, lastSelectedAt: null, debits: new Map([[pressureKey, 1]]) }]]),
      }),
    );
    expect(ordered).toEqual(["b/model", "a/model"]);
  });

  it("mirrors fixed-slot untracked and legacy-lock account selection", async () => {
    const b = connection("b-1", "b");
    const aUntracked = connection("a-untracked", "a", 1);
    const aTracked = connection("a-tracked", "a", 2);
    const decisions = new Map([
      [b.id, decision(comboProfile("b", b.id, "model", 0.5))],
      [aUntracked.id, decision(null)],
      [aTracked.id, decision(comboProfile("a", aTracked.id, "model", 0.9))],
    ]);
    const untrackedOrder = await rankComboModelsByQuota(
      ["b/model", "a/model"], {}, Date.now(), "combo", "fallback",
      comboDependencies({
        connections: new Map([["a", [aUntracked, aTracked]], ["b", [b]]]),
        decisions,
      }),
    );
    expect(untrackedOrder).toEqual(["b/model", "a/model"]);

    decisions.set(aUntracked.id, decision(comboProfile("a", aUntracked.id, "model", 0.9)));
    decisions.set(aTracked.id, decision(comboProfile("a", aTracked.id, "model", 0.1)));
    const lockedOrder = await rankComboModelsByQuota(
      ["a/model", "b/model"], {}, Date.now(), "combo", "fallback",
      comboDependencies({
        connections: new Map([["a", [aUntracked, aTracked]], ["b", [b]]]),
        decisions,
        locked: new Set([aUntracked.id]),
      }),
    );
    expect(lockedOrder).toEqual(["b/model", "a/model"]);

    const allLockedOrder = await rankComboModelsByQuota(
      ["a/model", "b/model"], {}, Date.now(), "combo", "fallback",
      comboDependencies({
        connections: new Map([["a", [aUntracked, aTracked]], ["b", [b]]]),
        decisions,
        locked: new Set([aUntracked.id, aTracked.id]),
      }),
    );
    expect(allLockedOrder).toEqual(["b/model", "a/model"]);

    const publicNoAuthOrder = await rankComboModelsByQuota(
      ["a/model", "b/model"], {}, Date.now(), "combo", "fallback",
      comboDependencies({
        connections: new Map([["a", [aUntracked, aTracked]], ["b", [b]]]),
        decisions,
        locked: new Set([aUntracked.id, aTracked.id]),
        publicNoAuthProviders: new Set(["a"]),
      }),
    );
    expect(publicNoAuthOrder).toEqual(["a/model", "b/model"]);

    const publicBlockedDecisions = new Map(decisions);
    publicBlockedDecisions.set(aUntracked.id, decision(null, {
      eligible: false,
      skip: true,
      reason: "exhausted",
      freshness: "fresh",
    }));
    publicBlockedDecisions.set(aTracked.id, decision(null, {
      eligible: false,
      skip: true,
      reason: "exhausted",
      freshness: "fresh",
    }));
    const publicBlockedOrder = await rankComboModelsByQuota(
      ["a/model", "b/model"], {}, Date.now(), "combo", "fallback",
      comboDependencies({
        connections: new Map([["a", [aUntracked, aTracked]], ["b", [b]]]),
        decisions: publicBlockedDecisions,
        publicNoAuthProviders: new Set(["a"]),
      }),
    );
    expect(publicBlockedOrder).toEqual(["a/model", "b/model"]);
  });

  it("moves hard-blocked models last across cohorts and scopes smart health to its strategy", async () => {
    const a = connection("a-1", "a");
    const b = connection("b-1", "b");
    const aProfile = {
      tracked: false,
      freshness: "fresh",
      gateMode: null,
      effectiveRatio: null,
      comparisonKey: null,
      routingWindows: [],
      reservationAlternatives: [],
      reason: "exhausted",
    };
    const bProfile = comboProfile("b", b.id, "model", 0.5, {
      dimensionKey: "tokens:session",
      unit: "tokens",
    });
    const blocked = await rankComboModelsByQuota(
      ["a/model", "b/model"], {}, Date.now(), "combo", "fallback",
      comboDependencies({
        connections: new Map([["a", [a]], ["b", [b]]]),
        decisions: new Map([
          [a.id, decision(aProfile, { eligible: false, skip: true, reason: "exhausted" })],
          [b.id, decision(bProfile)],
        ]),
      }),
    );
    expect(blocked).toEqual(["b/model", "a/model"]);

    const healthyB = comboProfile("b", b.id, "model", 0.5);
    const slightlyHigherA = comboProfile("a", a.id, "model", 0.51);
    const deps = comboDependencies({
      connections: new Map([["a", [a]], ["b", [b]]]),
      decisions: new Map([[a.id, decision(slightlyHigherA)], [b.id, decision(healthyB)]]),
      health: (_combo, model) => model === "a/model" ? "unhealthy" : "healthy",
    });
    expect(await rankComboModelsByQuota(["a/model", "b/model"], {}, Date.now(), "combo", "fallback", deps))
      .toEqual(["a/model", "b/model"]);
    expect(await rankComboModelsByQuota(["a/model", "b/model"], {}, Date.now(), "combo", "smart-scoring", deps))
      .toEqual(["b/model", "a/model"]);
  });
});

describe("chat quota fallback orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAntigravity429StrikesForTests();
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      rtkEnabled: false,
      headroomEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
    });
    mocks.getApiKeyByKey.mockResolvedValue(null);
    mocks.getApiKeyUsageLimitStatus.mockResolvedValue({ exceeded: false });
    mocks.evaluateApiKeyAuth.mockResolvedValue({ ok: true, stored: false });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({ provider: "codex", model: "gpt-5.4" });
    mocks.refreshAndUpdateCredentials.mockImplementation(async (connection) => ({ connection, refreshed: false }));
    mocks.projectProviderCredentials.mockImplementation(async (connection, quota) => ({
      ...selected(connection.id),
      _connection: connection,
      _quotaPreflight: quota,
    }));
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 2000 });
    mocks.clearAccountError.mockResolvedValue();
  });

  it("reports an unconfigured registered provider with an actionable 404", async () => {
    mocks.getModelInfo.mockResolvedValue({ provider: "codex", model: "gpt-5.4" });
    mocks.getProviderCredentials.mockResolvedValue(null);

    const response = await handleChat(request());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatchObject({
      code: "provider_not_configured",
      message: "No active credentials for provider: codex. Connect an account for this provider in the dashboard.",
    });
  });

  it("reports an unknown provider as model_not_found", async () => {
    mocks.getModelInfo.mockResolvedValue({ provider: "unknown-provider", model: "missing-model" });
    mocks.getProviderCredentials.mockResolvedValue(null);

    const response = await handleChat(request("unknown-provider/missing-model"));

    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatchObject({
      code: "model_not_found",
      message: "Unknown provider \"unknown-provider\" in model \"unknown-provider/missing-model\". See /v1/models for what this router serves.",
    });
  });

  it.each([
    "cc",
    "openai-compatible-mybox",
    "anthropic-compatible-mybox",
  ])("recognizes %s as a routable provider", async (provider) => {
    mocks.getModelInfo.mockResolvedValue({ provider, model: "missing-model" });
    mocks.getProviderCredentials.mockResolvedValue(null);

    const response = await handleChat(request(`${provider}/missing-model`));

    expect((await response.json()).error.code).toBe("provider_not_configured");
  });

  it.each([
    "openai-compatible-",
    "anthropic-compatible-",
  ])("does not treat bare compatible prefix %s as routable", async (provider) => {
    mocks.getModelInfo.mockResolvedValue({ provider, model: "missing-model" });
    mocks.getProviderCredentials.mockResolvedValue(null);

    const response = await handleChat(request(`${provider}/missing-model`));

    expect((await response.json()).error.code).toBe("model_not_found");
  });

  it.each([
    ["quota exhaustion", 429, { error: { message: "额度不足", type: "quota_exhausted" } }, "connection"],
    ["model denial", 403, { error: { message: "无权访问模型 claude-opus", type: "auth_error" } }, "model"],
    ["prompt echo", 400, { error: { message: "Forbidden", type: "invalid_request_error" }, prompt: "额度不足" }, null],
  ])("forwards structured AgentRouter %s context to fallback", async (_name, status, errorBody, expectedScope) => {
    const account = selected("agentrouter-conn");
    mocks.getModelInfo.mockResolvedValue({ provider: "agentrouter", model: "claude-opus" });
    mocks.getProviderCredentials.mockResolvedValue(account);
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });
    mocks.handleChatCore.mockImplementationOnce(async (options) => ({
      success: false,
      status,
      error: "Forbidden",
      errorBody,
      headers: new Headers({ "retry-after": "60" }),
      response: new Response("error", { status }),
      attemptStartedAt: options.onProviderAttempt(),
    }));

    await handleChat(request());

    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith(
      "agentrouter-conn",
      status,
      "Forbidden",
      "agentrouter",
      "claude-opus",
      undefined,
      expect.objectContaining({
        errorBody,
        headers: expect.any(Headers),
        attemptStartedAt: expect.any(Number),
      }),
    );
    expect(checkFallbackError(status, "Forbidden", 0, "agentrouter", null, errorBody).scope).toBe(expectedScope);
  });

  it("persists the first 429 context, attempts each account once, and returns one winning stream", async () => {
    const first = selected("conn-one");
    const second = selected("conn-two");
    const selectionExcludes = [];
    mocks.getProviderCredentials.mockImplementation(async (_provider, excluded) => {
      selectionExcludes.push([...(excluded || [])]);
      if (!excluded?.has("conn-one")) return first;
      if (!excluded.has("conn-two")) return second;
      return null;
    });
    mocks.handleChatCore
      .mockImplementationOnce(async (options) => {
        const attemptStartedAt = options.onProviderAttempt();
        return {
          success: false,
          status: 429,
          error: "[429]: Rate limit exceeded",
          resetsAtMs: Date.now() + 60_000,
          rateLimitEvidence: { state: "cooldown", resetAtMs: Date.now() + 60_000, source: "retry_after" },
          response: new Response("first-error-canary", { status: 429 }),
          attemptStartedAt,
        };
      })
      .mockImplementationOnce(async (options) => {
        const attemptStartedAt = options.onProviderAttempt();
        await options.onRequestSuccess();
        return {
          success: true,
          attemptStartedAt,
          response: new Response("data: {\"ok\":true}\n\ndata: [DONE]\n\n", {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        };
      });

    const response = await handleChat(request());
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text.match(/\[DONE\]/g)).toHaveLength(1);
    expect(text).not.toContain("first-error-canary");
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(2);
    expect(selectionExcludes).toEqual([[], ["conn-one"]]);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith(
      "conn-one",
      429,
      "[429]: Rate limit exceeded",
      "codex",
      "gpt-5.4",
      expect.any(Number),
      expect.objectContaining({
        attemptStartedAt: expect.any(Number),
        rateLimitEvidence: expect.objectContaining({ state: "cooldown" }),
      }),
    );
    expect(mocks.clearAccountError).toHaveBeenCalledWith(
      "conn-two",
      expect.objectContaining({ connectionId: "conn-two" }),
      "gpt-5.4",
      expect.objectContaining({ provider: "codex", attemptStartedAt: expect.any(Number) }),
    );
  });

  it("refreshes Antigravity quota once and reselects another account without a legacy lock", async () => {
    const model = "claude-opus-4-6-thinking";
    const first = selected("agy-one", "agy");
    const second = selected("agy-two", "agy");
    const resetAt = new Date(Date.now() + 60_000).toISOString();
    const selectionExcludes = [];
    mocks.getModelInfo.mockResolvedValue({ provider: "agy", model });
    mocks.getProviderCredentials.mockImplementation(async (_provider, excluded) => {
      selectionExcludes.push([...(excluded || [])]);
      return selectionExcludes.length === 1 ? first : second;
    });
    mocks.refreshProviderQuota.mockResolvedValue({
      outcome: "success",
      snapshots: [exhaustedQuotaSnapshot(first.connectionId, "agy", model, resetAt)],
    });
    mocks.handleChatCore
      .mockImplementationOnce(async (options) => ({
        success: false,
        status: 409,
        error: "Quota exhausted",
        response: new Response("quota exhausted", { status: 409 }),
        attemptStartedAt: options.onProviderAttempt(),
      }))
      .mockImplementationOnce(async (options) => {
        const attemptStartedAt = options.onProviderAttempt();
        await options.onRequestSuccess();
        return {
          success: true,
          attemptStartedAt,
          response: new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        };
      });

    const response = await handleChat(request(`agy/${model}`));

    expect(response.status).toBe(200);
    expect(mocks.refreshProviderQuota).toHaveBeenCalledOnce();
    expect(mocks.refreshProviderQuota).toHaveBeenCalledWith(
      first._connection,
      expect.objectContaining({ force: true, signal: expect.any(AbortSignal) }),
    );
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
    expect(selectionExcludes).toEqual([[], []]);
    expect(mocks.handleChatCore.mock.calls.map(([options]) => options.connectionId))
      .toEqual(["agy-one", "agy-two"]);
  });

  it("returns the repository's earliest reset when refreshed Antigravity quota leaves every account exhausted", async () => {
    const model = "claude-opus-4-6-thinking";
    const first = selected("ag-one", "antigravity");
    const firstReset = new Date(Date.now() + 60_000).toISOString();
    const earliestReset = new Date(Date.now() + 30_000).toISOString();
    mocks.getModelInfo.mockResolvedValue({ provider: "antigravity", model });
    mocks.getProviderCredentials
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({
        allRateLimited: true,
        retryAfter: earliestReset,
        retryAfterHuman: "reset after 30s",
        lastError: "Rate limited",
        lastErrorCode: 429,
      });
    mocks.refreshProviderQuota.mockResolvedValue({
      outcome: "success",
      snapshots: [exhaustedQuotaSnapshot(first.connectionId, "antigravity", model, firstReset)],
    });
    mocks.handleChatCore.mockImplementationOnce(async (options) => ({
      success: false,
      status: 429,
      error: "Rate limit exceeded",
      response: new Response("rate limited", { status: 429 }),
      attemptStartedAt: options.onProviderAttempt(),
    }));

    const response = await handleChat(request(`antigravity/${model}`));
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload.error.retry_after).toBe(earliestReset);
    expect(mocks.refreshProviderQuota).toHaveBeenCalledOnce();
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
    expect(mocks.getProviderCredentials.mock.calls.map(([, excluded]) => [...(excluded || [])]))
      .toEqual([[], []]);
  });

  it("keeps executor-provided Antigravity reset metadata on the existing fallback path", async () => {
    const model = "claude-opus-4-6-thinking";
    const account = selected("ag-one", "antigravity");
    const resetAtMs = Date.now() + 60_000;
    mocks.getModelInfo.mockResolvedValue({ provider: "antigravity", model });
    mocks.getProviderCredentials.mockResolvedValue(account);
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });
    mocks.handleChatCore.mockImplementationOnce(async (options) => ({
      success: false,
      status: 429,
      error: "Rate limit exceeded",
      resetsAtMs: resetAtMs,
      response: new Response("rate limited", { status: 429 }),
      attemptStartedAt: options.onProviderAttempt(),
    }));

    await handleChat(request(`antigravity/${model}`));

    expect(mocks.refreshProviderQuota).not.toHaveBeenCalled();
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith(
      account.connectionId,
      429,
      "Rate limit exceeded",
      "antigravity",
      model,
      resetAtMs,
      expect.objectContaining({ attemptStartedAt: expect.any(Number) }),
    );
  });

  it("persists a 15-minute model lock on the third optimistic Antigravity 429", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const model = "claude-opus-4-6-thinking";
    const account = selected("ag-strike", "antigravity");
    mocks.getModelInfo.mockResolvedValue({ provider: "antigravity", model });
    mocks.getProviderCredentials.mockResolvedValue(account);
    mocks.refreshProviderQuota.mockResolvedValue({ outcome: "success", snapshots: [] });
    mocks.handleChatCore.mockImplementation(async (options) => antigravityFailure(options));
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });

    try {
      await handleChat(request(`antigravity/${model}`));
      await handleChat(request(`antigravity/${model}`));
      await handleChat(request(`antigravity/${model}`));

      expect(mocks.markAccountUnavailable.mock.calls.map((call) => call[5])).toEqual([
        undefined,
        undefined,
        Date.parse("2026-09-01T00:15:00.000Z"),
      ]);
      expect(mocks.markAccountUnavailable.mock.calls.at(-1)[6].rateLimitEvidence).toEqual({
        state: "cooldown",
        resetAtMs: Date.parse("2026-09-01T00:15:00.000Z"),
        source: "antigravity_strike_breaker",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes a new logical request skip the persisted strike-locked connection", async () => {
    const model = "claude-opus-4-6-thinking";
    const primary = selected("ag-primary", "antigravity");
    const secondary = selected("ag-secondary", "antigravity");
    let primaryLocked = false;
    mocks.getModelInfo.mockResolvedValue({ provider: "antigravity", model });
    mocks.getProviderCredentials.mockImplementation(async (_provider, excluded) =>
      !primaryLocked && !excluded?.has(primary.connectionId) ? primary : secondary,
    );
    mocks.refreshProviderQuota.mockResolvedValue({ outcome: "success", snapshots: [] });
    mocks.handleChatCore.mockImplementation(async (options) => {
      if (options.connectionId === secondary.connectionId) {
        return { success: true, response: new Response("ok", { status: 200 }) };
      }
      return antigravityFailure(options);
    });
    mocks.markAccountUnavailable.mockImplementation(async (_id, _status, _error, _provider, _model, resetsAtMs) => {
      if (Number.isFinite(resetsAtMs)) primaryLocked = true;
      return { shouldFallback: false, cooldownMs: 0 };
    });

    await handleChat(request(`antigravity/${model}`));
    await handleChat(request(`antigravity/${model}`));
    await handleChat(request(`antigravity/${model}`));
    const callsBeforeNewRequest = mocks.handleChatCore.mock.calls.length;
    await handleChat(request(`antigravity/${model}`));

    expect(primaryLocked).toBe(true);
    expect(mocks.handleChatCore.mock.calls[callsBeforeNewRequest][0].connectionId).toBe(secondary.connectionId);
  });

  it("clears optimistic strikes after a successful request", async () => {
    const model = "claude-opus-4-6-thinking";
    const account = selected("ag-success-reset", "antigravity");
    mocks.getModelInfo.mockResolvedValue({ provider: "antigravity", model });
    mocks.getProviderCredentials.mockResolvedValue(account);
    mocks.refreshProviderQuota.mockResolvedValue({ outcome: "success", snapshots: [] });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });
    mocks.handleChatCore
      .mockImplementationOnce(async (options) => antigravityFailure(options))
      .mockImplementationOnce(async (options) => {
        const attemptStartedAt = options.onProviderAttempt();
        await options.onRequestSuccess({ attemptStartedAt });
        return { success: true, response: new Response("ok", { status: 200 }), attemptStartedAt };
      })
      .mockImplementation(async (options) => antigravityFailure(options));

    await handleChat(request(`antigravity/${model}`));
    await handleChat(request(`antigravity/${model}`));
    await handleChat(request(`antigravity/${model}`));
    await handleChat(request(`antigravity/${model}`));

    expect(mocks.markAccountUnavailable.mock.calls.map((call) => call[5])).toEqual([undefined, undefined, undefined]);
  });

  it("anchors the strike window at the first qualifying 429", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const model = "claude-opus-4-6-thinking";
    const account = selected("ag-fixed-window", "antigravity");
    mocks.getModelInfo.mockResolvedValue({ provider: "antigravity", model });
    mocks.getProviderCredentials.mockResolvedValue(account);
    mocks.refreshProviderQuota.mockResolvedValue({ outcome: "success", snapshots: [] });
    mocks.handleChatCore.mockImplementation(async (options) => antigravityFailure(options));
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });

    try {
      await handleChat(request(`antigravity/${model}`));
      vi.advanceTimersByTime(50_000);
      await handleChat(request(`antigravity/${model}`));
      vi.advanceTimersByTime(11_000);
      await handleChat(request(`antigravity/${model}`));

      expect(mocks.markAccountUnavailable.mock.calls.map((call) => call[5])).toEqual([undefined, undefined, undefined]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never counts HTTP 409 toward the Antigravity strike breaker", async () => {
    const model = "claude-opus-4-6-thinking";
    const account = selected("ag-409", "antigravity");
    mocks.getModelInfo.mockResolvedValue({ provider: "antigravity", model });
    mocks.getProviderCredentials.mockResolvedValue(account);
    mocks.refreshProviderQuota.mockResolvedValue({ outcome: "success", snapshots: [] });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });
    mocks.handleChatCore.mockImplementation(async (options) => antigravityFailure(options, 409));

    await handleChat(request(`antigravity/${model}`));
    await handleChat(request(`antigravity/${model}`));
    await handleChat(request(`antigravity/${model}`));
    mocks.handleChatCore.mockImplementation(async (options) => antigravityFailure(options));
    await handleChat(request(`antigravity/${model}`));
    await handleChat(request(`antigravity/${model}`));

    expect(mocks.markAccountUnavailable.mock.calls.map((call) => call[5])).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("counts reset-free 429s when reactive quota refresh fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const model = "claude-opus-4-6-thinking";
    const account = selected("agy-refresh-failed", "agy");
    mocks.getModelInfo.mockResolvedValue({ provider: "agy", model });
    mocks.getProviderCredentials.mockResolvedValue(account);
    mocks.refreshProviderQuota.mockRejectedValue(new Error("quota API unavailable"));
    mocks.handleChatCore.mockImplementation(async (options) => antigravityFailure(options));
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });

    try {
      await handleChat(request(`agy/${model}`));
      await handleChat(request(`agy/${model}`));
      await handleChat(request(`agy/${model}`));

      expect(mocks.markAccountUnavailable.mock.calls.at(-1)[5]).toBe(Date.parse("2026-09-01T00:15:00.000Z"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears strikes when exact refreshed quota is exhausted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const model = "claude-opus-4-6-thinking";
    const account = selected("ag-exact-reset", "antigravity");
    const retryAfter = "2026-09-01T00:01:00.000Z";
    mocks.getModelInfo.mockResolvedValue({ provider: "antigravity", model });
    mocks.getProviderCredentials.mockResolvedValue(account);
    mocks.refreshProviderQuota.mockResolvedValue({ outcome: "success", snapshots: [] });
    mocks.handleChatCore.mockImplementation(async (options) => antigravityFailure(options));
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });

    try {
      await handleChat(request(`antigravity/${model}`));
      mocks.refreshProviderQuota.mockResolvedValueOnce({
        outcome: "success",
        snapshots: [exhaustedQuotaSnapshot(account.connectionId, "antigravity", model, retryAfter)],
      });
      mocks.getProviderCredentials
        .mockResolvedValueOnce(account)
        .mockResolvedValueOnce({ allRateLimited: true, retryAfter, retryAfterHuman: "reset after 60s", lastError: "Rate limited", lastErrorCode: 429 });
      await handleChat(request(`antigravity/${model}`));
      mocks.getProviderCredentials.mockResolvedValue(account);
      await handleChat(request(`antigravity/${model}`));
      await handleChat(request(`antigravity/${model}`));

      expect(mocks.refreshProviderQuota).toHaveBeenCalledTimes(4);
      expect(mocks.getProviderCredentials).toHaveBeenCalledTimes(5);
      expect(mocks.markAccountUnavailable).toHaveBeenCalledTimes(3);
      expect(mocks.markAccountUnavailable.mock.calls.map((call) => call[5])).toEqual([undefined, undefined, undefined]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes exhausted body evidence and preserves it on the strike breaker", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const model = "claude-opus-4-6-thinking";
    const account = selected("ag-exhausted-evidence", "antigravity");
    const evidence = { state: "exhausted", resetAtMs: null, source: "executor" };
    mocks.getModelInfo.mockResolvedValue({ provider: "antigravity", model });
    mocks.getProviderCredentials.mockResolvedValue(account);
    mocks.refreshProviderQuota.mockResolvedValue({ outcome: "success", snapshots: [] });
    mocks.handleChatCore.mockImplementation(async (options) => antigravityFailure(options, 429, {
      rateLimitEvidence: evidence,
    }));
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });

    try {
      await handleChat(request(`antigravity/${model}`));
      await handleChat(request(`antigravity/${model}`));
      await handleChat(request(`antigravity/${model}`));

      expect(mocks.refreshProviderQuota).toHaveBeenCalledTimes(3);
      expect(mocks.markAccountUnavailable.mock.calls.map((call) => call[5])).toEqual([
        undefined,
        undefined,
        Date.parse("2026-09-01T00:15:00.000Z"),
      ]);
      expect(mocks.markAccountUnavailable.mock.calls.at(-1)[6].rateLimitEvidence).toEqual({
        state: "exhausted",
        resetAtMs: Date.parse("2026-09-01T00:15:00.000Z"),
        source: "antigravity_strike_breaker",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears strikes when executor-authoritative reset evidence owns the cooldown", async () => {
    const model = "claude-opus-4-6-thinking";
    const account = selected("ag-authoritative-reset", "antigravity");
    const resetAtMs = Date.now() + 60_000;
    mocks.getModelInfo.mockResolvedValue({ provider: "antigravity", model });
    mocks.getProviderCredentials.mockResolvedValue(account);
    mocks.refreshProviderQuota.mockResolvedValue({ outcome: "success", snapshots: [] });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });
    mocks.handleChatCore
      .mockImplementationOnce(async (options) => antigravityFailure(options))
      .mockImplementationOnce(async (options) => antigravityFailure(options, 429, {
        resetsAtMs: resetAtMs,
        rateLimitEvidence: { state: "cooldown", resetAtMs, source: "executor" },
      }))
      .mockImplementation(async (options) => antigravityFailure(options));

    await handleChat(request(`antigravity/${model}`));
    await handleChat(request(`antigravity/${model}`));
    await handleChat(request(`antigravity/${model}`));
    await handleChat(request(`antigravity/${model}`));

    expect(mocks.markAccountUnavailable.mock.calls.map((call) => call[5])).toEqual([
      undefined,
      resetAtMs,
      undefined,
      undefined,
    ]);
  });

  it("applies equally to aliases while isolating connection and model keys", async () => {
    const cases = [
      ["antigravity", "ag-one", "model-a"],
      ["agy", "agy-one", "model-a"],
      ["antigravity", "ag-one", "model-b"],
    ];
    mocks.getModelInfo.mockImplementation(async (modelStr) => {
      const [provider, model] = modelStr.split("/");
      return { provider, model };
    });
    mocks.getProviderCredentials.mockImplementation(async (provider, _excluded, model) => selected(
      cases.find(([candidateProvider, , candidateModel]) => candidateProvider === provider && candidateModel === model)?.[1],
      provider,
    ));
    mocks.refreshProviderQuota.mockResolvedValue({ outcome: "success", snapshots: [] });
    mocks.handleChatCore.mockImplementation(async (options) => antigravityFailure(options));
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });

    for (const [provider, , model] of cases) {
      await handleChat(request(`${provider}/${model}`));
      await handleChat(request(`${provider}/${model}`));
    }
    expect(mocks.markAccountUnavailable.mock.calls.every((call) => call[5] === undefined)).toBe(true);
    for (const [provider, , model] of cases) await handleChat(request(`${provider}/${model}`));

    const breakerCalls = mocks.markAccountUnavailable.mock.calls.filter((call) => Number.isFinite(call[5]));
    expect(breakerCalls.map((call) => [call[0], call[3], call[4]])).toEqual([
      ["ag-one", "antigravity", "model-a"],
      ["agy-one", "agy", "model-a"],
      ["ag-one", "antigravity", "model-b"],
    ]);
  });

  it("passes Kimi temporary resets through final fallback with its exact model scope", async () => {
    const connection = selected("kimi-connection", "kimi-coding");
    const resetAtMs = Date.now() + 60_000;
    mocks.getModelInfo.mockResolvedValue({ provider: "kimi-coding", model: "kimi-for-coding" });
    mocks.getProviderCredentials.mockResolvedValue(connection);
    mocks.handleChatCore.mockResolvedValue({
      success: false,
      status: 403,
      error: "[403]: Request limit reached for current billing cycle",
      resetsAtMs: resetAtMs,
      response: new Response("kimi billing-cycle limit", { status: 403 }),
    });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });

    const response = await handleChat(request("kimi-coding/kimi-for-coding"));

    expect(response.status).toBe(403);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith(
      "kimi-connection",
      403,
      "[403]: Request limit reached for current billing cycle",
      "kimi-coding",
      "kimi-for-coding",
      resetAtMs,
      expect.objectContaining({
        attemptStartedAt: null,
        rateLimitEvidence: null,
        headers: null,
        errorBody: null,
      }),
    );
  });

  it("keeps normal terminal fallback when Kimi body probe supplies no reset deadline", async () => {
    const connection = selected("kimi-connection", "kimi-coding");
    mocks.getModelInfo.mockResolvedValue({ provider: "kimi-coding", model: "kimi-for-coding" });
    mocks.getProviderCredentials.mockResolvedValue(connection);
    mocks.handleChatCore.mockResolvedValue({
      success: false,
      status: 403,
      error: "[403]: Request limit reached for current billing cycle",
      resetsAtMs: undefined,
      response: new Response("kimi probe timed out", { status: 403 }),
    });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });

    const response = await handleChat(request("kimi-coding/kimi-for-coding"));

    expect(response.status).toBe(403);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith(
      "kimi-connection",
      403,
      "[403]: Request limit reached for current billing cycle",
      "kimi-coding",
      "kimi-for-coding",
      undefined,
      expect.objectContaining({
        attemptStartedAt: null,
        rateLimitEvidence: null,
        headers: null,
        errorBody: null,
      }),
    );
  });

  it("replays an Envoy request-buffer 507 once on the same account", async () => {
    const first = selected("conn-one");
    const second = selected("conn-two");
    const preferredSelections = [];
    mocks.getProviderCredentials.mockImplementation(async (_provider, excluded, _model, options) => {
      preferredSelections.push(options?.preferredConnectionId || null);
      if (options?.preferredConnectionId === first.connectionId) return first;
      if (!excluded?.has(first.connectionId)) return first;
      return second;
    });
    mocks.handleChatCore
      .mockResolvedValueOnce({
        success: false,
        status: 507,
        error: "[507]: exceeded request buffer limit while retrying upstream",
        response: new Response("envoy-buffer-overflow", { status: 507 }),
      })
      .mockResolvedValueOnce({
        success: true,
        response: new Response("replayed", { status: 200 }),
      });

    const response = await handleChat(request());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("replayed");
    expect(preferredSelections).toEqual([null, "conn-one"]);
    expect(mocks.handleChatCore.mock.calls.map(([options]) => options.connectionId)).toEqual(["conn-one", "conn-one"]);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
    expect(checkFallbackError(507, "[507]: exceeded request buffer limit while retrying upstream"))
      .toMatchObject({ shouldFallback: false, cooldownMs: 0, scope: null });
  });

  it.each([401, 429])("still rotates accounts for HTTP %i", async (status) => {
    const first = selected("conn-one");
    const second = selected("conn-two");
    mocks.getProviderCredentials.mockImplementation(async (_provider, excluded) => {
      if (!excluded?.has(first.connectionId)) return first;
      return second;
    });
    mocks.handleChatCore
      .mockResolvedValueOnce({
        success: false,
        status,
        error: `HTTP ${status}`,
        response: new Response(`HTTP ${status}`, { status }),
      })
      .mockResolvedValueOnce({
        success: true,
        response: new Response("rotated", { status: 200 }),
      });

    const response = await handleChat(request());

    expect(response.status).toBe(200);
    expect(mocks.handleChatCore.mock.calls.map(([options]) => options.connectionId)).toEqual(["conn-one", "conn-two"]);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith(
      "conn-one",
      status,
      `HTTP ${status}`,
      "codex",
      "gpt-5.4",
      undefined,
      expect.any(Object),
    );
  });

  it("retries a sibling after a local quota reservation race without poisoning provider health", async () => {
    const first = selected("conn-one");
    const second = selected("conn-two");
    const selectionExcludes = [];
    mocks.getProviderCredentials.mockImplementation(async (_provider, excluded) => {
      selectionExcludes.push([...(excluded || [])]);
      if (!excluded?.has("conn-one")) return first;
      if (!excluded.has("conn-two")) return second;
      return null;
    });
    mocks.handleChatCore
      .mockResolvedValueOnce({
        success: false,
        status: 503,
        error: "Provider quota capacity unavailable",
        quotaCapacityUnavailable: true,
        response: new Response("local-capacity-race", { status: 503 }),
      })
      .mockImplementationOnce(async (options) => {
        const attemptStartedAt = options.onProviderAttempt();
        await options.onRequestSuccess({ attemptStartedAt });
        return {
          success: true,
          attemptStartedAt,
          response: new Response("data: {\"ok\":true}\n\ndata: [DONE]\n\n", {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        };
      });

    const response = await handleChat(request());
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("[DONE]");
    expect(text).not.toContain("local-capacity-race");
    expect(selectionExcludes).toEqual([[], ["conn-one"]]);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(2);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
    expect(mocks.clearAccountError).toHaveBeenCalledOnce();
    expect(mocks.clearAccountError).toHaveBeenCalledWith(
      "conn-two",
      expect.objectContaining({ connectionId: "conn-two" }),
      "gpt-5.4",
      expect.objectContaining({ provider: "codex", attemptStartedAt: expect.any(Number) }),
    );
  });

  it("returns before auth, quota, or database work when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await handleChat(request(undefined, controller.signal));
    expect(response.status).toBe(499);
    expect(mocks.getSettings).not.toHaveBeenCalled();
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.refreshProviderQuota).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("returns 499 when cancellation wins while credential selection is pending", async () => {
    const controller = new AbortController();
    mocks.getProviderCredentials.mockImplementation((_provider, _excluded, _model, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    const pending = handleChat(request(undefined, controller.signal));
    await vi.waitFor(() => expect(mocks.getProviderCredentials).toHaveBeenCalledOnce());
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("returns one final 429 without fabricating a deadline when any account reset is unknown", async () => {
    const accounts = [selected("conn-one"), selected("conn-two")];
    mocks.getProviderCredentials.mockImplementation(async (_provider, excluded) =>
      accounts.find((account) => !excluded?.has(account.connectionId)) || null,
    );
    mocks.handleChatCore.mockImplementation(async (options) => ({
      success: false,
      status: 429,
      error: "[429]: Rate limit exceeded",
      rateLimitEvidence: { state: "exhausted", resetAtMs: null, source: "local_policy" },
      response: new Response("rate limited", { status: 429 }),
      attemptStartedAt: options.onProviderAttempt(),
    }));
    mocks.markAccountUnavailable.mockResolvedValue({
      shouldFallback: true,
      cooldownMs: 2_000,
      status: 429,
      retryAt: null,
      retryAtKnown: false,
    });

    const response = await handleChat(request());
    const payload = await response.json();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(payload.error.retry_after).toBeUndefined();
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(2);
  });

  it("preserves the earliest complete retry deadline across attempted accounts", async () => {
    const accounts = [selected("conn-one"), selected("conn-two")];
    const first = new Date(Date.now() + 60_000).toISOString();
    const second = new Date(Date.now() + 30_000).toISOString();
    mocks.getProviderCredentials.mockImplementation(async (_provider, excluded) =>
      accounts.find((account) => !excluded?.has(account.connectionId)) || null,
    );
    mocks.handleChatCore.mockImplementation(async (options) => ({
      success: false,
      status: 429,
      error: "[429]: Rate limit exceeded",
      rateLimitEvidence: { state: "cooldown", resetAtMs: Date.now() + 60_000, source: "retry_after" },
      response: new Response("rate limited", { status: 429 }),
      attemptStartedAt: options.onProviderAttempt(),
    }));
    mocks.markAccountUnavailable
      .mockResolvedValueOnce({ shouldFallback: true, status: 429, retryAt: first, retryAtKnown: true })
      .mockResolvedValueOnce({ shouldFallback: true, status: 429, retryAt: second, retryAtKnown: true });

    const response = await handleChat(request());
    const payload = await response.json();
    expect(response.status).toBe(429);
    expect(payload.error.retry_after).toBe(second);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
