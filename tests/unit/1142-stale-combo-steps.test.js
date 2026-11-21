import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

// #1142: stale combo-step badge, opt-in auto-prune with prunedSteps, restore.
// Real temporary SQLite, real repos, real routes and the real dashboard guard;
// only the provider HTTP fetch (injected fetchModels) is replaced.

const require = createRequire(import.meta.url);
const { createOwnerAwareHandler } = require("../../custom-server.js");
const NOW = Date.parse("2026-11-21T12:00:00Z");
const params = (id) => ({ params: Promise.resolve({ id }) });

let tempDir;
let originalDataDir;
let db;
let runner;
let staleRoute;
let restoreRoute;

const listing = (...ids) => async () => ({ models: ids.map((id) => ({ id })) });
const failing = async () => ({ error: "boom", status: 500 });
const empty = async () => ({ models: [] });

async function seedConnection() {
  const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  const now = "2026-11-21T00:00:00.000Z";
  adapter.run(
    `INSERT INTO providerConnections(id, provider, authType, name, priority, isActive, data, createdAt, updatedAt)
     VALUES('conn-openai', 'openai', 'apikey', 'openai', 1, 1, ?, ?, ?)`,
    [JSON.stringify({ apiKey: "sk-test" }), now, now]
  );
}

/** Establish a successful catalog, then re-sync with `fetchModels`. */
async function syncWith(fetchModels, options = {}) {
  return runner.runModelAutoSync({ providerIds: ["openai"], force: true, now: NOW, fetchModels, ...options });
}

async function combo(models, name = "stale-test") {
  return db.createCombo({ name, models });
}

beforeEach(async () => {
  originalDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-stale-combo-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  vi.doMock("../../src/lib/modelAutoSync/sharedMetadata.js", () => ({ refreshSharedModelMetadata: vi.fn(async () => null) }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  db = await import("../../src/lib/db/index.js");
  await db.initDb();
  runner = await import("../../src/lib/modelAutoSync/runner.js");
  staleRoute = await import("../../src/app/api/combos/[id]/stale-steps/route.js");
  restoreRoute = await import("../../src/app/api/combos/[id]/restore/route.js");
  await seedConnection();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.doUnmock("../../src/lib/modelAutoSync/sharedMetadata.js");
  await disposeLoadedRequestDetailsRepo();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function staleSteps(id) {
  const res = await staleRoute.GET(new Request(`http://localhost/api/combos/${id}/stale-steps`), params(id));
  return { status: res.status, ...(await res.json()) };
}

describe("setting", () => {
  it("defaults to false and validates as a boolean", async () => {
    expect((await db.getSettings()).autoPruneStaleComboSteps).toBe(false);
    const { validateModelAutoSyncSettingsPatch } = await import("../../src/lib/modelAutoSync/catalog.js");
    expect(validateModelAutoSyncSettingsPatch({ autoPruneStaleComboSteps: true })).toBeNull();
    expect(validateModelAutoSyncSettingsPatch({ autoPruneStaleComboSteps: "yes" })).toBe("Invalid autoPruneStaleComboSteps");
  });
});

describe("stale badge data", () => {
  it("marks steps missing from the latest successful sync", async () => {
    const c = await combo(["openai/gpt-keep", "openai/gpt-gone", "other-provider/x"]);
    await syncWith(listing("gpt-keep", "gpt-new"));
    const result = await staleSteps(c.id);
    expect(result.staleSteps).toEqual([{ step: 1, model: "openai/gpt-gone", provider: "openai" }]);
  });

  it("shows no badge for a provider with no successful sync", async () => {
    const c = await combo(["openai/gpt-gone", "openai/gpt-keep"]);
    expect((await staleSteps(c.id)).staleSteps).toEqual([]);
    await syncWith(failing);
    expect((await staleSteps(c.id)).staleSteps).toEqual([]);
  });

  it("keeps the badge from the last successful sync when a later sync fails", async () => {
    const c = await combo(["openai/gpt-gone", "openai/gpt-keep"]);
    await syncWith(listing("gpt-keep"));
    await syncWith(failing);
    expect((await staleSteps(c.id)).staleSteps.map((s) => s.model)).toEqual(["openai/gpt-gone"]);
  });

  it("returns 404 for an unknown combo", async () => {
    expect((await staleSteps("missing")).status).toBe(404);
  });
});

describe("auto-prune", () => {
  it("prunes nothing without the opt-in", async () => {
    const c = await combo(["openai/gpt-keep", "openai/gpt-gone"]);
    await syncWith(listing("gpt-keep"));
    const after = await db.getComboById(c.id);
    expect(after.models).toEqual(["openai/gpt-keep", "openai/gpt-gone"]);
    expect(after.prunedSteps).toEqual([]);
  });

  it("prunes stale steps into prunedSteps after a successful sync when opted in", async () => {
    await db.updateSettings({ autoPruneStaleComboSteps: true });
    const c = await combo(["openai/gpt-keep", "openai/gpt-gone", "other/x"]);
    await syncWith(listing("gpt-keep"));
    const after = await db.getComboById(c.id);
    expect(after.models).toEqual(["openai/gpt-keep", "other/x"]);
    expect(after.members.map((m) => m.id)).toEqual(after.models);
    expect(after.prunedSteps).toHaveLength(1);
    expect(after.prunedSteps[0]).toMatchObject({ step: 1, model: "openai/gpt-gone", provider: "openai" });
    expect(after.prunedSteps[0].prunedAt).toBe(new Date(NOW).toISOString());
    expect(after.prunedSteps[0].reason).toBeTruthy();
    expect((await db.getCombos())[0].prunedSteps).toHaveLength(1);
  });

  it("does not prune on a failed or empty sync", async () => {
    await db.updateSettings({ autoPruneStaleComboSteps: true });
    const c = await combo(["openai/gpt-keep", "openai/gpt-gone"]);
    await syncWith(listing("gpt-keep", "gpt-gone"));
    // Later syncs fail or come back empty: previous catalog stays, nothing is pruned.
    await syncWith(failing);
    await syncWith(empty);
    const after = await db.getComboById(c.id);
    expect(after.models).toEqual(["openai/gpt-keep", "openai/gpt-gone"]);
    expect(after.prunedSteps).toEqual([]);
  });

  it("does not prune when the provider never synced", async () => {
    await db.updateSettings({ autoPruneStaleComboSteps: true });
    const c = await combo(["openai/gpt-gone", "openai/gpt-keep"]);
    await syncWith(failing);
    expect((await db.getComboById(c.id)).models).toEqual(["openai/gpt-gone", "openai/gpt-keep"]);
  });

  it("never leaves a combo with zero steps", async () => {
    await db.updateSettings({ autoPruneStaleComboSteps: true });
    const c = await combo(["openai/gone-a", "openai/gone-b"]);
    await syncWith(listing("gpt-keep"));
    const after = await db.getComboById(c.id);
    expect(after.models).toEqual(["openai/gone-a", "openai/gone-b"]);
    expect(after.prunedSteps).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("not pruned"));
  });

  it("keeps prunedSteps when the combo is edited and drops them when it is deleted", async () => {
    await db.updateSettings({ autoPruneStaleComboSteps: true });
    const c = await combo(["openai/gpt-keep", "openai/gpt-gone"]);
    await syncWith(listing("gpt-keep"));
    const edited = await db.updateCombo(c.id, { name: "renamed" });
    expect(edited.prunedSteps).toHaveLength(1);
    await db.deleteCombo(c.id);
    expect(await db.getComboById(c.id)).toBeNull();
    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    expect(adapter.get(`SELECT 1 AS n FROM kv WHERE scope = 'comboPrunedSteps' AND key = ?`, [c.id])).toBeFalsy();
  });
});

describe("restore", () => {
  async function pruned() {
    await db.updateSettings({ autoPruneStaleComboSteps: true });
    const c = await db.createCombo({ name: "restore-me", models: ["openai/a", "openai/gone-1", "openai/b", "openai/gone-2"] });
    await syncWith(listing("a", "b"));
    return c;
  }
  const post = (id, body) => restoreRoute.POST(new Request(`http://localhost/api/combos/${id}/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), params(id));

  it("restores every pruned step at its original position", async () => {
    const c = await pruned();
    expect((await db.getComboById(c.id)).models).toEqual(["openai/a", "openai/b"]);
    const res = await post(c.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.restored.map((r) => r.model)).toEqual(["openai/gone-1", "openai/gone-2"]);
    const after = await db.getComboById(c.id);
    expect(after.models).toEqual(["openai/a", "openai/gone-1", "openai/b", "openai/gone-2"]);
    expect(after.members.map((m) => m.id)).toEqual(after.models);
    expect(after.prunedSteps).toEqual([]);
  });

  it("restores only the named models", async () => {
    const c = await pruned();
    const res = await post(c.id, { models: ["openai/gone-2"] });
    expect(res.status).toBe(200);
    const after = await db.getComboById(c.id);
    expect(after.models).toEqual(["openai/a", "openai/b", "openai/gone-2"]);
    expect(after.prunedSteps.map((s) => s.model)).toEqual(["openai/gone-1"]);
  });

  it("does not add a step twice when it is already on the combo", async () => {
    const c = await pruned();
    await db.updateCombo(c.id, { models: ["openai/a", "openai/b", "openai/gone-1"] });
    await post(c.id);
    const after = await db.getComboById(c.id);
    expect(after.models.filter((m) => m === "openai/gone-1")).toHaveLength(1);
    expect(after.prunedSteps).toEqual([]);
  });

  it("rejects a malformed models list and an unknown combo", async () => {
    const c = await pruned();
    expect((await post(c.id, { models: "openai/a" })).status).toBe(400);
    expect((await post("missing")).status).toBe(404);
  });
});

/**
 * Authorization: the restore and stale-steps routes live under /api/combos, a
 * management prefix, so they get the same guard as combo edits. The guard is
 * the real `proxy`, never mocked.
 */
describe("dashboard-guard coverage of the restore path", () => {
  let proxy;
  beforeEach(async () => {
    const id = await import("@/shared/utils/machineId");
    const original = id.getConsistentMachineId;
    vi.spyOn(id, "getConsistentMachineId").mockImplementation(async (salt) =>
      salt === "9r-cli-auth" ? "machine-cli" : await original(salt));
    ({ proxy } = await import("../../src/dashboardGuard.js"));
    await db.updateSettings({ requireLogin: true });
  });

  const guardReq = (pathname, headers = {}) => ({
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers(headers),
    method: "POST",
    cookies: { get: vi.fn() },
    url: `http://localhost${pathname}`
  });

  async function remoteHeaders(pathname) {
    return new Promise((resolve) => {
      createOwnerAwareHandler((request) => resolve(new Headers(request.headers)), {
        secret: "a".repeat(64),
        peerToken: "stale-steps-peer",
        verifyPeerOwner: vi.fn(async () => false)
      })({
        method: "POST",
        url: pathname,
        headers: { host: "router.example.com" },
        socket: { remoteAddress: "203.0.113.10", remotePort: 45000 }
      }, { setHeader: vi.fn() });
    });
  }

  for (const suffix of ["restore", "stale-steps"]) {
    it(`rejects an unauthenticated remote caller on /api/combos/{id}/${suffix}`, async () => {
      const pathname = `/api/combos/c1/${suffix}`;
      const res = await proxy(guardReq(pathname, await remoteHeaders(pathname)));
      expect(res.status).toBe(401);
    });

    it(`accepts the machine-bound CLI token on /api/combos/{id}/${suffix}`, async () => {
      const res = await proxy(guardReq(`/api/combos/c1/${suffix}`, { host: "router.example.com", "x-9r-cli-token": "machine-cli" }));
      expect(res.status).not.toBe(401);
    });
  }

  it("matches the guard decision for a plain combo edit", async () => {
    const pathname = "/api/combos/c1";
    const res = await proxy(guardReq(pathname, await remoteHeaders(pathname)));
    expect(res.status).toBe(401);
  });
});
