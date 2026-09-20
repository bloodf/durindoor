import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: async (id) => ({ id, provider: "opencode", authType: "apikey" }) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}) }));
vi.mock("@/shared/constants/providers", async (importOriginal) => ({
  ...await importOriginal(), USAGE_APIKEY_PROVIDERS: ["opencode"],
}));
vi.mock("@/lib/oauth/services/cursorLocalStore.js", () => ({ backfillCursorConnectionIdentity: async (c) => c }));
vi.mock("@/shared/services/providerCredentials", () => ({ refreshAndUpdateCredentials: vi.fn() }));
vi.mock("open-sse/services/usage.js", () => ({ getUsageForProvider: vi.fn() }));
vi.mock("open-sse/services/usage/grok-cli.js", () => ({ fetchGrokCliCreditsConfig: vi.fn() }));

let dir, oldDir, db, history, monitoring, connection;
beforeEach(async () => {
  oldDir = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql365-routes-"));
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;
  vi.resetModules();
  await import("@/lib/db/index.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  history = (await import("../../src/app/api/usage/history/route.js")).GET;
  monitoring = (await import("../../src/app/api/monitoring/route.js")).GET;
  connection = (await import("../../src/app/api/usage/[connectionId]/route.js")).GET;
});
afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (oldDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

function seed(count, provider = "opencode", connectionId = "target") {
  const timestamp = new Date(Date.now() - 60000).toISOString();
  db.transaction(() => {
    for (let i = 0; i < count; i++) db.run(`INSERT INTO usageHistory
      (timestamp, provider, model, connectionId, promptTokens, completionTokens, cachedTokens, cost, status, tokens)
      VALUES (?, ?, 'model', ?, 10, 5, 2, 0.25, ?, ?)`,
      [timestamp, provider, connectionId, i % 4 === 0 ? "error" : "ok", JSON.stringify({ prompt_tokens: 10, completion_tokens: 5, cached_tokens: 2 })]);
  });
}
const request = (query = "") => new Request(`http://localhost/api/usage/history${query}`);

describe("SQL-backed dashboard endpoints", () => {
  it("history stays bounded as history grows, honours offset and returns the approved page shape", async () => {
    seed(60);
    const small = await (await history(request())).json();
    expect(Object.keys(small).sort()).toEqual(["limit", "offset", "rows", "total"]);
    expect(small.rows).toHaveLength(50);
    expect(small.total).toBe(60);
    seed(2000);
    const large = await (await history(request())).json();
    expect(large.rows).toHaveLength(small.rows.length);
    expect(large.total).toBe(2060);
    const first = await (await history(request("?limit=10"))).json();
    const next = await (await history(request("?limit=5&offset=5"))).json();
    expect(next.rows).toEqual(first.rows.slice(5));
    expect(next).toMatchObject({ limit: 5, offset: 5, total: 2060 });
    const capped = await (await history(request("?limit=9999&offset=9999999999"))).json();
    expect(capped).toMatchObject({ limit: 200, offset: 2147483647, rows: [] });
    expect((await (await history(request("?limit=9999"))).json()).rows).toHaveLength(200);
  });

  it("history rejects invalid pagination and dates before querying", async () => {
    for (const query of ["limit=0", "limit=-1", "limit=1.5", "limit=abc", "limit=", "offset=-1", "offset=Infinity", "offset=9007199254740992", "startDate=nope", "startDate=1", "startDate=2026-02-30", "startDate=2026-02-02&endDate=2026-01-01"]) {
      expect((await history(request(`?${query}`))).status, query).toBe(400);
    }
    seed(8);
    seed(12, "other");
    const filtered = await (await history(request("?provider=opencode&model=model&connectionId=target&status=error&limit=1"))).json();
    expect(filtered.total).toBe(2);
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0]).toMatchObject({ provider: "opencode", model: "model", status: "error" });
  });

  it("monitoring preserves totals/status semantics and bounded provider/log rows as the dataset grows", async () => {
    for (let i = 0; i < 60; i++) seed(4, `provider-${i}`);
    const small = await (await monitoring()).json();
    expect(Object.keys(small).sort()).toEqual(["activity", "generatedAt", "health", "latencyMs", "ok", "runtime", "version"]);
    expect(small.activity.today).toEqual({ requests: 240, promptTokens: 2400, completionTokens: 1200, cachedTokens: 480, cost: 60, providers: 60, models: 60 });
    expect(small.activity.successRate).toBe(75);
    expect(small.health).toHaveLength(50);
    expect(small.activity.recent).toHaveLength(20);
    expect(small.health[0]).toMatchObject({ requests: 4, errors: 1, successRate: 75, cost: 1 });
    for (let i = 0; i < 60; i++) seed(40, `provider-${i}`);
    const large = await (await monitoring()).json();
    expect(large.health).toHaveLength(small.health.length);
    expect(large.activity.recent).toHaveLength(small.activity.recent.length);
    expect(large.activity.today.requests).toBe(2640);
    expect(large.activity.successRate).toBe(75);
    expect(large.activity.recent[0]).toMatchObject({ model: "model", promptTokens: "10", completionTokens: "5" });
  });

  it("local connection quotas aggregate only that connection without growing output per request", async () => {
    const get = () => connection(new Request("http://localhost/api/usage/target"), { params: Promise.resolve({ connectionId: "target" }) });
    expect(await (await get()).json()).toMatchObject({ quotas: {}, message: expect.any(String) });
    seed(4); seed(40, "opencode", "other");
    const small = await (await get()).json();
    expect(small).toMatchObject({ plan: "OpenCode", displayMessage: "OpenCode connected. 4 requests in the last 30 days." });
    expect(small.quotas["Total spend (30d)"].used).toBe(1);
    expect(small.quotas["Total tokens (30d)"].used).toBe(60);
    seed(2000);
    const large = await (await get()).json();
    expect(Object.keys(large.quotas)).toEqual(Object.keys(small.quotas));
    expect(large.quotas["model (30d)"].used).toBe(30060);
    expect(large.quotas["Total spend (30d)"]).toMatchObject({ used: 501, unit: "usd", unlimited: true, remaining: 100 });
  });

  it("monitoring keeps its empty and unavailable-data responses usable", async () => {
    const empty = await (await monitoring()).json();
    expect(empty.activity.successRate).toBeNull();
    expect(empty.health).toEqual([]);
    expect(empty.runtime.activeRequests).toBe(0);
    db.run("DROP TABLE usageHistory");
    const unavailable = await (await monitoring()).json();
    expect(unavailable.ok).toBe(true);
    expect(unavailable.activity).toEqual({ today: null, successRate: null, recent: [] });
    expect(unavailable.health).toEqual([]);
  });
});
