// Regression for /api/usage/providers OOM: listing distinct providers must read
// only the `provider` column, never parse every row's JSON `data` blob.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getDistinctProviders (OOM-safe)", () => {
  it("repo selects DISTINCT provider only (no `data` blob), sorted, non-null", async () => {
    const queries = [];
    const fakeAdapter = {
      all: vi.fn((sql) => {
        queries.push(sql);
        // Simulate already-sorted/unique/non-null rows from SQL.
        return [{ provider: "anthropic" }, { provider: "azure" }, { provider: "openai" }];
      }),
    };
    vi.doMock("@/lib/db/driver.js", () => ({ getAdapter: async () => fakeAdapter }));

    const { getDistinctProviders } = await import("@/lib/db/repos/requestDetailsRepo.js");
    const result = await getDistinctProviders();

    expect(result).toEqual(["anthropic", "azure", "openai"]);
    expect(fakeAdapter.all).toHaveBeenCalledTimes(1);
    const sql = queries[0];
    expect(sql).toMatch(/DISTINCT\s+provider/i);
    expect(sql).toMatch(/provider IS NOT NULL/i);
    expect(sql).toMatch(/ORDER BY\s+provider\s+ASC/i);
    expect(sql).not.toMatch(/\bdata\b/); // must NOT select the JSON blob column
  });

  it("providers route responds from getDistinctProviders (behavioral)", async () => {
    const getDistinctProviders = vi.fn(async () => ["anthropic", "openai"]);
    vi.doMock("@/lib/requestDetailsDb", () => ({ getDistinctProviders }));
    vi.doMock("@/lib/localDb", () => ({ getProviderNodes: async () => [] }));
    vi.doMock("@/shared/constants/providers", () => ({
      AI_PROVIDERS: {},
      getProviderByAlias: () => null,
    }));

    const { GET } = await import("@/app/api/usage/providers/route.js");
    const res = await GET();
    const body = await res.json();

    expect(getDistinctProviders).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(body.providers.map((p) => p.id).sort()).toEqual(["anthropic", "openai"]);
  });
});
