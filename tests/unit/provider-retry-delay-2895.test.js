import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settingsRow: null,
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  recordProviderRateLimitEvidence: vi.fn(),
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
  updateProviderConnection: mocks.updateProviderConnection,
  getProviderConnectionById: vi.fn(),
  getApiKeyByKey: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
}));

vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: mocks.recordProviderRateLimitEvidence,
  clearProviderRateLimitEvidence: vi.fn(),
}));

const { getSettings: readPersistedSettings, updateSettings } = await import("../../src/lib/db/repos/settingsRepo.js");
const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

const NOW = 1_800_000_000_000;
const MODEL = "test-model";

async function mark(provider, resetsAtMs = null) {
  mocks.getProviderConnections.mockResolvedValue([
    { id: "connection-1", provider, backoffLevel: 6 },
  ]);
  return markAccountUnavailable(
    "connection-1",
    429,
    "Rate limit exceeded",
    provider,
    MODEL,
    resetsAtMs,
    { attemptStartedAt: NOW },
  );
}

function persistedLockMs() {
  const update = mocks.updateProviderConnection.mock.calls.at(-1)[1];
  const lockValues = Object.entries(update)
    .filter(([key]) => key.startsWith("modelLock_"))
    .map(([, value]) => value);
  expect(lockValues).toHaveLength(1);
  return new Date(lockValues[0]).getTime() - NOW;
}

describe("port(upstream): #2895 - per-provider retry delay", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.clearAllMocks();
    mocks.settingsRow = null;
    mocks.getSettings.mockResolvedValue({ retryDelayByProvider: {} });
    mocks.updateProviderConnection.mockResolvedValue({});
    mocks.recordProviderRateLimitEvidence.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists and reads retryDelayByProvider settings", async () => {
    expect((await readPersistedSettings()).retryDelayByProvider).toEqual({});

    await updateSettings({ retryDelayByProvider: { codex: 120, nvidia: 30 } });

    expect((await readPersistedSettings()).retryDelayByProvider).toEqual({ codex: 120, nvidia: 30 });
  });

  it("uses configured seconds when no authoritative reset exists", async () => {
    mocks.getSettings.mockResolvedValue({ retryDelayByProvider: { codex: 120 } });

    const result = await mark("codex");

    expect(Number.isFinite(result.cooldownMs)).toBe(true);
    expect(result.cooldownMs).toBe(120_000);
    expect(persistedLockMs()).toBe(120_000);
  });

  it.each([
    ["Auto", {}],
    ["configured", { nvidia: 120 }],
  ])("lets an authoritative free-tier reset override %s retry delay", async (_label, retryDelayByProvider) => {
    mocks.getSettings.mockResolvedValue({ retryDelayByProvider });

    const result = await mark("nvidia", NOW + 5 * 60_000);

    expect(result.cooldownMs).toBe(5 * 60_000);
    expect(result.cooldownMs).toBeGreaterThan(60_000);
    expect(persistedLockMs()).toBe(5 * 60_000);
  });

  it("does not cap a configured free-tier retry delay", async () => {
    mocks.getSettings.mockResolvedValue({ retryDelayByProvider: { nvidia: 120 } });

    const result = await mark("nvidia");

    expect(result.cooldownMs).toBe(120_000);
    expect(persistedLockMs()).toBe(120_000);
  });

  it("caps free-tier static fallback at 60 seconds when no reset exists", async () => {
    const result = await mark("nvidia");

    expect(result.cooldownMs).toBe(60_000);
    expect(persistedLockMs()).toBe(60_000);
  });
});
