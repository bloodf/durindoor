/**
 * PUT /api/keys/[id] contract for group assignment.
 *
 * The route must behave transactionally from the caller's point of view: a
 * rejected request changes NOTHING. Group membership lives in a separate table
 * from the key's scalar columns, so it would be easy to write the name, then
 * fail on a stale group id, and leave the operator with a 400 and a half-applied
 * update.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

const state = vi.hoisted(() => ({ db: null }));

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => ({
    all: (sql, params = []) => state.db.prepare(sql).all(...params),
    get: (sql, params = []) => state.db.prepare(sql).get(...params),
    run: (sql, params = []) => state.db.prepare(sql).run(...params),
    exec: (sql) => state.db.exec(sql),
    transaction: (fn) => state.db.transaction(fn)(),
  }),
}));

// The route pulls usage totals and provider scope from the same shim; stub the
// parts this contract does not exercise so the test stays about groups.
vi.mock("@/lib/localDb", async () => {
  const groups = await import("@/lib/db/repos/apiKeyGroupsRepo.js");
  const keys = await import("@/lib/db/repos/apiKeysRepo.js");
  return {
    ...groups,
    ...keys,
    getApiKeyUsageTotals: async () => ({ totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null }),
    getAllApiKeyUsageTotals: async () => [],
    getApiKeyProviderConnectionIds: async () => [],
    getProviderConnections: async () => [],
  };
});

const { PUT } = await import("@/app/api/keys/[id]/route.js");
const { GET } = await import("@/app/api/keys/route.js");
const { createApiKeyGroup, deleteApiKeyGroup, getGroupIdsForApiKey } = await import(
  "@/lib/db/repos/apiKeyGroupsRepo.js"
);

function request(body) {
  return new Request("http://localhost/api/keys/k1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "k1" });

beforeEach(() => {
  state.db = new Database(":memory:");
  state.db.exec("PRAGMA foreign_keys = ON");
  state.db.exec(`CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT, isActive INTEGER DEFAULT 1, allowedCombos TEXT, dailyLimitTokens INTEGER, policy TEXT, expiresAt TEXT, createdAt TEXT NOT NULL)`);
  state.db.exec(`CREATE TABLE apiKeyGroups (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
  state.db.exec(`CREATE TABLE apiKeyGroupMembers (groupId TEXT NOT NULL REFERENCES apiKeyGroups(id) ON DELETE CASCADE, apiKeyId TEXT NOT NULL REFERENCES apiKeys(id) ON DELETE CASCADE, createdAt TEXT NOT NULL, PRIMARY KEY (groupId, apiKeyId))`);
  state.db.prepare(`INSERT INTO apiKeys (id, key, name, isActive, allowedCombos, createdAt) VALUES ('k1','sk-1','ci-deploy',1,'[]','now')`).run();
});

afterEach(() => {
  state.db.close();
  vi.restoreAllMocks();
});

const storedName = () => state.db.prepare(`SELECT name FROM apiKeys WHERE id='k1'`).get().name;

describe("PUT /api/keys/[id] group assignment", () => {
  it("assigns groups and returns the persisted ids", async () => {
    const ci = await createApiKeyGroup({ name: "CI" });

    const response = await PUT(request({ groupIds: [ci.id] }), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.key.groupIds).toEqual([ci.id]);
  });

  it("rejects an unknown group id with 400 and leaves the name unchanged", async () => {
    const response = await PUT(
      request({ name: "should-not-persist", groupIds: ["missing"] }),
      { params },
    );

    expect(response.status).toBe(400);
    // The whole update must be discarded, not just the group half.
    expect(storedName()).toBe("ci-deploy");
  });

  it("rejects an unknown group id without clearing existing membership", async () => {
    const ci = await createApiKeyGroup({ name: "CI" });
    await PUT(request({ groupIds: [ci.id] }), { params });

    const response = await PUT(request({ groupIds: [ci.id, "missing"] }), { params });

    expect(response.status).toBe(400);
    expect(await getGroupIdsForApiKey("k1")).toEqual([ci.id]);
  });

  it("clears membership when given an empty array", async () => {
    const ci = await createApiKeyGroup({ name: "CI" });
    await PUT(request({ groupIds: [ci.id] }), { params });

    const response = await PUT(request({ groupIds: [] }), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.key.groupIds).toEqual([]);
  });

  it("leaves membership untouched when groupIds is absent from the body", async () => {
    const ci = await createApiKeyGroup({ name: "CI" });
    await PUT(request({ groupIds: [ci.id] }), { params });

    const response = await PUT(request({ name: "renamed" }), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.key.name).toBe("renamed");
    expect(body.key.groupIds).toEqual([ci.id]);
  });

  it("lists every group and each key's membership in one GET", async () => {
    // The page renders the filter bar from this one response: if the catalog
    // or a key's own ids were missing, the UI would silently show no groups.
    const ci = await createApiKeyGroup({ name: "CI" });
    await createApiKeyGroup({ name: "Staging" });
    await PUT(request({ groupIds: [ci.id] }), { params });

    const body = await (await GET()).json();

    expect(body.groups.map((group) => group.name).sort()).toEqual(["CI", "Staging"]);
    expect(body.keys.find((key) => key.id === "k1").groupIds).toEqual([ci.id]);
  });

  it("reports a key with no groups as an empty list, never undefined", async () => {
    await createApiKeyGroup({ name: "CI" });

    const body = await (await GET()).json();

    // The client filters on this array; undefined would throw on .includes.
    expect(body.keys.find((key) => key.id === "k1").groupIds).toEqual([]);
  });

  it("drops a deleted group from the catalog and from every key", async () => {
    const ci = await createApiKeyGroup({ name: "CI" });
    await PUT(request({ groupIds: [ci.id] }), { params });
    await deleteApiKeyGroup(ci.id);

    const body = await (await GET()).json();

    expect(body.groups).toEqual([]);
    expect(body.keys.find((key) => key.id === "k1").groupIds).toEqual([]);
    // The key itself survives its label being deleted.
    expect(body.keys.find((key) => key.id === "k1").name).toBe("ci-deploy");
  });
});
