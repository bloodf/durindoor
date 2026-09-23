import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// port(omniroute): peak-hour protection + per-connection RPD gate the
// connection-selection path in getProviderCredentials (OmniRoute c11f661a8
// #11622, c49ee53bc #12147). Mock harness mirrors
// tests/unit/account-rpm-limit-3203.test.js.

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

const { _resetRpmLimiter } = await import("../../src/sse/services/rpmLimiter.js");
const { _resetRpdLimiter } = await import("../../src/sse/services/rpdLimiter.js");
const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

// Wednesday inside a 01:00-04:00 UTC block window.
const IN_WINDOW = Date.parse("2026-08-26T02:00:00.000Z");
// Same Wednesday, outside the window.
const OUT_OF_WINDOW = Date.parse("2026-08-26T12:00:00.000Z");

function connection(id, providerSpecificData = {}, provider = "codex", priority = 1) {
  return {
    id,
    provider,
    priority,
    authType: "apikey",
    apiKey: `key-${id}`,
    isActive: true,
    providerSpecificData,
  };
}

async function select(provider, now) {
  return getProviderCredentials(provider, null, "test-model", { now, quotaSnapshotsLoader: async () => [] });
}

describe("port(omniroute): peak-hour protection + RPD connection selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsRow = null;
    mocks.getSettings.mockResolvedValue({});
    mocks.updateProviderConnection.mockImplementation(async (_id, patch) => patch);
    _resetRpmLimiter();
    _resetRpdLimiter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks the only connection during an active block-mode peak-hour window", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      connection("blocked-one", {
        peakHourProtection: {
          enabled: true,
          mode: "block",
          windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], startUtc: "01:00", endUtc: "04:00" }],
        },
      }),
    ]);

    const result = await select("codex", IN_WINDOW);
    expect(result).toMatchObject({ allRateLimited: true, lastErrorCode: 429 });
    expect(result.retryAfter).toBe(new Date(Date.parse("2026-08-26T04:00:00.000Z")).toISOString());
  });

  it("admits the same connection once the window ends", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      connection("later-one", {
        peakHourProtection: {
          enabled: true,
          mode: "block",
          windows: [{ startUtc: "01:00", endUtc: "04:00" }],
        },
      }),
    ]);

    const result = await select("codex", OUT_OF_WINDOW);
    expect(result.connectionId).toBe("later-one");
  });

  it("deprioritizes (not excludes) an avoid-mode connection when an alternative exists", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      connection(
        "avoid-one",
        { peakHourProtection: { enabled: true, mode: "avoid", windows: [{ startUtc: "01:00", endUtc: "04:00" }] } },
        "codex",
        1,
      ),
      connection("plain-two", {}, "codex", 2),
    ]);

    const result = await select("codex", IN_WINDOW);
    expect(result.connectionId).toBe("plain-two");
  });

  it("enforces a per-connection RPD cap independently of RPM", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      connection("rpd-one", { rateLimitOverrides: { rpd: 2 } }),
    ]);

    expect((await select("codex", OUT_OF_WINDOW)).connectionId).toBe("rpd-one");
    expect((await select("codex", OUT_OF_WINDOW + 1000)).connectionId).toBe("rpd-one");

    const capped = await select("codex", OUT_OF_WINDOW + 2000);
    expect(capped).toMatchObject({ allRateLimited: true, lastErrorCode: 429 });
  });

  it("leaves connections with no override unaffected", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("plain-one", {})]);
    for (let i = 0; i < 5; i += 1) {
      expect((await select("codex", OUT_OF_WINDOW + i)).connectionId).toBe("plain-one");
    }
  });
});
