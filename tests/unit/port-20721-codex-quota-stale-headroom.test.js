// Opt-in: a recent stale Codex reading with headroom must not make the request
// wait for the quota refresh. Every refresh here is a local stub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connections: [], settings: {} }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => mocks.connections),
  getProviderConnectionById: vi.fn(async (id) => mocks.connections.find((row) => row.id === id)),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(async () => mocks.settings),
  getProxyPools: vi.fn(async () => []),
  getQuotaFetchState: vi.fn(async () => null),
  getQuotaReservationPressure: vi.fn(async () => new Map()),
  validateApiKey: vi.fn(),
}));

const { getProviderCredentialsWithQuotaPreflight } = await import("../../src/sse/services/auth.js");

const NOW = Date.parse("2026-07-10T12:00:00.000Z");
const HEADROOM = "DURINDOOR_CODEX_QUOTA_STALE_HEADROOM_PERCENT";

const reading = ({ ratio = 0.8, ageMs = 70_000, resetAt = NOW + 3_600_000 } = {}) => ({
  identity: { connectionId: "one", provider: "codex", accountKey: "scope:connection", resourceKey: "scope:account", dimensionKey: "requests:session" },
  state: "available",
  amounts: { limitKind: "unknown", limit: null, used: null, remaining: null, remainingRatio: ratio, unit: null },
  timing: {
    observedAt: new Date(NOW - ageMs).toISOString(),
    staleAt: new Date(NOW - ageMs + 60_000).toISOString(),
    resetAt: new Date(resetAt).toISOString(),
    cooldownUntil: null,
  },
  provenance: { sourceType: "provider_api", sourceId: "codex:wham-usage:v1", reasonCode: null, metadata: {} },
});

// A refresh that stays pending until the test ends it.
function delayedRefresher() {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  return { refresher: vi.fn(() => pending), finish: () => finish(null) };
}

const select = (row, quotaRefresher) => getProviderCredentialsWithQuotaPreflight("codex", null, "gpt-5.4", {
  now: NOW,
  quotaSnapshotsLoader: async () => [row],
  quotaFetchStateLoader: async () => null,
  quotaRefresher,
});

// "sent" when selection resolves while the refresh is still pending.
async function outcomeWhileRefreshPends(row) {
  const { refresher, finish } = delayedRefresher();
  const selection = select(row, refresher);
  await vi.waitFor(() => expect(refresher).toHaveBeenCalled());
  const outcome = await Promise.race([
    selection.then(() => "sent"),
    new Promise((resolve) => setTimeout(() => resolve("waiting"), 50)),
  ]);
  finish();
  await selection;
  return outcome;
}

describe("Codex quota preflight stale headroom (OmniRoute #20721)", () => {
  beforeEach(() => {
    mocks.settings = {};
    mocks.connections = [{ id: "one", provider: "codex", authType: "oauth", accessToken: "synthetic", priority: 1, isActive: true }];
    vi.stubEnv(HEADROOM, "20");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends simultaneous requests while one safe reading refreshes", async () => {
    const { refresher, finish } = delayedRefresher();
    const selected = await Promise.all([select(reading(), refresher), select(reading(), refresher)]);
    expect(selected.map((credentials) => credentials.connectionId)).toEqual(["one", "one"]);
    expect(refresher).toHaveBeenCalled();
    // The shared refresh must not carry one request's abort signal.
    expect(refresher.mock.calls[0][1]?.signal).toBeUndefined();
    finish();
  });

  it("waits by default", async () => {
    vi.stubEnv(HEADROOM, "");
    expect(await outcomeWhileRefreshPends(reading())).toBe("waiting");
  });

  it.each([
    ["is near the cutoff", reading({ ratio: 0.1 })],
    ["is too old", reading({ ageMs: 130_000 })],
    ["has a window that already reset", reading({ resetAt: NOW - 1_000 })],
  ])("waits when the reading %s", async (_label, row) => {
    expect(await outcomeWhileRefreshPends(row)).toBe("waiting");
  });

  it("measures headroom from the routing floor when it is enabled", async () => {
    mocks.settings = { quotaSelection: { routingFloorEnabled: true, routingFloorRatio: 0.7 } };
    expect(await outcomeWhileRefreshPends(reading({ ratio: 0.8 }))).toBe("waiting");
  });
});
