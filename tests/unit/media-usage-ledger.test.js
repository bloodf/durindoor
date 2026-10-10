import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared contract for #1085; these are normalized caller inputs, not
// guessed provider response fields. All writers must use saveRequestUsage's
// existing transaction: usageHistory + usageDaily + API-key lifetime totals.
// recordApiKeyUsageForResponse(apiKey, response, event) gates on HTTP success.
// event: { timestamp?, billingEpoch, usageEventId, provider, model, connectionId, endpoint,
//   modality, tokens: object, nativeUnits: Record<string, number>,
//   cost: number | null, costStatus: "known" | "estimated" | "unknown", costSource: string }.
// Store modality/nativeUnits/costStatus/costSource in usageHistory.meta.
// Explicit cost (including zero) is preserved; unknown cost stays SQL NULL.
// recordNativeUsage accepts the same accounting fields alongside its existing
// value/fallbackUsage inputs. It must not lose metadata or reprice known cost.
// No second ledger and no totals-only compatibility fallback at final cutover.
// Capture auth.billingEpoch before dispatch, retain it across retries and persist
// it with async jobs. Never replace null/stale epochs at completion. After an
// import cutover, the writer accepts only the exact current captured epoch.
// PostgreSQL cross-writer verification plan (parent-owned execution): migrate a
// disposable database, then launch two separate Node processes with independent
// production sync adapters. Barrier-start distinct event IDs for the same absent
// day/key totals and absent totalRequestsLifetime; repeat with populated rows and
// different days. Mix known zero, paid, and unknown charges, plus duplicate IDs.
// Assert exact history cardinality, daily/dimension sums, lifetime/window totals,
// and totalRequestsLifetime. Hold the schemaVersion row lock in a third connection
// to prove both writers wait; release with COMMIT and repeat with ROLLBACK. Inject
// a totals failure to verify no history/daily/counter partial commit. Promise.all
// against one synchronous adapter is not evidence of PostgreSQL concurrency.

const timestamp = "2026-10-09T12:00:00.000Z";
const dayStart = "2026-10-09T00:00:00.000Z";
const monthStart = "2026-10-01T00:00:00.000Z";
const secret = "sk-media-ledger-fixture";
const keyId = "media-ledger-key";
const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let directory;
let originalEnv;
let processListeners;
let adapter;
let database;
let policy;

beforeEach(async () => {
  processListeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  originalEnv = Object.fromEntries(["DATA_DIR", "DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL"].map((name) => [name, process.env[name]]));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-media-ledger-"));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete process.env.DURINDOOR_PG_URL;
  delete global._dbAdapter;
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(timestamp));
  database = await import("@/lib/db/index.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  adapter = await getAdapter();
  adapter.run(
    "INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)",
    [keyId, secret, "Media ledger fixture", timestamp],
  );
  policy = await import("@/sse/services/apiKeyPolicy.js");
});

afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.useRealTimers();
  for (const signal of signals) {
    for (const listener of process.listeners(signal)) {
      if (!processListeners.get(signal).has(listener)) process.removeListener(signal, listener);
    }
  }
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(directory, { recursive: true, force: true });
});

function event(overrides = {}) {
  return {
    timestamp,
    usageEventId: "media-fixture:account-a:event-a",
    provider: "media-fixture",
    model: "paid-image",
    connectionId: "account-a",
    endpoint: "/v1/images/generations",
    modality: "image",
    tokens: {},
    nativeUnits: { images: 2 },
    cost: 0.25,
    costStatus: "known",
    costSource: "provider",
    ...overrides,
  };
}

function rows() {
  return adapter.all("SELECT * FROM usageHistory WHERE apiKey = ? ORDER BY id", [secret]);
}

async function expectCounters(requests, cost, inputTokens = 0, outputTokens = 0, unknownCostRequests = 0) {
  expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({
    totalRequests: requests, totalCost: cost, totalTokens: inputTokens + outputTokens, unknownCostRequests,
  });
  const window = { requests, cost, inputTokens, outputTokens, unknownCostRequests };
  expect(await database.getApiKeyWindowUsageTotals(secret, dayStart, monthStart)).toEqual({ day: window, month: window });
}

function expectMetadata(row, usage) {
  expect(JSON.parse(row.meta)).toMatchObject({
    modality: usage.modality,
    nativeUnits: usage.nativeUnits,
    costStatus: usage.costStatus,
    costSource: usage.costSource,
  });
}

describe("media usage in the existing usageHistory ledger", () => {
  it("commits a paid non-token success once, with identity, native units, provenance and counters", async () => {
    const usage = event();
    const response = new Response("paid image bytes", { status: 200 });
    const returned = await policy.recordApiKeyUsageForResponse(secret, response, usage);
    expect(returned).toBe(response);
    expect(await returned.text()).toBe("paid image bytes");
    expect(rows()).toHaveLength(1);
    const [row] = rows();
    expect(row).toMatchObject({
      timestamp, usageEventId: usage.usageEventId, apiKey: secret,
      provider: usage.provider, model: usage.model, connectionId: usage.connectionId,
      endpoint: usage.endpoint, status: "ok", cost: 0.25, promptTokens: 0, completionTokens: 0,
    });
    expectMetadata(row, usage);
    await expectCounters(1, 0.25);
    const daily = adapter.all("SELECT data FROM usageDaily").map((row) => JSON.parse(row.data));
    expect(daily).toHaveLength(1);
    expect(daily[0]).toMatchObject({ requests: 1, cost: 0.25, promptTokens: 0, completionTokens: 0 });
  });

  it("deduplicates concurrent retries but counts a distinct event with identical usage", async () => {
    const usage = event({ tokens: { input_tokens: 7, output_tokens: 3 } });
    await Promise.all([0, 1].map(() => policy.recordApiKeyUsageForResponse(secret, new Response(null), { ...usage })));
    expect(rows()).toHaveLength(1);
    await expectCounters(1, 0.25, 7, 3);
    await policy.recordApiKeyUsageForResponse(secret, new Response(null), event({
      ...usage, usageEventId: "media-fixture:account-a:event-b",
    }));
    expect(rows().map((row) => row.usageEventId)).toEqual([usage.usageEventId, "media-fixture:account-a:event-b"]);
    await expectCounters(2, 0.5, 14, 6);
    expect(JSON.parse(adapter.get("SELECT data FROM usageDaily").data)).toMatchObject({ requests: 2, cost: 0.5 });
  });

  it.each(["prune", "all", "1h"])("retains legacy event receipts through %s history removal", async (mode) => {
    const usage = { ...event(), apiKey: secret, strict: true };
    await database.saveRequestUsage(usage);
    // Simulate history written before durable receipts existed.
    adapter.run("DELETE FROM kv WHERE scope = 'usageEventReceipts'");
    vi.setSystemTime(new Date("2026-10-10T12:00:00.000Z"));
    if (mode === "prune") {
      const { pruneUsageOlderThan } = await import("@/lib/db/repos/usageRepo.js");
      await pruneUsageOlderThan(Date.now());
    } else await database.resetUsageHistory(mode);
    expect(rows()).toEqual([]);
    await database.saveRequestUsage(usage);
    expect(rows()).toEqual([]);
    expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ totalRequests: 1, totalCost: 0.25 });
    await database.saveRequestUsage({ ...usage, usageEventId: "distinct-after-prune" });
    expect(rows().map((row) => row.usageEventId)).toEqual(["distinct-after-prune"]);
    expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ totalRequests: 2, totalCost: 0.5 });
  });

  it("preserves pruned receipts with portable totals in a complete backup", async () => {
    const usage = { ...event(), apiKey: secret, strict: true };
    await database.saveRequestUsage(usage);
    await database.resetUsageHistory("all");
    const backup = await database.exportDb();
    // This fixture contains every historical receipt, unlike a legacy export.
    backup.usageEventReceiptsVersion = 1;
    // Simulate restoring into storage with no local deduplication state.
    adapter.run("DELETE FROM kv WHERE scope = 'usageEventReceipts'");
    await database.importDb(backup);
    await expect(database.saveRequestUsage(usage)).rejects.toThrow("billing epoch");
    expect(rows()).toEqual([]);
    expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ totalRequests: 1, totalCost: 0.25 });
    const { getBillingEpoch } = await import("@/lib/db/repos/usageRepo.js");
    await database.saveRequestUsage({ ...usage, usageEventId: "distinct-after-import", billingEpoch: await getBillingEpoch() });
    expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ totalRequests: 2, totalCost: 0.5 });
  });

  it("fences admitted requests across import while keeping retry epochs stable", async () => {
    const { resolveClientApiKey, evaluateApiKeyAuth } = await import("@/sse/services/auth.js");
    const { captureRequestBillingEpoch } = await import("@/sse/utils/requestCorrelation.js");
    const makeRequest = () => new Request("http://localhost/v1/images/generations", {
      headers: { authorization: `Bearer ${secret}` },
    });
    const request = makeRequest();
    const [admission, concurrent] = await Promise.all([
      resolveClientApiKey(request, { required: true }),
      resolveClientApiKey(request, { required: true }),
    ]);
    expect(admission.auth).toMatchObject({ ok: true, apiKeyId: keyId, billingEpoch: null });
    expect(concurrent.auth.billingEpoch).toBeNull();
    await policy.recordApiKeyUsage(secret, event({ billingEpoch: admission.auth.billingEpoch }));
    const backup = await database.exportDb();
    // A charged legacy backup cannot prove complete historical receipt coverage.
    const { usageEventReceiptsVersion, usageEventReceipts, ...legacy } = backup;
    await database.importDb(legacy);
    expect((await resolveClientApiKey(request, { required: true })).auth.billingEpoch).toBeNull();
    expect(await captureRequestBillingEpoch(request)).toBeNull();
    const fresh = await resolveClientApiKey(makeRequest(), { required: true });
    expect(fresh.auth.billingEpoch).toEqual(expect.any(String));
    expect(fresh.auth.billingEpoch).not.toBe("");
    expect((await evaluateApiKeyAuth(secret, { required: true })).billingEpoch).toBe(fresh.auth.billingEpoch);
    const historyBefore = adapter.all("SELECT * FROM usageHistory");
    const dailyBefore = adapter.all("SELECT * FROM usageDaily");
    const totalsBefore = await database.getApiKeyUsageTotals(keyId);
    const receiptsBefore = adapter.all("SELECT key FROM kv WHERE scope = 'usageEventReceipts' ORDER BY key");
    for (const billingEpoch of [undefined, admission.auth.billingEpoch, "wrong-generation"]) {
      await expect(policy.recordApiKeyUsage(secret, event({ billingEpoch }))).rejects.toMatchObject({
        code: "USAGE_ACCOUNTING_FAILED", message: "Stale or missing billing epoch",
      });
      await expect(database.saveRequestUsage({ ...event({ billingEpoch }), apiKey: secret, strict: true }))
        .rejects.toThrow("Stale or missing billing epoch");
    }
    expect(adapter.all("SELECT * FROM usageHistory")).toEqual(historyBefore);
    expect(adapter.all("SELECT * FROM usageDaily")).toEqual(dailyBefore);
    expect(await database.getApiKeyUsageTotals(keyId)).toEqual(totalsBefore);
    expect(adapter.all("SELECT key FROM kv WHERE scope = 'usageEventReceipts' ORDER BY key")).toEqual(receiptsBefore);
    const current = event({ billingEpoch: fresh.auth.billingEpoch });
    await policy.recordApiKeyUsage(secret, current);
    await policy.recordApiKeyUsage(secret, current);
    expect(rows()).toHaveLength(1);
    expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ totalRequests: 2, totalCost: 0.5 });
    // Restoring a cutover backup rotates the fence again; a once-valid event
    // must not be upgraded or replayed into the new generation.
    await database.importDb(await database.exportDb());
    await expect(policy.recordApiKeyUsage(secret, current)).rejects.toMatchObject({
      code: "USAGE_ACCOUNTING_FAILED", message: "Stale or missing billing epoch",
    });
    const next = await resolveClientApiKey(makeRequest(), { required: true });
    expect(next.auth.billingEpoch).not.toBe(fresh.auth.billingEpoch);
    await policy.recordApiKeyUsage(secret, event({ billingEpoch: next.auth.billingEpoch }));
    expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ totalRequests: 3, totalCost: 0.75 });
  });

  it("rejects a completion suspended in pricing when restore rotates its captured epoch", async () => {
    const pricing = await import("@/lib/db/repos/pricingRepo.js");
    const { getBillingEpoch } = await import("@/lib/db/repos/usageRepo.js");
    await database.saveRequestUsage({ ...event(), apiKey: secret, strict: true });
    const snapshot = await database.exportDb();
    let release;
    let entered;
    const blocked = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { entered = resolve; });
    const lookup = vi.spyOn(pricing, "getPricingForModel").mockImplementation(async () => {
      entered();
      await blocked;
      return null;
    });
    const stale = database.saveRequestUsage({
      apiKey: secret, provider: "media-fixture", model: "paid-image",
      usageEventId: "suspended-completion", billingEpoch: await getBillingEpoch(),
      tokens: { prompt_tokens: 2 }, strict: true,
    });
    const rejected = expect(stale).rejects.toThrow("billing epoch");
    try {
      await started;
      await database.importDb(snapshot);
      const before = {
        history: adapter.all("SELECT * FROM usageHistory"),
        daily: adapter.all("SELECT * FROM usageDaily"),
        totals: adapter.all("SELECT * FROM apiKeyUsageTotals"),
        receipts: adapter.all("SELECT * FROM kv WHERE scope = 'usageEventReceipts' ORDER BY key"),
      };
      release();
      await rejected;
      expect(adapter.all("SELECT * FROM usageHistory")).toEqual(before.history);
      expect(adapter.all("SELECT * FROM usageDaily")).toEqual(before.daily);
      expect(adapter.all("SELECT * FROM apiKeyUsageTotals")).toEqual(before.totals);
      expect(adapter.all("SELECT * FROM kv WHERE scope = 'usageEventReceipts' ORDER BY key")).toEqual(before.receipts);
    } finally {
      release();
      await rejected;
      lookup.mockRestore();
    }
  });

  it.each([0.25, 0])("preserves authoritative cost %s in the shared writer instead of token repricing", async (cost) => {
    await database.updatePricing({ "media-fixture": { "paid-image": { input: 100, output: 100 } } });
    const usage = event({ cost, tokens: { input_tokens: 1000, output_tokens: 500 } });
    await database.saveRequestUsage({ ...usage, apiKey: secret, status: "ok", strict: true });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].cost).toBe(cost);
    expectMetadata(rows()[0], usage);
    await expectCounters(1, cost, 1000, 500);
  });

  it("stores unknown cost explicitly, not as a free request, while counting successful use", async () => {
    const usage = event({ cost: null, costStatus: "unknown", costSource: "unavailable" });
    await policy.recordApiKeyUsageForResponse(secret, new Response(null), usage);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].cost).toBeNull();
    expectMetadata(rows()[0], usage);
    // Counters sum known spend only; this zero must not erase the row's unknown status.
    await expectCounters(1, 0, 0, 0, 1);
    const daily = JSON.parse(adapter.get("SELECT data FROM usageDaily").data);
    expect(daily).toMatchObject({ requests: 1, cost: 0, unknownCostRequests: 1 });
    for (const dimension of ["byProvider", "byModel", "byAccount", "byApiKey", "byEndpoint"]) {
      expect(Object.values(daily[dimension])).toEqual([expect.objectContaining({ requests: 1, cost: 0, unknownCostRequests: 1 })]);
    }
    await policy.recordApiKeyUsageForResponse(secret, new Response(null), event({ usageEventId: "known-after-unknown" }));
    await expectCounters(2, 0.25, 0, 0, 1);
    expect(JSON.parse(adapter.get("SELECT data FROM usageDaily").data)).toMatchObject({ requests: 2, cost: 0.25, unknownCostRequests: 1 });
  });

  it("does not charge validation failures, policy denials or upstream failures", async () => {
    for (const status of [400, 403, 429, 500, 502]) {
      const response = new Response(null, { status });
      expect(await policy.recordApiKeyUsageForResponse(secret, response, event({
        usageEventId: `media-fixture:account-a:failed-${status}`,
      }))).toBe(response);
    }
    expect(rows()).toEqual([]);
    expect(adapter.all("SELECT data FROM usageDaily")).toEqual([]);
    await expectCounters(0, 0);
    // Failed attempts cannot spend the next successful request's allowance.
    await policy.recordApiKeyUsageForResponse(secret, new Response(null), event());
    await expectCounters(1, 0.25);
  });

  it("keeps native terminal usage on the same ledger with cost and native-unit provenance", async () => {
    const { recordNativeUsage } = await import("@/sse/services/nativeUsage.js");
    const usage = event({
      modality: "audio", endpoint: "/v1/audio/speech", nativeUnits: { characters: 120 },
      usageEventId: "media-fixture:account-a:native-terminal",
    });
    const input = { ...usage, apiKey: secret, value: { usage: { input_tokens: 7, output_tokens: 3 } } };
    await recordNativeUsage(input);
    await recordNativeUsage(input);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ usageEventId: usage.usageEventId, cost: 0.25, endpoint: usage.endpoint });
    expectMetadata(rows()[0], usage);
    await expectCounters(1, 0.25, 7, 3);
  });
  it("preserves an estimated charge and caller metadata without repricing", async () => {
    const usage = event({ cost: 0.12, costStatus: "estimated", costSource: "image-rate", meta: { quality: "high" } });
    await policy.recordApiKeyUsageForResponse(secret, new Response(null), usage);
    expect(rows()[0].cost).toBe(0.12);
    expectMetadata(rows()[0], usage);
    expect(JSON.parse(rows()[0].meta).quality).toBe("high");
    await expectCounters(1, 0.12);
  });

  it("rejects totals-only legacy input instead of silently losing paid usage", async () => {
    await expect(policy.recordApiKeyUsageForResponse(secret, new Response(null), { tokens: 5, cost: 0.25 })).rejects.toThrow("Usage event requires");
    expect(rows()).toEqual([]);
    await expectCounters(0, 0);
  });

  it.each([
    { cost: -1 }, { cost: NaN }, { cost: Infinity }, { cost: null },
    { cost: 1, costStatus: "unknown" }, { nativeUnits: { images: -1 } },
  ])("rejects invalid normalized accounting without partial writes: %j", async (invalid) => {
    await expect(policy.recordApiKeyUsageForResponse(secret, new Response(null), event(invalid))).rejects.toThrow();
    expect(rows()).toEqual([]);
    expect(adapter.all("SELECT data FROM usageDaily")).toEqual([]);
    await expectCounters(0, 0);
  });

  it("rolls back the receipt and all accounting when totals fail, allowing retry", async () => {
    adapter.run(`CREATE TRIGGER fail_media_totals BEFORE INSERT ON apiKeyUsageTotals
      BEGIN SELECT RAISE(ABORT, 'injected totals failure'); END`);
    await expect(policy.recordApiKeyUsageForResponse(secret, new Response(null), event())).rejects.toThrow();
    expect(rows()).toEqual([]);
    expect(adapter.all("SELECT data FROM usageDaily")).toEqual([]);
    expect(adapter.all("SELECT key FROM kv WHERE scope = 'usageEventReceipts'")).toEqual([]);
    expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ totalRequests: 0, totalCost: 0 });
    adapter.run("DROP TRIGGER fail_media_totals");
    await policy.recordApiKeyUsageForResponse(secret, new Response(null), event());
    await policy.recordApiKeyUsageForResponse(secret, new Response(null), event());
    await expectCounters(1, 0.25);
    expect(rows()).toHaveLength(1);
  });

  it("records native non-token usage and unknown charges without a key", async () => {
    const { recordNativeUsage } = await import("@/sse/services/nativeUsage.js");
    await recordNativeUsage({ ...event({ cost: null, costStatus: "unknown", costSource: "unavailable" }), apiKey: null });
    const row = adapter.get("SELECT * FROM usageHistory");
    expect(row).toMatchObject({ apiKey: null, cost: null, promptTokens: 0, completionTokens: 0 });
    expect(JSON.parse(row.meta)).toMatchObject({ costStatus: "unknown", nativeUnits: { images: 2 } });
    expect(JSON.parse(adapter.get("SELECT data FROM usageDaily").data)).toMatchObject({ requests: 1, cost: 0, unknownCostRequests: 1 });
  });

  it("rejects incomplete native accounting instead of guessing billing", async () => {
    const { recordNativeUsage } = await import("@/sse/services/nativeUsage.js");
    await expect(recordNativeUsage({
      apiKey: secret, provider: "media-fixture", model: "paid-image",
      connectionId: "account-a", endpoint: "/v1/audio/speech",
      usageEventId: "incomplete-native", value: { usage: { input_tokens: 7 } },
    })).rejects.toThrow("Usage event requires");
    expect(rows()).toEqual([]);
    await expectCounters(0, 0);
  });
  it.each(["today", "24h", "7d", "all"])("preserves unknown and known spend in public %s aggregates", async (period) => {
    for (const [id, cost] of [["unknown", null], ["free", 0], ["paid", 0.25]]) {
      await database.saveRequestUsage({ ...event({ usageEventId: id, cost,
        costStatus: cost === null ? "unknown" : "known" }), apiKey: secret, strict: true });
    }
    const stats = await database.getUsageStats(period);
    expect(stats).toMatchObject({ totalRequests: 3, totalCost: 0.25, unknownCostRequests: 1 });
    for (const dimension of ["byProvider", "byModel", "byAccount", "byApiKey", "byEndpoint"]) {
      expect(Object.values(stats[dimension])).toEqual([expect.objectContaining({ requests: 3, cost: 0.25, unknownCostRequests: 1 })]);
    }
    expect(stats.last10Minutes.reduce((sum, bucket) => sum + bucket.unknownCostRequests, 0)).toBe(1);
    const chart = await database.getChartData(period);
    expect(chart.reduce((sum, bucket) => sum + bucket.unknownCostRequests, 0)).toBe(1);
    expect(chart.reduce((sum, bucket) => sum + bucket.cost, 0)).toBe(0.25);
    await expectCounters(3, 0.25, 0, 0, 1);
    expect(await database.getAllApiKeyUsageTotals()).toEqual([expect.objectContaining({ unknownCostRequests: 1 })]);
    // Once history is pruned, yesterday's daily JSON and durable lifetime row
    // must still distinguish unknown cost from a known free request.
    vi.setSystemTime(new Date("2026-10-10T12:00:00.000Z"));
    adapter.run("DELETE FROM usageHistory");
    expect(await database.getUsageStats("all")).toMatchObject({ unknownCostRequests: 1, totalCost: 0.25 });
    expect((await database.getChartData("all")).reduce((sum, bucket) => sum + bucket.unknownCostRequests, 0)).toBe(1);
    expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ unknownCostRequests: 1 });
  });

  it("normalizes fractional components once and preserves zero alias precedence", async () => {
    await database.saveRequestUsage({ ...event({ tokens: {
      prompt_tokens: 0, input_tokens: 99, completion_tokens: 1.2, output_tokens: 99,
      cached_tokens: 0, cache_read_input_tokens: 99,
      reasoning_tokens: 0, output_tokens_details: { reasoning_tokens: 99 },
    } }), apiKey: secret, strict: true });
    expect(rows()[0]).toMatchObject({ promptTokens: 0, completionTokens: 2, cachedTokens: 0, reasoningTokens: 0 });
    expect(JSON.parse(rows()[0].tokens)).toMatchObject({ prompt_tokens: 0, completion_tokens: 2, total_tokens: 2, cached_tokens: 0 });
    await expectCounters(1, 0.25, 0, 2);
    expect(await database.getUsageStats("today")).toMatchObject({ totalPromptTokens: 0, totalCompletionTokens: 2 });
    expect((await database.getChartData("today")).reduce((sum, bucket) => sum + bucket.tokens, 0)).toBe(2);
  });

  it("accepts an explicit zero total without taking nonzero lower-priority aliases", async () => {
    await database.saveRequestUsage({ ...event({ tokens: {
      prompt_tokens: 0, input_tokens: 7, completion_tokens: 0, output_tokens: 3,
      total_tokens: 0, totalTokenCount: 10,
    } }), apiKey: secret, strict: true });
    await expectCounters(1, 0.25);
    expect(JSON.parse(rows()[0].tokens)).toMatchObject({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  it.each([
    { prompt_tokens: -1 }, { input_tokens: "7" }, { completion_tokens: NaN },
    { cached_tokens: Infinity }, { output_tokens_details: { reasoning_tokens: -1 } },
    { total_tokens: 5 }, { prompt_tokens: 2, total_tokens: 0 },
    { prompt_tokens: 1, input_tokens: "ignored-invalid-alias" },
  ])("rejects invalid or unallocatable token counts without partial writes: %j", async (tokens) => {
    await expect(database.saveRequestUsage({ ...event({ tokens }), apiKey: secret, strict: true })).rejects.toThrow("Usage");
    expect(rows()).toEqual([]);
    expect(adapter.all("SELECT data FROM usageDaily")).toEqual([]);
    await expectCounters(0, 0);
  });

  it.each([
    { total_tokens: 5 }, { input_tokens: 2, total_tokens: 5 },
    { input_tokens: -1 }, { input_tokens: "7" }, { input_tokens: false },
    { input_tokens: {} }, { input_tokens: [] },
    { output_tokens_details: { reasoning_tokens: -1 } },
    { responseTokenCount: "invalid" }, { total_token_count: "invalid" },
  ])("rejects native usage rather than substituting valid fallback: %j", async (usage) => {
    const { recordNativeUsage, observeNativeResponse } = await import("@/sse/services/nativeUsage.js");
    const input = { ...event(), apiKey: secret, tokens: { input_tokens: 9 }, fallbackUsage: { input_tokens: 8 } };
    await expect(recordNativeUsage({ ...input, value: { usage } })).rejects.toThrow("Usage");
    for (const sse of [false, true]) {
      const body = JSON.stringify({ type: "response.completed", usage });
      const response = new Response(sse ? `data: ${body}\n\n` : body, {
        headers: { "content-type": sse ? "text/event-stream" : "application/json" },
      });
      await expect(observeNativeResponse(response, input).text()).rejects.toThrow("Usage");
    }
    expect(rows()).toEqual([]);
    expect(adapter.all("SELECT data FROM usageDaily")).toEqual([]);
    await expectCounters(0, 0);
  });

  it.each([
    [0, 0, 0, 0, 0], [100, 20, 1, 1, 3], [20, 20, 1, 1, 0], [100, 0, 1, 0, 3],
  ])("derives timing samples from event durations %s/%s", async (latencyMs, ttftMs, latencySamples, ttftSamples, timedCompletionTokens) => {
    await database.saveRequestUsage({ ...event({ tokens: { output_tokens: 2.2 }, latencyMs, ttftMs,
      latencySamples: 999, ttftSamples: -50, timedCompletionTokens: 99999 }), apiKey: secret, strict: true });
    const expected = { latencyMs, ttftMs, latencySamples, ttftSamples, timedCompletionTokens };
    expect(rows()[0]).toMatchObject({ latencyMs, ttftMs, completionTokens: 3 });
    const daily = JSON.parse(adapter.get("SELECT data FROM usageDaily").data);
    expect(daily).toMatchObject(expected);
    for (const dimension of ["byProvider", "byModel", "byAccount", "byApiKey", "byEndpoint"]) {
      for (const bucket of Object.values(daily[dimension])) expect(bucket).toMatchObject(expected);
    }
  });

  it.each([NaN, Infinity, -1, "100"])("rejects invalid event timing %j without partial writes", async (value) => {
    for (const field of ["latencyMs", "ttftMs"]) {
      await expect(database.saveRequestUsage({ ...event({ [field]: value }), apiKey: secret, strict: true })).rejects.toThrow("Usage timing");
    }
    expect(rows()).toEqual([]);
    expect(adapter.all("SELECT data FROM usageDaily")).toEqual([]);
    await expectCounters(0, 0);
  });

  it("retains preaggregated timing counters in the aggregate helper", async () => {
    const { aggregateEntryToDay } = await import("@/lib/db/repos/usageRepo.js");
    const day = {};
    aggregateEntryToDay(day, { requests: 4, tokens: { completion_tokens: 30 },
      latencyMs: 500, ttftMs: 100, latencySamples: 3, ttftSamples: 2, timedCompletionTokens: 20 });
    expect(day).toMatchObject({ requests: 4, latencyMs: 500, ttftMs: 100,
      latencySamples: 3, ttftSamples: 2, timedCompletionTokens: 20 });
  });

  it.each(["", "not-a-date", "2026-99-99T12:00:00Z", "2026-02-30T12:00:00Z", "2026-10-09T12:00:00", 0, null])("rejects invalid timestamp %j", async (invalid) => {
    await expect(database.saveRequestUsage({ ...event({ timestamp: invalid }), apiKey: secret, strict: true })).rejects.toThrow("timestamp");
    expect(rows()).toEqual([]);
    await expectCounters(0, 0);
  });

  it("derives event counters and stores prototype-named dimensions as own keys", async () => {
    const before = Object.getOwnPropertyDescriptors(Object.prototype);
    for (const [id, cost] of [["unknown", null], ["paid", 0.25]]) {
      await database.saveRequestUsage({ ...event({ usageEventId: id, provider: "__proto__", model: "constructor",
        cost, costStatus: cost === null ? "unknown" : "known", requests: 400, unknownCostRequests: 999 }), apiKey: secret, strict: true });
    }
    const daily = JSON.parse(adapter.get("SELECT data FROM usageDaily").data);
    expect(Object.hasOwn(daily.byProvider, "__proto__")).toBe(true);
    expect(daily.byProvider.__proto__).toMatchObject({ requests: 2, unknownCostRequests: 1, cost: 0.25 });
    expect(await database.getUsageStats("today")).toMatchObject({ totalRequests: 2, unknownCostRequests: 1 });
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before);
    expect(adapter.get("SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'").value).toBe("2");
    await expectCounters(2, 0.25, 0, 0, 1);
  });
});
