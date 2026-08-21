import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settingsRow: null,
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

const settingsAdapter = {
  get() {
    return mocks.settingsRow;
  },
  run(_sql, params) {
    mocks.settingsRow = { data: params[0] };
  },
  transaction(fn) {
    fn();
  },
};

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: vi.fn(async () => settingsAdapter),
  getAdapterSync: vi.fn(() => settingsAdapter),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getProviderConnectionById: vi.fn(),
  getApiKeyByKey: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
  getProxyPools: vi.fn(async () => []),
  getQuotaReservationPressure: vi.fn(async () => new Map()),
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

const {
  _pruneIdleConnections,
  _resetRpmLimiter,
  _rpmLimiterState,
  isOverLimit,
  recordRequest,
  retryAfterMs,
  usage,
} = await import("../../src/sse/services/rpmLimiter.js");
const { resolveProviderRpm } = await import("../../src/shared/constants/providers.js");
const { getSettings: readPersistedSettings, updateSettings: persistSettings } = await import("../../src/lib/db/repos/settingsRepo.js");
const { getProviderCredentials, markAccountUnavailable } = await import("../../src/sse/services/auth.js");
const { GET: getSettingsRoute, PATCH: patchSettingsRoute } = await import("../../src/app/api/settings/route.js");

const NOW = Date.parse("2026-08-21T12:00:00.000Z");

function connection(id, provider = "nvidia", priority = 1) {
  return {
    id,
    provider,
    priority,
    authType: "apikey",
    apiKey: `key-${id}`,
    isActive: true,
    providerSpecificData: {},
  };
}

async function select(provider, now = NOW) {
  return getProviderCredentials(provider, null, "test-model", {
    now,
    quotaSnapshotsLoader: async () => [],
  });
}

describe("port(upstream): #3203 - per-account RPM admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsRow = null;
    mocks.getSettings.mockImplementation(readPersistedSettings);
    mocks.updateSettings.mockImplementation(persistSettings);
    mocks.updateProviderConnection.mockImplementation(async (_id, patch) => patch);
    _resetRpmLimiter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("admits NVIDIA request 40 and returns existing allRateLimited shape for request 41", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("nvidia-one")]);

    for (let request = 1; request <= 40; request += 1) {
      const selected = await select("nvidia");
      expect(selected.connectionId, `request ${request}`).toBe("nvidia-one");
    }

    const capped = await select("nvidia");
    expect(capped).toEqual({
      allRateLimited: true,
      retryAfter: new Date(NOW + 60_000).toISOString(),
      retryAfterHuman: "reset after 1m",
      lastError: "Rate limited",
      lastErrorCode: 429,
    });
  });

  it("leaves non-NVIDIA providers unlimited when settings are blank", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("codex-one", "codex")]);

    for (let request = 0; request < 100; request += 1) {
      expect((await select("codex")).connectionId).toBe("codex-one");
    }

    expect(usage("codex-one", NOW)).toBe(0);
  });

  it("applies an override and records only the chosen connection", async () => {
    mocks.getSettings.mockResolvedValue({ rpmByProvider: { nvidia: 1 } });
    mocks.getProviderConnections.mockResolvedValue([
      connection("first", "nvidia", 1),
      connection("second", "nvidia", 2),
    ]);

    expect((await select("nvidia")).connectionId).toBe("first");
    expect((await select("nvidia")).connectionId).toBe("second");
    expect(usage("first", NOW)).toBe(1);
    expect(usage("second", NOW)).toBe(1);

    const capped = await select("nvidia");
    expect(capped).toMatchObject({
      allRateLimited: true,
      retryAfter: new Date(NOW + 60_000).toISOString(),
      lastErrorCode: 429,
    });
    expect(usage("first", NOW)).toBe(1);
    expect(usage("second", NOW)).toBe(1);
  });

  it("round-trips rpmByProvider through repository and settings API", async () => {
    expect((await readPersistedSettings()).rpmByProvider).toEqual({});
    expect(resolveProviderRpm({ rpmByProvider: {} }, "nvidia")).toBe(40);
    expect(resolveProviderRpm({ rpmByProvider: {} }, "codex")).toBe(0);

    await persistSettings({ rpmByProvider: { nvidia: 7, codex: 2 } });
    expect((await readPersistedSettings()).rpmByProvider).toEqual({ nvidia: 7, codex: 2 });
    expect(resolveProviderRpm(await readPersistedSettings(), "nvidia")).toBe(7);
    expect(resolveProviderRpm({ rpmByProvider: { nvidia: 0 } }, "nvidia")).toBe(0);

    const patchResponse = await patchSettingsRoute(new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rpmByProvider: { nvidia: 9 } }),
    }));
    expect(patchResponse.status).toBe(200);
    expect((await patchResponse.json()).rpmByProvider).toEqual({ nvidia: 9 });
    expect((await (await getSettingsRoute()).json()).rpmByProvider).toEqual({ nvidia: 9 });

    for (const rpmByProvider of [
      { nvidia: -1 },
      { nvidia: "9" },
      { nvidia: 10_001 },
      null,
      "nvidia",
      9,
      [],
    ]) {
      const invalidResponse = await patchSettingsRoute(new Request("http://localhost/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rpmByProvider }),
      }));
      expect(invalidResponse.status).toBe(400);
      expect(await invalidResponse.json()).toEqual({ error: "Invalid rpmByProvider" });
    }
  });

  it("preserves #2895 authoritative-reset precedence and static free-tier cap", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    mocks.getProviderConnections.mockResolvedValue([
      { ...connection("nvidia-one"), backoffLevel: 6 },
    ]);
    mocks.getSettings.mockResolvedValue({
      rpmByProvider: {},
      retryDelayByProvider: { nvidia: 15 },
    });

    const authoritative = await markAccountUnavailable(
      "nvidia-one", 429, "Rate limit exceeded", "nvidia", "test-model", NOW + 5 * 60_000,
      { attemptStartedAt: NOW },
    );
    expect(authoritative.cooldownMs).toBe(5 * 60_000);

    mocks.getSettings.mockResolvedValue({ rpmByProvider: {}, retryDelayByProvider: {} });
    const staticFallback = await markAccountUnavailable(
      "nvidia-one", 429, "Rate limit exceeded", "nvidia", "test-model", null,
      { attemptStartedAt: NOW },
    );
    expect(staticFallback.cooldownMs).toBe(60_000);
  });

  it("bounds each counter and prunes untouched idle keys", () => {
    for (let request = 0; request < 10_000; request += 1) {
      recordRequest("busy", 3, NOW);
    }
    expect(isOverLimit("busy", 3, NOW)).toBe(true);
    expect(retryAfterMs("busy", 3, NOW)).toBe(NOW + 60_000);
    expect(_rpmLimiterState()).toEqual({ connections: 1, timestamps: 3 });

    recordRequest("idle", 3, NOW);
    expect(_pruneIdleConnections(NOW + 60_001)).toBe(2);
    expect(_rpmLimiterState()).toEqual({ connections: 0, timestamps: 0 });
  });
});
