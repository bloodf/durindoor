import { beforeEach, describe, expect, it, vi } from "vitest";
import { quotaIdentityKey } from "../../src/shared/utils/quotaSnapshot.js";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  getQuotaFetchState: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
  validateApiKey: mocks.validateApiKey,
  getQuotaFetchState: mocks.getQuotaFetchState,
  getQuotaReservationPressure: mocks.getQuotaReservationPressure,
}));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

function connection(id, priority, provider = "codex") {
  return {
    id,
    provider,
    authType: "oauth",
    accessToken: `token-${id}`,
    refreshToken: `refresh-${id}`,
    priority,
    isActive: true,
    updatedAt: new Date(NOW - 60_000).toISOString(),
  };
}

function snapshot(connectionId, {
  state,
  resourceKey = "model:gpt-5.4",
  resetAt = null,
  cooldownUntil = null,
  staleAt = NOW + 60_000,
} = {}) {
  return {
    identity: { connectionId, provider: "codex", accountKey: "scope:connection", resourceKey, dimensionKey: "requests:runtime" },
    state,
    amounts: { limitKind: "unknown", limit: null, used: null, remaining: null, remainingRatio: null, unit: null },
    timing: {
      observedAt: new Date(NOW - 1000).toISOString(),
      staleAt: new Date(staleAt).toISOString(),
      resetAt: resetAt ? new Date(resetAt).toISOString() : null,
      cooldownUntil: cooldownUntil ? new Date(cooldownUntil).toISOString() : null,
    },
    provenance: { sourceType: "response_headers", sourceId: "codex:runtime-test:v1", reasonCode: "rate_limited", metadata: {} },
  };
}


const deadline = (seconds) => new Date(NOW + seconds * 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({});
  mocks.getProxyPools.mockResolvedValue([]);
  mocks.getQuotaReservationPressure.mockResolvedValue(new Map());
});

async function select(tried, extraSnapshots = [], options = {}) {
  mocks.getProviderConnections.mockResolvedValue([connection("quota", 1), { ...connection("tried", 2), ...tried }]);
  const excluded = new Set(["tried"]);
  const result = await getProviderCredentials("codex", excluded, "gpt-5.4", {
    now: NOW, resourceKeys: ["model:gpt-5.4"],
    quotaSnapshotsLoader: async () => [snapshot("quota", { state: "exhausted", resetAt: NOW + 600_000 }), ...extraSnapshots],
    quotaFetchStateLoader: async () => [], ...options
  });
  expect([...excluded]).toEqual(["tried"]);
  return result;
}

it("reports the excluded account's shorter model lock without selecting it", async () => {
  expect(await select({ "modelLock_gpt-5.4": deadline(5), errorCode: 429 })).toMatchObject({ allRateLimited: true, retryAfter: deadline(5), lastErrorCode: 429 });
});

it.each([
  ["no lock", {}],
  ["expired lock", { "modelLock_gpt-5.4": deadline(-1) }],
  ["other model", { modelLock_other: deadline(5) }],
  ["longer lock", { "modelLock_gpt-5.4": deadline(700) }],
  ["authentication failure", { "modelLock_gpt-5.4": deadline(5), errorCode: 401 }],
  ["account lock", { "modelLock_gpt-5.4": deadline(5), modelLock___all: deadline(100) }],
  ["account cooldown", { "modelLock_gpt-5.4": deadline(5), rateLimitedUntil: deadline(100) }],
])("retains the quota reset for %s", async (_name, tried) => {
  expect((await select(tried)).retryAfter).toBe(deadline(600));
});

it("does not use an excluded account whose own quota is exhausted", async () => {
  const result = await select({ "modelLock_gpt-5.4": deadline(5) }, [snapshot("tried", { state: "exhausted", resetAt: NOW + 300_000 })]);
  expect(result.retryAfter).toBe(deadline(600));
});

it("continues to select an eligible remaining account", async () => {
  mocks.getProviderConnections.mockResolvedValue([{ ...connection("tried", 1), "modelLock_gpt-5.4": deadline(5) }, connection("available", 2)]);
  const excluded = new Set(["tried"]);
  const result = await getProviderCredentials("codex", excluded, "gpt-5.4", { now: NOW, quotaSnapshotsLoader: async () => [], quotaFetchStateLoader: async () => [] });
  expect(result.connectionId).toBe("available");
  expect([...excluded]).toEqual(["tried"]);
});
