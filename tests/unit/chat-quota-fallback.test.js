import { beforeEach, describe, expect, it, vi } from "vitest";
import { quotaIdentityKey } from "../../src/shared/utils/quotaSnapshot.js";

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

vi.mock("../../src/sse/services/model.js", () => ({
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentials,
  projectProviderCredentials: mocks.projectProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: vi.fn(() => null),
  evaluateApiKeyAuth: mocks.evaluateApiKeyAuth,
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

const { handleChat, rankComboModelsByQuota } = await import("../../src/sse/handlers/chat.js");

function request(signal = null) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "codex/gpt-5.4",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    }),
    ...(signal ? { signal } : {}),
  });
}

function selected(id) {
  const connection = {
    id,
    provider: "codex",
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
    const response = await handleChat(request(controller.signal));
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
    const pending = handleChat(request(controller.signal));
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
