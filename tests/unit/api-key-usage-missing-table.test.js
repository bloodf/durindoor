import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalDataDir = process.env.DATA_DIR;
let originalAdapter;
let tempDir;
let db;
let totalsSchema;

beforeEach(async () => {
  originalAdapter = global._dbAdapter;
  tempDir = mkdtempSync(join(tmpdir(), "api-key-usage-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  db.run("INSERT INTO apiKeys(id, key, name, createdAt) VALUES(?, ?, ?, ?)",
    ["key-1", "secret-key", "Test key", "2026-01-01T00:00:00.000Z"]);
  totalsSchema = db.get("SELECT sql FROM sqlite_master WHERE name = 'apiKeyUsageTotals'").sql;
  db.exec("DROP TABLE apiKeyUsageTotals");
});

afterEach(() => {
  db?.close();
  if (originalAdapter === undefined) delete global._dbAdapter;
  else global._dbAdapter = originalAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("missing API-key usage totals table", () => {
  it("keeps read-side defaults explicit about unknown costs", async () => {
    const { getApiKeyUsageTotals, getAllApiKeyUsageTotals } = await import("@/lib/db/repos/apiKeyUsageTotalsRepo.js");
    expect(await getApiKeyUsageTotals("key-1")).toEqual({
      totalTokens: 0, totalCost: 0, totalRequests: 0, unknownCostRequests: 0, updatedAt: null,
    });
    expect(await getAllApiKeyUsageTotals()).toEqual([]);
  });

  it("throws when a totals increment cannot be persisted", async () => {
    const { incrementApiKeyUsageSync } = await import("@/lib/db/repos/apiKeyUsageTotalsRepo.js");
    expect(() => incrementApiKeyUsageSync(db, "key-1", { tokens: 10, cost: 0.001 }))
      .toThrow(/no such table: apiKeyUsageTotals/);
  });

  it.each([
    { cost: 0.001, costStatus: "known", costSource: "provider", unknownCostRequests: 0 },
    { cost: null, costStatus: "unknown", costSource: "unavailable", unknownCostRequests: 1 },
  ])("rolls back all accounting for $costStatus cost and permits retry after repair", async ({ unknownCostRequests, ...pricing }) => {
    const { recordApiKeyUsage } = await import("@/sse/services/apiKeyPolicy.js");
    const event = {
      usageEventId: "missing-totals-event",
      timestamp: "2026-01-02T12:00:00.000Z",
      provider: "openai",
      model: "text-embedding-3-small",
      endpoint: "/v1/embeddings",
      connectionId: "connection-1",
      modality: "embedding",
      tokens: { prompt_tokens: 10, completion_tokens: 0 },
      nativeUnits: {},
      ...pricing,
    };
    const snapshot = () => ({
      history: db.all("SELECT * FROM usageHistory"),
      daily: db.all("SELECT * FROM usageDaily"),
      lastSeen: db.all("SELECT * FROM usageLastSeen"),
      receipts: db.all("SELECT * FROM kv WHERE scope = 'usageEventReceipts'"),
      lifetime: db.get("SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'"),
    });
    const before = snapshot();
    await expect(recordApiKeyUsage("secret-key", event)).rejects.toMatchObject({
      code: "USAGE_ACCOUNTING_FAILED",
      cause: expect.objectContaining({ message: expect.stringMatching(/no such table: apiKeyUsageTotals/) }),
    });
    expect(snapshot()).toEqual(before);

    // A failed transaction must not consume the event's idempotency receipt.
    db.exec(totalsSchema);
    await recordApiKeyUsage("secret-key", event);
    await recordApiKeyUsage("secret-key", event);
    expect(db.get("SELECT totalTokens, totalCost, totalRequests, unknownCostRequests FROM apiKeyUsageTotals WHERE apiKeyId = ?", ["key-1"]))
      .toEqual({ totalTokens: 10, totalCost: pricing.cost ?? 0, totalRequests: 1, unknownCostRequests });
    const rows = db.all("SELECT cost, meta FROM usageHistory WHERE usageEventId = ?", [event.usageEventId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cost).toBe(pricing.cost);
    expect(JSON.parse(rows[0].meta)).toMatchObject({
      costStatus: pricing.costStatus, costSource: pricing.costSource, modality: event.modality, nativeUnits: {},
    });
  });
});
