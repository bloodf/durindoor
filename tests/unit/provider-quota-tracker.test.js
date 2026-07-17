import { describe, expect, it, vi } from "vitest";
import { createProviderQuotaTracker } from "../../src/shared/services/providerQuotaTracker.js";

const START = Date.parse("2026-01-01T00:00:00.000Z");

function connection(id = "conn-1", overrides = {}) {
  return {
    id,
    provider: "demo",
    authType: "api_key",
    apiKey: "test-provider-key",
    updatedAt: "2026-01-01T00:00:00.000Z",
    providerSpecificData: {},
    ...overrides,
  };
}

function quotaRow(overrides = {}) {
  return {
    accountKey: null,
    resourceKey: null,
    dimensionKey: "requests:session",
    state: "available",
    amounts: {
      limitKind: "bounded",
      limit: 100,
      used: 25,
      remaining: 75,
      remainingRatio: 0.75,
      unit: "requests",
    },
    resetAt: null,
    cooldownUntil: null,
    metadata: { plan: "test-plan" },
    ...overrides,
  };
}

function success(rows = [quotaRow()], attemptedAt = "2026-01-01T00:00:00.000Z") {
  return { outcome: "success", sourceId: "demo:quota:v1", rows, attemptedAt };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness({
  fetchQuota,
  clock = { value: START },
  cacheTtlMs = 1_000,
  maxCacheEntries = 512,
  repository: repositoryOverride,
  proxyResolver = vi.fn().mockResolvedValue({}),
  credentialRefresher = vi.fn(),
  isConnectionEligible = null,
} = {}) {
  const repository = repositoryOverride || {
    replaceProviderQuotaSnapshotsForSource: vi.fn().mockResolvedValue([]),
    recordQuotaFetchFailure: vi.fn().mockResolvedValue(null),
  };
  const adapter = {
    config: { sourceId: "demo:quota:v1", freshnessMs: 60_000 },
    fetchQuota: fetchQuota || vi.fn().mockResolvedValue(success()),
    ...(isConnectionEligible ? { isConnectionEligible } : {}),
  };
  const resolveAdapter = vi.fn((provider) => provider === "demo" ? adapter : null);
  const tracker = createProviderQuotaTracker({
    resolveAdapter,
    repository,
    proxyResolver,
    credentialRefresher,
    now: () => clock.value,
    cacheTtlMs,
    maxCacheEntries,
  });
  return { tracker, adapter, repository, resolveAdapter, clock, proxyResolver, credentialRefresher };
}

describe("provider quota tracker", () => {
  it("persists one strict source replacement and caches only the successful result", async () => {
    const h = harness();

    const first = await h.tracker.refresh(connection());
    expect(first).toMatchObject({ outcome: "success", cached: false, persisted: true });
    expect(first.snapshots).toHaveLength(1);
    expect(first.snapshots[0]).toMatchObject({
      identity: {
        connectionId: "conn-1",
        provider: "demo",
        accountKey: "scope:connection",
        resourceKey: "scope:account",
        dimensionKey: "requests:session",
      },
      provenance: { sourceType: "provider_api", sourceId: "demo:quota:v1" },
    });
    expect(h.repository.replaceProviderQuotaSnapshotsForSource).toHaveBeenCalledTimes(1);
    expect(h.repository.recordQuotaFetchFailure).not.toHaveBeenCalled();

    const cached = await h.tracker.refresh(connection());
    expect(cached).toMatchObject({ outcome: "success", cached: true });
    expect(h.adapter.fetchQuota).toHaveBeenCalledTimes(1);

    h.clock.value += 1_000;
    await h.tracker.refresh(connection());
    expect(h.adapter.fetchQuota).toHaveBeenCalledTimes(2);
    expect(h.repository.replaceProviderQuotaSnapshotsForSource).toHaveBeenCalledTimes(2);
  });

  it("expires cache before and exactly at a provider cooldown boundary", async () => {
    const cooldownUntil = new Date(START + 30_000).toISOString();
    const fetchQuota = vi.fn().mockResolvedValue(success([quotaRow({ state: "cooldown", cooldownUntil })]));
    const h = harness({ fetchQuota, cacheTtlMs: 60_000 });

    const first = await h.tracker.refresh(connection());
    expect(first.snapshots[0]).toMatchObject({ state: "cooldown", timing: { staleAt: cooldownUntil, cooldownUntil } });
    h.clock.value = START + 29_999;
    await expect(h.tracker.refresh(connection())).resolves.toMatchObject({ cached: true });
    h.clock.value = START + 30_000;
    await expect(h.tracker.refresh(connection())).resolves.toMatchObject({ cached: false });
    expect(fetchQuota).toHaveBeenCalledTimes(2);
  });

  it("treats an empty successful source as an authoritative replacement", async () => {
    const h = harness({ fetchQuota: vi.fn().mockResolvedValue(success([])) });

    const result = await h.tracker.refresh(connection());

    expect(result).toMatchObject({ outcome: "success", snapshots: [] });
    expect(h.repository.replaceProviderQuotaSnapshotsForSource).toHaveBeenCalledWith(
      expect.objectContaining({ snapshots: [] }),
      expect.any(Object),
    );
  });

  it.each(["missing", "malformed", "unauthenticated", "forbidden", "rate_limited", "timeout", "network_error", "provider_error"])(
    "records %s without replacing a previously valid source",
    async (outcome) => {
      const fetchQuota = vi.fn().mockResolvedValue({
        outcome,
        sourceId: "demo:quota:v1",
        attemptedAt: "2026-01-01T00:00:00.000Z",
        retryAt: outcome === "rate_limited" ? "2026-01-01T00:01:00.000Z" : null,
      });
      const h = harness({ fetchQuota });

      await expect(h.tracker.refresh(connection())).resolves.toMatchObject({ outcome, persisted: true });
      expect(h.repository.replaceProviderQuotaSnapshotsForSource).not.toHaveBeenCalled();
      expect(h.repository.recordQuotaFetchFailure).toHaveBeenCalledTimes(1);
    },
  );

  it("deduplicates equal identities while isolating different connections", async () => {
    const gate = deferred();
    const fetchQuota = vi.fn(({ connection: active }) => (
      active.id === "conn-1" ? gate.promise : Promise.resolve(success())
    ));
    const h = harness({ fetchQuota });

    const first = h.tracker.refresh(connection("conn-1"));
    const shared = h.tracker.refresh(connection("conn-1"));
    const isolated = h.tracker.refresh(connection("conn-2"));
    await isolated;
    expect(fetchQuota).toHaveBeenCalledTimes(2);

    gate.resolve(success());
    const [a, b] = await Promise.all([first, shared]);
    expect(a).toEqual(b);
    expect(fetchQuota).toHaveBeenCalledTimes(2);
    expect(h.repository.replaceProviderQuotaSnapshotsForSource).toHaveBeenCalledTimes(2);
  });

  it("lets one subscriber abort without cancelling the shared provider request", async () => {
    const gate = deferred();
    let upstreamSignal;
    const fetchQuota = vi.fn(({ signal }) => {
      upstreamSignal = signal;
      return gate.promise;
    });
    const h = harness({ fetchQuota });
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = h.tracker.refresh(connection(), { signal: firstController.signal });
    const second = h.tracker.refresh(connection(), { signal: secondController.signal });
    firstController.abort();

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(upstreamSignal.aborted).toBe(false);
    gate.resolve(success());
    await expect(second).resolves.toMatchObject({ outcome: "success" });
    expect(h.repository.replaceProviderQuotaSnapshotsForSource).toHaveBeenCalledTimes(1);
  });

  it("aborts upstream and performs no persistence when every subscriber leaves", async () => {
    const fetchQuota = vi.fn(({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const h = harness({ fetchQuota });
    const one = new AbortController();
    const two = new AbortController();
    const first = h.tracker.refresh(connection(), { signal: one.signal });
    const second = h.tracker.refresh(connection(), { signal: two.signal });

    one.abort();
    two.abort();

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    expect(h.repository.replaceProviderQuotaSnapshotsForSource).not.toHaveBeenCalled();
    expect(h.repository.recordQuotaFetchFailure).not.toHaveBeenCalled();
  });

  it("prevents a late superseded force generation from persisting or populating cache", async () => {
    const oldGate = deferred();
    const newGate = deferred();
    const fetchQuota = vi.fn()
      .mockImplementationOnce(() => oldGate.promise)
      .mockImplementationOnce(() => newGate.promise)
      .mockResolvedValue(success());
    const h = harness({ fetchQuota });

    const oldRefresh = h.tracker.refresh(connection());
    const forced = h.tracker.refresh(connection(), { force: true });
    newGate.resolve(success([quotaRow({ dimensionKey: "requests:new" })]));
    await expect(forced).resolves.toMatchObject({ outcome: "success" });
    oldGate.resolve(success([quotaRow({ dimensionKey: "requests:old" })]));
    await expect(oldRefresh).resolves.toMatchObject({ outcome: "superseded", persisted: false });

    expect(h.repository.replaceProviderQuotaSnapshotsForSource).toHaveBeenCalledTimes(1);
    expect(h.repository.replaceProviderQuotaSnapshotsForSource.mock.calls[0][0].snapshots[0].identity.dimensionKey).toBe("requests:new");
    const cached = await h.tracker.refresh(connection());
    expect(cached).toMatchObject({ cached: true });
    expect(cached.snapshots[0].identity.dimensionKey).toBe("requests:new");
  });

  it("does not cache a source when repository persistence rejects", async () => {
    const h = harness();
    h.repository.replaceProviderQuotaSnapshotsForSource
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce([]);

    await expect(h.tracker.refresh(connection())).rejects.toThrow("write failed");
    await expect(h.tracker.refresh(connection())).resolves.toMatchObject({ outcome: "success", cached: false });
    expect(h.adapter.fetchQuota).toHaveBeenCalledTimes(2);
  });

  it("does no provider, credential, or database work for unsupported providers", async () => {
    const h = harness();

    const result = await h.tracker.refresh(connection("conn-x", { provider: "unsupported" }));

    expect(result).toEqual({ outcome: "missing", supported: false, cached: false, persisted: false });
    expect(h.adapter.fetchQuota).not.toHaveBeenCalled();
    expect(h.repository.replaceProviderQuotaSnapshotsForSource).not.toHaveBeenCalled();
    expect(h.repository.recordQuotaFetchFailure).not.toHaveBeenCalled();
  });

  it.each(["api_key", "external_idp"])(
    "rejects Kiro %s before proxy resolution, credential refresh, or provider I/O",
    async (authMethod) => {
      const isConnectionEligible = vi.fn((candidate) => ![
        "api_key",
        "external_idp",
      ].includes(candidate.providerSpecificData?.authMethod));
      const h = harness({ isConnectionEligible });
      const candidate = connection(`kiro-${authMethod}`, {
        authType: "oauth",
        providerSpecificData: { authMethod },
      });

      await expect(h.tracker.refresh(candidate)).resolves.toMatchObject({
        outcome: "missing",
        persisted: true,
      });
      expect(isConnectionEligible).toHaveBeenCalledWith(candidate);
      expect(h.proxyResolver).not.toHaveBeenCalled();
      expect(h.credentialRefresher).not.toHaveBeenCalled();
      expect(h.adapter.fetchQuota).not.toHaveBeenCalled();
      expect(h.repository.replaceProviderQuotaSnapshotsForSource).not.toHaveBeenCalled();
      expect(h.repository.recordQuotaFetchFailure).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "missing" }),
        expect.any(Object),
      );
    },
  );

  it("rejects secret-bearing adapter rows as malformed and never echoes the secret", async () => {
    const canary = "sk-secretkeycanary123456";
    const h = harness({
      fetchQuota: vi.fn().mockResolvedValue(success([quotaRow({ metadata: { plan: canary } })])),
    });

    const result = await h.tracker.refresh(connection());

    expect(result).toMatchObject({ outcome: "malformed" });
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(JSON.stringify(h.repository.recordQuotaFetchFailure.mock.calls)).not.toContain(canary);
    expect(h.repository.replaceProviderQuotaSnapshotsForSource).not.toHaveBeenCalled();
  });

  it("does no work for a pre-aborted sole caller", async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort();

    await expect(h.tracker.refresh(connection(), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });

    expect(h.resolveAdapter).not.toHaveBeenCalled();
    expect(h.proxyResolver).not.toHaveBeenCalled();
    expect(h.credentialRefresher).not.toHaveBeenCalled();
    expect(h.adapter.fetchQuota).not.toHaveBeenCalled();
    expect(h.repository.replaceProviderQuotaSnapshotsForSource).not.toHaveBeenCalled();
    expect(h.repository.recordQuotaFetchFailure).not.toHaveBeenCalled();
  });

  it.each([
    ["missing rows", { outcome: "success", sourceId: "demo:quota:v1", attemptedAt: "2026-01-01T00:00:00.000Z" }],
    ["non-array rows", { outcome: "success", sourceId: "demo:quota:v1", rows: {}, attemptedAt: "2026-01-01T00:00:00.000Z" }],
    ["unknown outcome", { outcome: "credential-canary", sourceId: "demo:quota:v1" }],
  ])("records malformed for an adapter result with %s", async (_label, adapterResult) => {
    const h = harness({ fetchQuota: vi.fn().mockResolvedValue(adapterResult) });
    await expect(h.tracker.refresh(connection())).resolves.toMatchObject({ outcome: "malformed" });
    expect(h.repository.recordQuotaFetchFailure).toHaveBeenCalledTimes(1);
    expect(h.repository.replaceProviderQuotaSnapshotsForSource).not.toHaveBeenCalled();
  });

  it("rejects an adapter timestamp beyond the local clock-skew boundary", async () => {
    const future = new Date(START + 10 * 60 * 1000).toISOString();
    const h = harness({ fetchQuota: vi.fn().mockResolvedValue(success([quotaRow()], future)) });

    await expect(h.tracker.refresh(connection())).resolves.toMatchObject({ outcome: "malformed" });
    expect(h.repository.replaceProviderQuotaSnapshotsForSource).not.toHaveBeenCalled();
    expect(h.repository.recordQuotaFetchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "malformed", attemptedAt: new Date(START).toISOString() }),
      expect.objectContaining({ now: START }),
    );
  });

  it.each([
    "opaque-retry-credential-987654321",
    "2026-01-03T00:00:00.000Z",
  ])("turns an invalid adapter retryAt into a body-free malformed outcome", async (retryAt) => {
    const h = harness({
      fetchQuota: vi.fn().mockResolvedValue({
        outcome: "rate_limited",
        sourceId: "demo:quota:v1",
        attemptedAt: new Date(START).toISOString(),
        retryAt,
      }),
    });

    const result = await h.tracker.refresh(connection());

    expect(result).toMatchObject({ outcome: "malformed" });
    expect(JSON.stringify(result)).not.toContain(retryAt);
    expect(JSON.stringify(h.repository.recordQuotaFetchFailure.mock.calls)).not.toContain(retryAt);
  });

  it("turns a secret-bearing adapter exception into a structured provider failure", async () => {
    const canary = "sk-secretadaptercanary123456";
    const h = harness({ fetchQuota: vi.fn().mockRejectedValue(new Error(`failed ${canary}`)) });

    const result = await h.tracker.refresh(connection());

    expect(result).toMatchObject({ outcome: "provider_error" });
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(JSON.stringify(h.repository.recordQuotaFetchFailure.mock.calls)).not.toContain(canary);
  });

  it("records duplicate provider identities as malformed before the repository", async () => {
    const duplicate = quotaRow({ dimensionKey: "requests:duplicate" });
    const h = harness({ fetchQuota: vi.fn().mockResolvedValue(success([duplicate, duplicate])) });

    await expect(h.tracker.refresh(connection())).resolves.toMatchObject({ outcome: "malformed" });
    expect(h.repository.recordQuotaFetchFailure).toHaveBeenCalledTimes(1);
    expect(h.repository.replaceProviderQuotaSnapshotsForSource).not.toHaveBeenCalled();
  });

  it("isolates connection revisions, returns clones, and bounds cache plus generation state", async () => {
    const h = harness({ maxCacheEntries: 2, cacheTtlMs: 60_000 });
    const first = await h.tracker.refresh(connection("conn-1"));
    first.snapshots[0].amounts.remaining = 0;

    const cached = await h.tracker.refresh(connection("conn-1"));
    expect(cached.snapshots[0].amounts.remaining).toBe(75);
    await h.tracker.refresh(connection("conn-1", { updatedAt: "2026-01-01T00:01:00.000Z" }));
    expect(h.adapter.fetchQuota).toHaveBeenCalledTimes(2);
    await h.tracker.refresh(connection("conn-2"));
    await h.tracker.refresh(connection("conn-3"));
    expect(h.tracker.getCacheSize()).toBe(2);
    expect(h.tracker.getStateSize()).toBeLessThanOrEqual(4);
    h.tracker.clear();
    expect(h.tracker.getCacheSize()).toBe(0);
    expect(h.tracker.getStateSize()).toBe(0);
  });

  it("does not cache or commit after all subscribers abort during the repository boundary", async () => {
    const gate = deferred();
    const commits = [];
    const repository = {
      replaceProviderQuotaSnapshotsForSource: vi.fn(async (value, options) => {
        await gate.promise;
        if (options.signal.aborted) throw new DOMException("aborted", "AbortError");
        if (!options.shouldCommit()) {
          const error = new Error("superseded");
          error.code = "PROVIDER_QUOTA_PERSISTENCE_SUPERSEDED";
          throw error;
        }
        commits.push(value);
        return { accepted: true, snapshots: value.snapshots };
      }),
      recordQuotaFetchFailure: vi.fn(),
    };
    const h = harness({ repository });
    const controller = new AbortController();
    const pending = h.tracker.refresh(connection(), { signal: controller.signal });
    await vi.waitFor(() => expect(repository.replaceProviderQuotaSnapshotsForSource).toHaveBeenCalledTimes(1));
    controller.abort();
    gate.resolve();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(h.tracker.getInflightSize()).toBe(0));
    expect(commits).toEqual([]);
    expect(h.tracker.getCacheSize()).toBe(0);
  });

  it("fences a forced generation inside the delayed repository commit boundary", async () => {
    const oldGate = deferred();
    const commits = [];
    const repository = {
      replaceProviderQuotaSnapshotsForSource: vi.fn(async (value, options) => {
        if (value.snapshots[0]?.identity.dimensionKey === "requests:old") await oldGate.promise;
        if (!options.shouldCommit()) {
          const error = new Error("superseded");
          error.code = "PROVIDER_QUOTA_PERSISTENCE_SUPERSEDED";
          throw error;
        }
        commits.push(value.snapshots[0]?.identity.dimensionKey);
        return { accepted: true, snapshots: value.snapshots };
      }),
      recordQuotaFetchFailure: vi.fn(),
    };
    const fetchQuota = vi.fn()
      .mockResolvedValueOnce(success([quotaRow({ dimensionKey: "requests:old" })]))
      .mockResolvedValueOnce(success([quotaRow({ dimensionKey: "requests:new" })]));
    const h = harness({ repository, fetchQuota });

    const oldRefresh = h.tracker.refresh(connection());
    await vi.waitFor(() => expect(repository.replaceProviderQuotaSnapshotsForSource).toHaveBeenCalledTimes(1));
    const forced = h.tracker.refresh(connection(), { force: true });
    await expect(forced).resolves.toMatchObject({ outcome: "success" });
    oldGate.resolve();
    await expect(oldRefresh).resolves.toMatchObject({ outcome: "superseded", persisted: false });
    expect(commits).toEqual(["requests:new"]);
  });

  it("propagates cancellation into an OAuth credential refresh before any secret write or adapter call", async () => {
    const credentialRefresher = vi.fn((_connection, _force, _proxy, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const h = harness({ credentialRefresher });
    const controller = new AbortController();
    const pending = h.tracker.refresh(connection("conn-oauth", { authType: "oauth" }), { signal: controller.signal });
    await vi.waitFor(() => expect(credentialRefresher).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(h.adapter.fetchQuota).not.toHaveBeenCalled();
    expect(h.repository.replaceProviderQuotaSnapshotsForSource).not.toHaveBeenCalled();
    expect(h.repository.recordQuotaFetchFailure).not.toHaveBeenCalled();
  });

  it("treats a connection deleted during credential refresh as superseded", async () => {
    const credentialRefresher = vi.fn(async () => {
      const error = new Error("deleted");
      error.code = "PROVIDER_CONNECTION_NOT_FOUND";
      throw error;
    });
    const h = harness({ credentialRefresher });

    await expect(h.tracker.refresh(connection("conn-deleted", { authType: "oauth" }))).resolves.toMatchObject({
      outcome: "superseded",
      persisted: false,
    });
    expect(h.adapter.fetchQuota).not.toHaveBeenCalled();
    expect(h.repository.replaceProviderQuotaSnapshotsForSource).not.toHaveBeenCalled();
    expect(h.repository.recordQuotaFetchFailure).not.toHaveBeenCalled();
  });

  it("records a bounded credential waiter timeout without calling the provider adapter", async () => {
    const credentialRefresher = vi.fn(async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      error.code = "PROVIDER_CREDENTIAL_REFRESH_TIMEOUT";
      throw error;
    });
    const h = harness({ credentialRefresher });

    await expect(h.tracker.refresh(connection("conn-timeout", { authType: "oauth" }))).resolves.toMatchObject({
      outcome: "timeout",
    });
    expect(h.adapter.fetchQuota).not.toHaveBeenCalled();
    expect(h.repository.recordQuotaFetchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "timeout" }),
      expect.any(Object),
    );
  });

  it.each([
    ["PROVIDER_REAUTH_REQUIRED", "unauthenticated"],
    ["PROVIDER_REFRESH_RESULT_MALFORMED", "malformed"],
    ["DATABASE_UNAVAILABLE", "provider_error"],
  ])("maps credential failure %s to %s without calling the adapter", async (code, outcome) => {
    const credentialRefresher = vi.fn(async () => {
      const error = new Error("credential boundary failure");
      error.code = code;
      throw error;
    });
    const h = harness({ credentialRefresher });

    await expect(h.tracker.refresh(connection(`conn-${code}`, { authType: "oauth" }))).resolves.toMatchObject({ outcome });
    expect(h.adapter.fetchQuota).not.toHaveBeenCalled();
    expect(h.repository.recordQuotaFetchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ outcome }),
      expect.any(Object),
    );
  });

  it("caches OAuth quota only under the refreshed connection revision", async () => {
    const refreshedConnection = connection("conn-oauth-cache", {
      authType: "oauth",
      accessToken: "access-new",
      updatedAt: "2026-01-01T00:01:00.000Z",
      providerSpecificData: { accountId: "account-new" },
    });
    const credentialRefresher = vi.fn().mockResolvedValue({ connection: refreshedConnection, refreshed: true });
    const h = harness({ credentialRefresher, cacheTtlMs: 60_000 });
    const staleConnection = connection("conn-oauth-cache", {
      authType: "oauth",
      accessToken: "access-old",
      updatedAt: "2026-01-01T00:00:00.000Z",
      providerSpecificData: { accountId: "account-old" },
    });

    await expect(h.tracker.refresh(staleConnection)).resolves.toMatchObject({ outcome: "success", cached: false });
    await expect(h.tracker.refresh(refreshedConnection)).resolves.toMatchObject({ outcome: "success", cached: true });

    expect(h.adapter.fetchQuota).toHaveBeenCalledTimes(1);
    expect(h.adapter.fetchQuota.mock.calls[0][0].connection).toEqual(refreshedConnection);
  });
});
