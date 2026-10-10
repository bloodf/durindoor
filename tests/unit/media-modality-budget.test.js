import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #1085 acceptance: every paid modality writes one attributed durable record,
// unknown cost stays distinct from authoritative zero, failed responses spend
// nothing, and the next request's policy decision (lifetime maxCostUsd and
// monthlyBudget) agrees with the committed ledger. Real isolated SQLite and the
// real policy enforcer; no provider or network.

const timestamp = "2026-10-09T12:00:00.000Z";
const secret = "sk-modality-budget-fixture";
const keyId = "modality-budget-key";
const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let directory;
let originalEnv;
let processListeners;
let adapter;
let database;
let policy;

async function setup(keyPolicy) {
  processListeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  originalEnv = Object.fromEntries(["DATA_DIR", "DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL"].map((name) => [name, process.env[name]]));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-modality-budget-"));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete process.env.DURINDOOR_PG_URL;
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(timestamp));
  database = await import("@/lib/db/index.js");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  adapter.run(
    "INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, policy, createdAt) VALUES(?, ?, ?, 1, '[]', ?, ?)",
    [keyId, secret, "Modality budget fixture", JSON.stringify(keyPolicy), timestamp],
  );
  policy = await import("@/sse/services/apiKeyPolicy.js");
}

afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
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

const modalities = [
  { modality: "image", endpoint: "/v1/images/generations", model: "paid-image", nativeUnits: { images: 2 } },
  { modality: "stt", endpoint: "/v1/audio/transcriptions", model: "paid-stt", nativeUnits: { audioSeconds: 12.5 } },
  { modality: "tts", endpoint: "/v1/audio/speech", model: "paid-tts", nativeUnits: { characters: 40 } },
  { modality: "embedding", endpoint: "/v1/embeddings", model: "paid-embed", nativeUnits: {}, tokens: { input_tokens: 9 } },
  { modality: "rerank", endpoint: "/v1/rerank", model: "paid-rerank", nativeUnits: { operations: 1 } },
];

function usage(spec, index, overrides = {}) {
  return {
    timestamp, provider: "media-fixture", connectionId: `account-${spec.modality}`, tokens: {},
    usageEventId: `budget:${spec.modality}:${index}`, cost: 0.25, costStatus: "known", costSource: "provider",
    ...spec, ...overrides,
  };
}

const rows = () => adapter.all("SELECT * FROM usageHistory WHERE apiKey = ? ORDER BY id", [secret]);
const decision = (model = "media-fixture/paid") =>
  policy.enforceApiKeyModelPolicy(new Request("http://localhost/v1/images/generations"), model, secret);
const afterCacheTtl = () => vi.setSystemTime(new Date(Date.now() + 11_000));

describe("paid modality ledger and dollar budgets", () => {
  beforeEach(() => setup({ maxCostUsd: 1.25, monthlyBudget: 1.25 }));

  it.each(modalities)("$modality success persists attributed units; unknown differs from authoritative zero", async (spec) => {
    const paid = usage(spec, 0);
    const response = new Response("bytes", { status: 200 });
    expect(await policy.recordApiKeyUsageForResponse(secret, response, paid)).toBe(response);
    await policy.recordApiKeyUsageForResponse(secret, new Response(null), usage(spec, 1, { cost: 0 }));
    await policy.recordApiKeyUsageForResponse(secret, new Response(null),
      usage(spec, 2, { cost: null, costStatus: "unknown", costSource: "unavailable" }));
    const [first, zero, unknown] = rows();
    for (const row of [first, zero, unknown]) {
      expect(row).toMatchObject({ apiKey: secret, provider: "media-fixture", model: spec.model, connectionId: `account-${spec.modality}`, endpoint: spec.endpoint, status: "ok" });
      expect(JSON.parse(row.meta)).toMatchObject({ modality: spec.modality, nativeUnits: spec.nativeUnits });
    }
    expect(first.cost).toBe(0.25);
    expect(zero.cost).toBe(0);
    expect(JSON.parse(zero.meta)).toMatchObject({ costStatus: "known", costSource: "provider" });
    expect(unknown.cost).toBeNull();
    expect(JSON.parse(unknown.meta)).toMatchObject({ costStatus: "unknown", costSource: "unavailable" });
    expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ totalRequests: 3, totalCost: 0.25, unknownCostRequests: 1 });
  });

  it.each(modalities)("$modality failed upstream response spends nothing and stays allowed", async (spec) => {
    for (const status of [400, 429, 500, 503]) {
      await policy.recordApiKeyUsageForResponse(secret, new Response("nope", { status }), usage(spec, status));
    }
    expect(rows()).toEqual([]);
    expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ totalRequests: 0, totalCost: 0 });
    expect(await decision()).toBeNull();
  });

  it("denies only once committed paid spend reaches the lifetime and monthly limits", async () => {
    // Unknown and zero cost never move the dollar total.
    await policy.recordApiKeyUsageForResponse(secret, new Response(null),
      usage(modalities[0], 0, { cost: null, costStatus: "unknown", costSource: "unavailable" }));
    await policy.recordApiKeyUsageForResponse(secret, new Response(null), usage(modalities[1], 0, { cost: 0 }));
    afterCacheTtl();
    expect(await decision()).toBeNull();
    // 4 x 0.25 = 1.00 < 1.25: still allowed across image/stt/tts/embedding.
    for (const [index, spec] of modalities.slice(0, 4).entries()) {
      await policy.recordApiKeyUsageForResponse(secret, new Response(null), usage(spec, index + 10));
    }
    afterCacheTtl();
    expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ totalCost: 1, unknownCostRequests: 1 });
    expect(await decision()).toBeNull();
    // Rerank reaches exactly 1.25: boundary is inclusive for both limits.
    await policy.recordApiKeyUsageForResponse(secret, new Response(null), usage(modalities[4], 20));
    afterCacheTtl();
    const denied = await decision();
    expect(denied.status).toBe(429);
    // Windowed monthly budget is checked before the lifetime cost limit.
    expect((await denied.json()).error.message).toMatch(/budget limit reached \(\$1\.25\/\$1\.25\)/);
    // A duplicate event id is deduplicated and cannot push spend further.
    await policy.recordApiKeyUsageForResponse(secret, new Response(null), usage(modalities[4], 20));
    expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ totalCost: 1.25, totalRequests: 7 });
    // Other callers are unaffected by this key's spend.
    expect(await policy.enforceApiKeyModelPolicy(new Request("http://localhost/v1/rerank"), "media-fixture/paid", "sk-other")).toBeNull();
  });
});

describe("lifetime-only dollar limit", () => {
  beforeEach(() => setup({ maxCostUsd: 0.5 }));

  it("denies the next request at the boundary without any windowed limit configured", async () => {
    await policy.recordApiKeyUsageForResponse(secret, new Response(null), usage(modalities[0], 0));
    expect(await decision()).toBeNull();
    await policy.recordApiKeyUsageForResponse(secret, new Response(null), usage(modalities[3], 1));
    const denied = await decision();
    expect(denied.status).toBe(429);
    expect((await denied.json()).error.message).toMatch(/cost limit reached/);
  });
});
