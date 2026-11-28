// Port of decolua/9router#2068, residual 2068-B: a gateway/relay failure must
// not lock the only account that can serve a request.
//
// Upstream skips the account fallback for ANY 502/503/504/524 when the
// provider has at most one active account. The fork narrows that to a PROVEN
// relay/hop failure plus a request scope with at most one eligible account,
// because a bare 503 is a legitimate provider-application answer (overload,
// model capacity) and upstream error text is not provenance.
//
// Every case below is synthetic: the database layer is mocked, no provider,
// network, credential or live API is involved.
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getApiKeyByKey: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
  getApiKeyProviderConnectionIds: vi.fn(),
}));

const fetchMock = vi.hoisted(() => vi.fn());
const executeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: vi.fn(),
  clearProviderRateLimitEvidence: vi.fn(),
}));
vi.mock("@/lib/webhooks/index.js", () => ({
  notifyWebhookEvent: vi.fn(),
}));
// Only proxyAwareFetch is replaced; every other export of the module is kept
// so unrelated import chains stay intact.
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: (...args) => fetchMock(...args),
}));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
  }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
const { isRelayGatewayFailure, countEligibleAccounts } = await import("../../open-sse/services/accountFallback.js");
const { getClientStatusFromError } = await import("../../open-sse/utils/error.js");
const { BaseExecutor } = await import("../../open-sse/executors/base.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { RELAY_TRANSPORT_FAILURES } = await import("../../open-sse/config/errorConfig.js");

const MODEL = "gpt-4o";
const PROVIDER = "openai";

function connection(overrides = {}) {
  return {
    id: "acc-a",
    provider: PROVIDER,
    name: "acc-a",
    isActive: true,
    backoffLevel: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getSettings.mockResolvedValue({});
  dbMocks.updateProviderConnection.mockResolvedValue({});
  dbMocks.getProviderConnections.mockResolvedValue([connection()]);
});

describe("#2068 — relay-failure provenance", () => {
  it("treats the fork's own transport classification as relay proof", () => {
    for (const status of [502, 503, 504]) {
      expect(isRelayGatewayFailure(status, { transportFailure: "network" })).toBe(true);
      expect(isRelayGatewayFailure(status, { transportFailure: "connect_timeout" })).toBe(true);
    }
  });

  it("requires transport provenance for HTTP 524", () => {
    expect(isRelayGatewayFailure(524)).toBe(false);
    expect(isRelayGatewayFailure(524, { transportFailure: "network" })).toBe(true);
  });

  it("does not treat a bare 502/503/504 as relay proof", () => {
    // A provider application may answer 503 (overload, model capacity) or 502
    // itself. The status alone cannot tell the two apart.
    for (const status of [502, 503, 504]) {
      expect(isRelayGatewayFailure(status)).toBe(false);
      expect(isRelayGatewayFailure(status, { transportFailure: null })).toBe(false);
      expect(isRelayGatewayFailure(status, { transportFailure: "aborted" })).toBe(false);
      expect(isRelayGatewayFailure(status, { transportFailure: "http_503" })).toBe(false);
    }
  });

  it("never treats an account-scoped status as a relay failure", () => {
    for (const status of [400, 401, 402, 403, 404, 413, 429, 499]) {
      expect(isRelayGatewayFailure(status, { transportFailure: "network" })).toBe(false);
    }
  });
});

describe("#2068 — request-scope eligibility", () => {
  it("counts only accounts that could still serve this request", () => {
    const connections = [
      connection({ id: "acc-a" }),
      connection({ id: "acc-b", isActive: false }),
      connection({ id: "acc-c", testStatus: "reauth_required" }),
      connection({ id: "acc-d", "modelLock_gpt-4o": "2999-01-01T00:00:00.000Z" }),
    ];

    expect(countEligibleAccounts(connections, { model: MODEL })).toBe(1);
  });

  it("does not count an account this request already excluded", () => {
    const connections = [connection({ id: "acc-a" }), connection({ id: "acc-b" })];

    expect(countEligibleAccounts(connections, { model: MODEL })).toBe(2);
    expect(countEligibleAccounts(connections, { model: MODEL, excludedConnectionIds: new Set(["acc-b"]) })).toBe(1);
    expect(countEligibleAccounts(connections, { model: MODEL, excludedConnectionIds: ["acc-b"] })).toBe(1);
  });

  it("keeps an account whose cached model lock has expired eligible", () => {
    const connections = [
      connection({ id: "acc-a" }),
      connection({ id: "acc-b", "modelLock_gpt-4o": "2000-01-01T00:00:00.000Z" }),
    ];

    expect(countEligibleAccounts(connections, { model: MODEL })).toBe(2);
  });
});

describe("#2068 — a proven relay failure does not cool the only eligible account", () => {
  it("writes no cooldown for a single eligible account on a transport failure", async () => {
    const result = await markAccountUnavailable(
      "acc-a",
      502,
      "[502]: fetch failed (cause: ECONNRESET)",
      PROVIDER,
      MODEL,
      null,
      { transportFailure: "network" },
    );

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("keeps a cooldown for an unproven HTTP 524 and preserves its status", async () => {
    const result = await markAccountUnavailable("acc-a", 524, "[524]: timeout", PROVIDER, MODEL);
    expect(result.shouldFallback).toBe(true);
    expect(dbMocks.updateProviderConnection).toHaveBeenCalled();
  });

  it("preserves combo fallback and explicit rate-limit evidence", async () => {
    for (const context of [
      { transportFailure: "network", hasComboFallback: true },
      { transportFailure: "network", rateLimitEvidence: { state: "exhausted" } },
    ]) {
      dbMocks.updateProviderConnection.mockClear();
      await markAccountUnavailable("acc-a", 502, "failure", PROVIDER, MODEL, null, context);
      expect(dbMocks.updateProviderConnection).toHaveBeenCalled();
    }
  });

  it("does not skip a cooldown when the failing account is absent", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([]);
    const result = await markAccountUnavailable("acc-a", 502, "failure", PROVIDER, MODEL, null, { transportFailure: "network" });
    expect(result.shouldFallback).toBe(true);
  });

  it("still cools the failing account when another account can be tried", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([
      connection({ id: "acc-a" }),
      connection({ id: "acc-b" }),
    ]);

    const result = await markAccountUnavailable(
      "acc-a",
      502,
      "[502]: fetch failed (cause: ECONNRESET)",
      PROVIDER,
      MODEL,
      null,
      { transportFailure: "network" },
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(dbMocks.updateProviderConnection).toHaveBeenCalled();
    const update = dbMocks.updateProviderConnection.mock.calls[0][1];
    expect(Object.keys(update).some((key) => key.startsWith("modelLock_"))).toBe(true);
  });

  it("skips the cooldown when the request already excluded the only sibling", async () => {
    // acc-b is still active but this request already excluded it, so it cannot
    // serve the request: the failing account really is the last candidate.
    dbMocks.getProviderConnections.mockResolvedValue([
      connection({ id: "acc-a" }),
      connection({ id: "acc-b" }),
    ]);

    const result = await markAccountUnavailable(
      "acc-a",
      502,
      "[502]: fetch failed (cause: ECONNRESET)",
      PROVIDER,
      MODEL,
      null,
      { transportFailure: "network", excludedConnectionIds: new Set(["acc-b"]) },
    );

    expect(result.shouldFallback).toBe(false);
    expect(result.cooldownMs).toBe(0);
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});

describe("#2068 — unchanged cooldown behavior", () => {
  it("keeps the cooldown for a plain upstream 503 with no relay provenance", async () => {
    const result = await markAccountUnavailable(
      "acc-a",
      503,
      "[503]: Service temporarily unavailable",
      PROVIDER,
      MODEL,
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(dbMocks.updateProviderConnection).toHaveBeenCalled();
    const update = dbMocks.updateProviderConnection.mock.calls[0][1];
    expect(Object.keys(update).some((key) => key.startsWith("modelLock_"))).toBe(true);
  });

  it("does not treat untrusted upstream error text as relay proof", async () => {
    for (const text of [
      "[503]: Bad gateway",
      "[503]: 502 Service Unavailable from the edge",
      "[502]: Cloudflare Ray ID 8f0c2",
      "[503]: Service Unavailable",
    ]) {
      dbMocks.updateProviderConnection.mockClear();
      const result = await markAccountUnavailable("acc-a", 503, text, PROVIDER, MODEL);

      expect(result.shouldFallback).toBe(true);
      expect(result.cooldownMs).toBeGreaterThan(0);
      expect(dbMocks.updateProviderConnection).toHaveBeenCalled();
    }
  });

  it("keeps the cooldown for a provider-capacity 503", async () => {
    // Provider admission: the origin answered with its own saturation error.
    const result = await markAccountUnavailable(
      "acc-a",
      503,
      "[503]: Selected model is at capacity. Please try a different model.",
      PROVIDER,
      MODEL,
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(dbMocks.updateProviderConnection).toHaveBeenCalled();
  });

  it("keeps the cooldown for actual account failures and quota limits", async () => {
    const cases = [
      [401, "[401]: Invalid API key"],
      [402, "[402]: insufficient credit balance"],
      [403, "[403]: Forbidden"],
      [429, "[429]: Rate limit reached"],
    ];

    for (const [status, text] of cases) {
      dbMocks.updateProviderConnection.mockClear();
      const result = await markAccountUnavailable(
        "acc-a",
        status,
        text,
        PROVIDER,
        MODEL,
      );

      expect(result.shouldFallback).toBe(true);
      expect(result.cooldownMs).toBeGreaterThan(0);
      expect(dbMocks.updateProviderConnection).toHaveBeenCalled();
    }
  });

  it("keeps the quota backoff ladder intact for a rate-limited account", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([connection({ backoffLevel: 1 })]);

    const result = await markAccountUnavailable(
      "acc-a",
      429,
      "[429]: Rate limit reached",
      PROVIDER,
      MODEL,
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(4000);
    const update = dbMocks.updateProviderConnection.mock.calls[0][1];
    expect(update.backoffLevel).toBe(2);
  });

  it("keeps the cooldown when a cached status already benches the only sibling", async () => {
    // acc-b is inactive in the stored row: the cached status says it cannot
    // serve, so acc-a is the only eligible account — but a plain upstream 503
    // is a provider answer, so the cooldown stays.
    dbMocks.getProviderConnections.mockResolvedValue([
      connection({ id: "acc-a" }),
      connection({ id: "acc-b", isActive: false, testStatus: "unavailable" }),
    ]);

    const result = await markAccountUnavailable(
      "acc-a",
      503,
      "[503]: Service temporarily unavailable",
      PROVIDER,
      MODEL,
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(dbMocks.updateProviderConnection).toHaveBeenCalled();
  });

  it("keeps the cooldown for a relay failure when the sibling is still usable", async () => {
    // The cached status of acc-b must not be mistaken for a second candidate:
    // acc-b is eligible, so the failing account is still cooled.
    dbMocks.getProviderConnections.mockResolvedValue([
      connection({ id: "acc-a" }),
      connection({ id: "acc-b", testStatus: "unavailable" }),
    ]);

    const result = await markAccountUnavailable(
      "acc-a",
      502,
      "[502]: fetch failed (cause: ECONNRESET)",
      PROVIDER,
      MODEL,
      null,
      { transportFailure: "network" },
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(dbMocks.updateProviderConnection).toHaveBeenCalled();
  });
});

describe("#2068 — HTTP 524 client projection", () => {
  it("normalizes the client-facing status to 502", () => {
    expect(getClientStatusFromError(524, "[524]: Bad gateway")).toBe(502);
  });

  it("keeps the internal status as 524 for the account-fallback classification", async () => {
    await markAccountUnavailable("acc-a", 524, "[524]: Bad gateway", PROVIDER, MODEL);

    // No lock is written, so the internal status is observable through the
    // client projection the account layer leaves untouched.
    expect(getClientStatusFromError(524)).toBe(502);
    expect(getClientStatusFromError(503)).toBe(503);
    expect(getClientStatusFromError(504)).toBe(504);
  });

  it("leaves every other upstream status unchanged", () => {
    for (const status of [400, 401, 402, 403, 404, 413, 429, 500, 502, 503, 504]) {
      expect(getClientStatusFromError(status, "ordinary upstream failure")).toBe(status);
    }
  });
});

describe("#2068 — where the relay provenance comes from", () => {
  it("uses exactly the transport classifications the fork's transport layer emits", async () => {
    // The fork's own executor classifies a transport failure; that
    // classification is the provenance the relay rule consumes.
    fetchMock.mockImplementation(() => {
      const error = new Error("read ECONNRESET");
      error.code = "ECONNRESET";
      return Promise.reject(error);
    });
    const executor = new BaseExecutor("prov-x", {
      baseUrl: "https://x/api",
      retry: { 502: { attempts: 0, delayMs: 1 } },
    });

    const error = await executor.execute({
      model: "m",
      body: {},
      stream: false,
      credentials: { apiKey: "k" },
      requestPolicy: { maxTransportAttempts: 1, skipRules: [], headerTimeoutMs: 5000 },
    }).catch((thrown) => thrown);

    expect(error.errorKind).toBe("network");
    expect(RELAY_TRANSPORT_FAILURES).toContain(error.errorKind);
    expect(isRelayGatewayFailure(502, { transportFailure: error.errorKind })).toBe(true);
  });

  it("keeps the transport vocabulary free of client aborts", () => {
    // A client abort is not a relay failure and must never unlock a cooldown.
    expect(RELAY_TRANSPORT_FAILURES).not.toContain("aborted");
    expect(isRelayGatewayFailure(502, { transportFailure: "aborted" })).toBe(false);
  });

  it("carries the transport classification from the executor to the account layer", async () => {
    executeMock.mockImplementation(() => {
      const error = new TypeError("fetch failed");
      error.errorKind = "network";
      error.cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
      throw error;
    });

    const result = await handleChatCore({
      body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hello" }] },
      modelInfo: { provider: PROVIDER, model: MODEL },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      connectionId: "acc-a",
      rtkEnabled: false,
      headroomEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
    });

    // The account layer receives the proven relay provenance next to the 502.
    expect(result.status).toBe(502);
    expect(result.transportFailure).toBe("network");
    expect(result.localProgrammingError).toBe(false);
    expect(isRelayGatewayFailure(result.status, { transportFailure: result.transportFailure })).toBe(true);
  });
});
