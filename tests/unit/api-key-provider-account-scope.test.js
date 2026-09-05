import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  providerConnections: [],
  getApiKeyProviderConnectionIds: vi.fn(),
}));

const adapter = {
  _apiKeyProviderConnections: new Map(),
  _providerConnections: [],
  get(sql, params) {
    if (/FROM apiKeyProviderConnections/.test(sql)) {
      const list = this._apiKeyProviderConnections.get(params[0]) || [];
      return { id: list[0] ? 1 : null };
    }
    return null;
  },
  all(sql, params) {
    if (/FROM apiKeyProviderConnections/.test(sql)) {
      const list = this._apiKeyProviderConnections.get(params[0]) || [];
      return list.map((connectionId) => ({ connectionId }));
    }
    if (/FROM providerConnections/.test(sql)) {
      return this._providerConnections.map((row) => ({ id: row.id }));
    }
    return [];
  },
  run() {},
  transaction(fn) { fn(); },
};

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: vi.fn(async () => adapter),
  getAdapterSync: vi.fn(() => adapter),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => mocks.providerConnections),
  getProviderConnectionById: vi.fn(),
  getApiKeyByKey: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(async (_id, patch) => patch),
  getSettings: vi.fn(async () => ({})),
  getProxyPools: vi.fn(async () => []),
  getQuotaReservationPressure: vi.fn(async () => new Map()),
  getApiKeyProviderConnectionIds: mocks.getApiKeyProviderConnectionIds,
}));

vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: vi.fn(),
  clearProviderRateLimitEvidence: vi.fn(),
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  DEFAULT_PASSWORD: "default-password",
  invalidateDefaultPasswordCache: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
  validateDashboardPassword: vi.fn(),
  verifyDashboardPassword: vi.fn(),
}));

vi.mock("@/lib/auth/passwordChangeProof", () => ({ resetPasswordChangeProofs: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const { getProviderCredentials, getProviderCredentialsWithQuotaPreflight } = await import(
  "../../src/sse/services/auth.js"
);

function fakeConnection(id, provider = "openai") {
  return {
    id,
    provider,
    priority: 1,
    authType: "apikey",
    apiKey: `key-${id}`,
    isActive: true,
    providerSpecificData: {},
  };
}

const NOW = Date.parse("2026-08-21T12:00:00.000Z");

async function select({ provider = "openai", model = "gpt-4o", exclude = new Set(), options = {} } = {}) {
  return getProviderCredentials(provider, exclude, model, {
    now: NOW,
    quotaSnapshotsLoader: async () => [],
    ...options,
  });
}

describe("port(upstream): #3661 - API key to provider account scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.providerConnections = [];
    adapter._apiKeyProviderConnections = new Map();
    adapter._providerConnections = [];
    mocks.getApiKeyProviderConnectionIds.mockImplementation(async (apiKeyId) => {
      const list = adapter._apiKeyProviderConnections.get(apiKeyId) || [];
      return [...list];
    });
  });

  afterEach(() => {
    adapter._apiKeyProviderConnections = new Map();
  });

  it("keeps an unrestricted legacy sk-<8 hex> key able to reach every account", async () => {
    mocks.providerConnections = [fakeConnection("conn-a"), fakeConnection("conn-b")];
    const credentials = await select();
    expect(credentials.connectionId).toBe("conn-a");
    expect(mocks.getApiKeyProviderConnectionIds).not.toHaveBeenCalled();
  });

  it("exposes only scoped accounts when relation rows are present", async () => {
    mocks.providerConnections = [fakeConnection("conn-a"), fakeConnection("conn-b"), fakeConnection("conn-c")];
    adapter._apiKeyProviderConnections.set("key-scoped", ["conn-b"]);

    const first = await select({ options: { apiKeyId: "key-scoped" } });
    expect(first.connectionId).toBe("conn-b");

    const exclude = new Set(["conn-b"]);
    const second = await select({ exclude, options: { apiKeyId: "key-scoped" } });
    expect(second).toBeNull();
  });

  it("treats zero relation rows as unrestricted", async () => {
    mocks.providerConnections = [fakeConnection("conn-a")];
    adapter._apiKeyProviderConnections.set("key-empty", []);
    const result = await select({ options: { apiKeyId: "key-empty" } });
    expect(result.connectionId).toBe("conn-a");
  });

  it("intersects relation rows with options.allowedConnectionIds", async () => {
    mocks.providerConnections = [fakeConnection("conn-a"), fakeConnection("conn-b"), fakeConnection("conn-c")];
    adapter._apiKeyProviderConnections.set("key-rel", ["conn-a", "conn-b"]);

    const overlap = await select({
      options: { apiKeyId: "key-rel", allowedConnectionIds: ["conn-b", "conn-c"] },
    });
    expect(overlap.connectionId).toBe("conn-b");

    const noOverlap = await select({
      options: { apiKeyId: "key-rel", allowedConnectionIds: ["conn-c"] },
    });
    expect(noOverlap).toBeNull();
  });

  it("quota preflight reselect respects the same scoped subset and never escapes", async () => {
    mocks.providerConnections = [fakeConnection("conn-a", "codex"), fakeConnection("conn-b", "codex"), fakeConnection("conn-c", "codex")];
    adapter._apiKeyProviderConnections.set("key-scoped", ["conn-a", "conn-b"]);

    // First loader returns a stale persisted Codex quota row for conn-a so
    // the preflight refresh path runs once. The refresh resolves with a real
    // runtime decision that denies conn-a. The second loader (the reselect
    // call inside preflight) returns a fresh persisted Codex row for conn-b
    // — the native contract keys the available decision off requests:session
    // and leaves amounts unknown — so conn-b is `shouldRefresh=false` and
    // selected. The test must prove conn-a is denied without selecting any
    // unscoped account (conn-c).
    const exhausted = {
      identity: { connectionId: "conn-a", provider: "codex", accountKey: "scope:connection", resourceKey: "model:codex-spark", dimensionKey: "requests:session" },
      state: "exhausted",
      amounts: { limitKind: "unknown", limit: null, used: null, remaining: null, remainingRatio: 0, unit: null },
      timing: { observedAt: new Date(NOW - 1_000).toISOString(), staleAt: new Date(NOW + 60_000).toISOString(), resetAt: new Date(NOW + 30_000).toISOString(), cooldownUntil: null },
      provenance: { sourceType: "provider_api", sourceId: "codex:wham-usage:v1", reasonCode: null, metadata: {} },
    };
    const freshConnB = {
      ...exhausted,
      identity: { ...exhausted.identity, connectionId: "conn-b" },
      state: "available",
      timing: { observedAt: new Date(NOW - 1_000).toISOString(), staleAt: new Date(NOW + 60_000).toISOString(), resetAt: null, cooldownUntil: null },
      provenance: { ...exhausted.provenance, reasonCode: null },
      amounts: { ...exhausted.amounts, remainingRatio: 0.5 },
    };
    const stale = { ...exhausted, timing: { ...exhausted.timing, observedAt: new Date(NOW - 120_000).toISOString(), staleAt: new Date(NOW - 60_000).toISOString() } };
    const quotaSnapshotsLoader = vi
      .fn()
      .mockResolvedValueOnce([stale])
      .mockResolvedValue([freshConnB]);
    const quotaRefresher = vi.fn().mockResolvedValue({ outcome: "success", snapshots: [exhausted] });

    const result = await getProviderCredentialsWithQuotaPreflight("codex", new Set(), "gpt-5.3-codex-spark", {
      now: NOW,
      resourceKeys: ["model:codex-spark"],
      quotaSnapshotsLoader,
      quotaRefresher,
      apiKeyId: "key-scoped",
    });
    expect(result.connectionId).toBe("conn-b");
    expect(result.connectionId).not.toBe("conn-c");
    expect(quotaRefresher).toHaveBeenCalledTimes(1);
    const [refreshedConnection, refreshOptions] = quotaRefresher.mock.calls[0];
    expect(refreshedConnection?.id).toBe("conn-a");
    expect(refreshOptions).toBeDefined();
  });

  it("no eligible scoped account denies without synthesizing a noauth credential", async () => {
    mocks.providerConnections = [];
    adapter._apiKeyProviderConnections.set("key-scoped-empty", ["conn-x"]);
    const result = await select({ provider: "openai", options: { apiKeyId: "key-scoped-empty" } });
    expect(result).toBeNull();
  });
});
