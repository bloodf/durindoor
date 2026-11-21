import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// MLX and OpenCode Server catalogs belong to one endpoint each. These tests use
// a real temporary DB, synthetic credentials and a closed upstream: every
// discovery request is answered from `upstream`, nothing reaches a network.

const originalDataDir = process.env.DATA_DIR;
const upstream = vi.hoisted(() => ({ routes: new Map(), calls: [] }));

vi.mock("open-sse/utils/outboundUrlGuard.js", async (importOriginal) => ({
  ...(await importOriginal()),
  guardedProbeFetch: vi.fn(async (url) => {
    const target = String(url);
    upstream.calls.push(target);
    if (!upstream.routes.has(target)) throw new Error(`closed upstream: ${target}`);
    const body = upstream.routes.get(target);
    return { ok: true, status: 200, json: async () => body };
  })
}));
vi.mock("@/sse/services/tokenRefresh", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, creds) => creds),
  refreshGoogleToken: vi.fn(),
  updateProviderCredentials: vi.fn()
}));
vi.mock("@/lib/modelAutoSync/sharedMetadata.js", () => ({
  getSharedModelMetadata: vi.fn(async () => null),
  refreshSharedModelMetadata: vi.fn(async () => null)
}));

const MLX_A = "http://mlx-a.invalid:8080/v1";
const MLX_B = "http://mlx-b.invalid:8080/v1";
const OCS_A = "http://ocs-a.invalid:4096";
const OCS_B = "http://ocs-b.invalid:4096";

const mlxBody = (...ids) => ({ data: ids.map((id) => ({ id })) });
const ocsBody = (...ids) => ({ data: ids.map((id) => ({ id, providerID: "lab", name: id, enabled: true, type: "chat" })) });

function serve({ mlxA = ["mlx-a-only"], mlxB = ["mlx-b-only"], ocsA = ["ocs-a-only"], ocsB = ["ocs-b-only"] } = {}) {
  upstream.routes.clear();
  upstream.routes.set(`${MLX_A}/models`, mlxBody(...mlxA));
  upstream.routes.set(`${MLX_B}/models`, mlxBody(...mlxB));
  upstream.routes.set(`${OCS_A}/api/model`, ocsBody(...ocsA));
  upstream.routes.set(`${OCS_B}/api/model`, ocsBody(...ocsB));
}

let tempDir;
let ctx;

async function setup() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-connection-scoped-sync-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  const db = await import("@/lib/localDb");
  const runner = await import("../../src/lib/modelAutoSync/runner.js");
  const modelsRoute = await import("../../src/app/api/v1/models/route.js");
  const conn = (provider, name, baseUrl, apiKey, priority) =>
    db.createProviderConnection({ provider, authType: "apikey", name, apiKey, priority, providerSpecificData: { baseUrl } });
  const mlxA = await conn("mlx", "mlx-a", MLX_A, "", 1);
  const mlxB = await conn("mlx", "mlx-b", MLX_B, "", 2);
  const ocsA = await conn("opencode-server", "ocs-a", OCS_A, "user-a:synthetic-a", 1);
  const ocsB = await conn("opencode-server", "ocs-b", OCS_B, "user-b:synthetic-b", 2);
  await db.updateSettings({ modelAutoSyncProviders: { mlx: true, "opencode-server": true } });
  const keyFor = async (name, ids) => (await db.createApiKey(name, "machine-1", [], null, null, { providerConnectionIds: ids })).key;
  const keys = {
    a: await keyFor("scoped-a", [mlxA.id, ocsA.id]),
    b: await keyFor("scoped-b", [mlxB.id, ocsB.id]),
    ocsOnlyB: await keyFor("scoped-ocs-b", [ocsB.id]),
    all: await keyFor("unrestricted", [])
  };
  const listIds = async (key) => {
    const response = await modelsRoute.GET(new Request("http://localhost/v1/models", {
      headers: key ? { authorization: `Bearer ${key}` } : {}
    }));
    expect(response.status).toBe(200);
    return (await response.json()).data.map((m) => m.id);
  };
  const scoped = (ids) => ids.filter((id) => id.startsWith("mlx/") || id.startsWith("ocs/"));
  ctx = { db, runner, conns: { mlxA, mlxB, ocsA, ocsB }, keys, listIds, scoped };
}

// Each case builds a fresh DB and re-imports the route graph; the cold import
// alone can exceed the default 10s hook limit on a loaded machine.
const SETUP_TIMEOUT_MS = 90_000;

describe("connection-scoped MLX and OpenCode Server catalogs", { timeout: SETUP_TIMEOUT_MS }, () => {
  beforeEach(async () => {
    upstream.calls.length = 0;
    serve();
    await setup();
  }, SETUP_TIMEOUT_MS);
  afterEach(() => {
    vi.resetModules();
    delete global._dbAdapter;
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const syncBoth = async () => [
    await ctx.runner.syncProviderModels("mlx"),
    await ctx.runner.syncProviderModels("opencode-server")
  ];

  it("lists each key only its own connection's synced models", async () => {
    const results = await syncBoth();
    expect(results.map((r) => r.status)).toEqual(["synced", "synced"]);

    expect(ctx.scoped(await ctx.listIds(ctx.keys.b)).sort()).toEqual(["mlx/mlx-b-only", "ocs/lab/ocs-b-only"]);
    expect(ctx.scoped(await ctx.listIds(ctx.keys.a)).sort()).toEqual(["mlx/mlx-a-only", "ocs/lab/ocs-a-only"]);
  });

  it("shows unrestricted requests the first active connection's catalog, never another's", async () => {
    await syncBoth();
    const expected = ["mlx/mlx-a-only", "ocs/lab/ocs-a-only"];
    expect(ctx.scoped(await ctx.listIds(ctx.keys.all)).sort()).toEqual(expected);
    expect(ctx.scoped(await ctx.listIds(null)).sort()).toEqual(expected);
  });

  it("lists nothing for a provider the key holds no connection of", async () => {
    await syncBoth();
    expect(ctx.scoped(await ctx.listIds(ctx.keys.ocsOnlyB))).toEqual(["ocs/lab/ocs-b-only"]);
  });

  it("does not let concurrent requests of different scopes share one build", async () => {
    await syncBoth();
    const [forA, forB, forAll] = await Promise.all([
      ctx.listIds(ctx.keys.a), ctx.listIds(ctx.keys.b), ctx.listIds(ctx.keys.all)
    ]);
    expect(ctx.scoped(forA)).toContain("mlx/mlx-a-only");
    expect(ctx.scoped(forA)).not.toContain("mlx/mlx-b-only");
    expect(ctx.scoped(forB)).toContain("mlx/mlx-b-only");
    expect(ctx.scoped(forB)).not.toContain("mlx/mlx-a-only");
    expect(ctx.scoped(forAll)).toContain("mlx/mlx-a-only");
  });

  it("never publishes a provider-wide cache written before catalogs were scoped", async () => {
    const legacy = (connectionId, ids) => ({
      syncedAt: "2026-01-01T00:00:00.000Z", lastAttemptAt: "2026-01-01T00:00:00.000Z", error: null,
      newModelIds: [], removedModelIds: [], connectionId,
      models: ids.map((id) => ({ id, name: id, kind: "llm" }))
    });
    // One row names the connection that synced it, the other predates that field.
    await ctx.db.saveSyncedModelCatalog("mlx", legacy(ctx.conns.mlxA.id, ["legacy-mlx-a-secret"]));
    await ctx.db.saveSyncedModelCatalog("opencode-server", legacy(undefined, ["lab/legacy-ocs-a-secret"]));

    for (const key of [ctx.keys.b, ctx.keys.all, ctx.keys.ocsOnlyB]) {
      expect((await ctx.listIds(key)).join("\n")).not.toContain("legacy-");
    }
    // Discovery falls back to each connection's own live list.
    expect(ctx.scoped(await ctx.listIds(ctx.keys.b)).sort()).toEqual(["mlx/mlx-b-only", "ocs/lab/ocs-b-only"]);
    // Other readers of the store see no models in the stale row either.
    expect((await ctx.db.getSyncedModelCatalog("mlx")).models).toEqual([]);
    expect((await ctx.db.getSyncedModelCatalogs()).mlx.models).toEqual([]);
  });

  it("replaces a stale provider-wide row on the next sync and keeps the summary model-free", async () => {
    await ctx.db.saveSyncedModelCatalog("mlx", {
      syncedAt: "2026-01-01T00:00:00.000Z", lastAttemptAt: "2026-01-01T00:00:00.000Z", connectionId: ctx.conns.mlxA.id,
      models: [{ id: "legacy-mlx-a-secret", name: "x", kind: "llm" }]
    });
    await ctx.runner.syncProviderModels("mlx");
    const summary = await ctx.db.getSyncedModelCatalog("mlx");
    expect(summary).toMatchObject({ connectionScoped: true, error: null, models: [] });
    expect(JSON.stringify(summary)).not.toContain("legacy-mlx-a-secret");
    expect(JSON.stringify(summary)).not.toContain("mlx-a-only");
  });

  it("serves a refreshed catalog for the connection that changed", async () => {
    await syncBoth();
    serve({ mlxB: ["mlx-b-only", "mlx-b-new"], ocsB: ["ocs-b-new"] });
    await syncBoth();
    expect(ctx.scoped(await ctx.listIds(ctx.keys.b)).sort()).toEqual(["mlx/mlx-b-new", "mlx/mlx-b-only", "ocs/lab/ocs-b-new"]);
    expect(ctx.scoped(await ctx.listIds(ctx.keys.a)).sort()).toEqual(["mlx/mlx-a-only", "ocs/lab/ocs-a-only"]);
  });

  it("stops trusting a catalog once its connection points at another endpoint", async () => {
    await syncBoth();
    upstream.routes.set("http://mlx-c.invalid:8080/v1/models", mlxBody("mlx-c-live"));
    await ctx.db.updateProviderConnection(ctx.conns.mlxB.id, {
      providerSpecificData: { baseUrl: "http://mlx-c.invalid:8080/v1" }
    });
    const ids = await ctx.listIds(ctx.keys.b);
    expect(ids).not.toContain("mlx/mlx-b-only");
    expect(ids).toContain("mlx/mlx-c-live");
  });

  it("keeps a failed connection's previous catalog and does not touch the other connection", async () => {
    await syncBoth();
    upstream.routes.delete(`${MLX_B}/models`);
    const result = await ctx.runner.syncProviderModels("mlx");
    expect(result.status).toBe("synced");
    expect(ctx.scoped(await ctx.listIds(ctx.keys.b))).toContain("mlx/mlx-b-only");
    expect(ctx.scoped(await ctx.listIds(ctx.keys.a))).toContain("mlx/mlx-a-only");
  });

  it("reports failed when every connection fails", async () => {
    upstream.routes.clear();
    const result = await ctx.runner.syncProviderModels("mlx");
    expect(result.status).toBe("failed");
  });

  it("keeps provider-wide sync for providers whose catalog is not endpoint-bound", async () => {
    await ctx.db.createProviderConnection({ provider: "openai", authType: "apikey", name: "openai-1", apiKey: "sk-synthetic" });
    const fetchModels = async () => ({ models: [{ id: "gpt-scoped-check" }] });
    const result = await ctx.runner.syncProviderModels("openai", { fetchModels });
    expect(result.status).toBe("synced");
    const row = await ctx.db.getSyncedModelCatalog("openai");
    expect(row.models.map((m) => m.id)).toEqual(["gpt-scoped-check"]);
    expect(Object.keys(await ctx.db.getSyncedModelCatalogs()).sort()).toEqual(["openai"]);
  });

  it("schedules missing and changed catalogs despite recent legacy summaries, respecting Off and retry intervals", async () => {
    const now = Date.parse("2026-06-01T12:00:00Z");
    for (const provider of ["mlx", "opencode-server"]) {
      await ctx.db.saveSyncedModelCatalog(provider, {
        syncedAt: new Date(now).toISOString(), lastAttemptAt: new Date(now).toISOString(), models: []
      });
    }
    const fetchModels = vi.fn(async (connection) => ({ models: [{ id: `fixture-${connection.name}` }] }));
    await ctx.db.updateSettings({ modelAutoSyncIntervalHours: 0 });
    expect(await ctx.runner.runModelAutoSync({ now, fetchModels })).toEqual([]);
    expect(fetchModels).not.toHaveBeenCalled();
    await ctx.db.updateSettings({ modelAutoSyncIntervalHours: 24 });
    expect((await ctx.runner.runModelAutoSync({ now, fetchModels })).map((r) => r.status)).toEqual(["synced", "synced"]);
    expect(fetchModels).toHaveBeenCalledTimes(4);
    expect(await ctx.runner.runModelAutoSync({ now: now + 1000, fetchModels })).toEqual([]);
    await ctx.db.createProviderConnection({ provider: "mlx", authType: "apikey", name: "mlx-c", providerSpecificData: { baseUrl: "http://mlx-c.invalid/v1" } });
    expect((await ctx.runner.runModelAutoSync({ now: now + 2000, fetchModels })).map((r) => r.providerId)).toEqual(["mlx"]);
    await ctx.db.updateProviderConnection(ctx.conns.ocsB.id, { providerSpecificData: { baseUrl: "http://ocs-new.invalid" } });
    expect((await ctx.runner.runModelAutoSync({ now: now + 3000, fetchModels })).map((r) => r.providerId)).toEqual(["opencode-server"]);
  });

  it("reports per-connection status on the dashboard route", async () => {
    await syncBoth();
    const { GET } = await import("../../src/app/api/models/auto-sync/route.js");
    const body = await (await GET(new Request("http://localhost/api/models/auto-sync?provider=mlx"))).json();
    const status = body.providers.mlx;
    expect(status).toMatchObject({ connectionScoped: true, models: null });
    const byId = Object.fromEntries(status.connections.map((c) => [c.connectionId, c.models.map((m) => m.id)]));
    expect(byId).toEqual({ [ctx.conns.mlxA.id]: ["mlx-a-only"], [ctx.conns.mlxB.id]: ["mlx-b-only"] });
  });
});
