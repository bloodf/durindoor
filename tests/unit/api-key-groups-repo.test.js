/**
 * Repository behavior for API-key groups, against a real SQLite database.
 *
 * The important guard here is `setApiKeyGroups`: it DELETEs the existing
 * membership before inserting, so an id it cannot honor must raise rather than
 * be skipped. Skipping would turn a typo — or a stale tab whose group was
 * deleted elsewhere — into unannounced data loss: the operator asks for two
 * groups, gets one, and sees no error.
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
    // Mirrors better-sqlite3's synchronous transaction wrapper: a throw inside
    // the callback rolls the whole unit back.
    transaction: (fn) => state.db.transaction(fn)(),
  }),
}));

const {
  createApiKeyGroup,
  deleteApiKeyGroup,
  getApiKeyGroups,
  getGroupIdsByApiKey,
  getGroupIdsForApiKey,
  setApiKeyGroups,
  updateApiKeyGroup,
} = await import("@/lib/db/repos/apiKeyGroupsRepo.js");

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

describe("group CRUD", () => {
  it("creates a group and lists it by name", async () => {
    await createApiKeyGroup({ name: "  CI  ", description: "  build keys  " });
    const groups = await getApiKeyGroups();
    // Whitespace is trimmed so " CI " and "CI" cannot coexist as lookalikes.
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ name: "CI", description: "build keys" });
  });

  it("rejects a blank name instead of creating an unlabeled group", async () => {
    await expect(createApiKeyGroup({ name: "   " })).rejects.toThrow(/name is required/i);
    await expect(createApiKeyGroup({})).rejects.toThrow(/name is required/i);
  });

  it("stores an omitted description as null rather than an empty string", async () => {
    const group = await createApiKeyGroup({ name: "Personal" });
    expect(group.description).toBeNull();
  });

  it("updates only the fields supplied", async () => {
    const group = await createApiKeyGroup({ name: "CI", description: "build" });
    const updated = await updateApiKeyGroup(group.id, { description: "release" });
    expect(updated).toMatchObject({ name: "CI", description: "release" });
  });

  it("returns null when updating or deleting a group that does not exist", async () => {
    expect(await updateApiKeyGroup("missing", { name: "x" })).toBeNull();
    expect(await deleteApiKeyGroup("missing")).toBe(false);
  });
});

describe("membership", () => {
  it("assigns a key to several groups and reads them back in name order", async () => {
    const staging = await createApiKeyGroup({ name: "Staging" });
    const ci = await createApiKeyGroup({ name: "CI" });

    await setApiKeyGroups("k1", [staging.id, ci.id]);

    // Ordered by group name, so the UI renders CI before Staging.
    expect(await getGroupIdsForApiKey("k1")).toEqual([ci.id, staging.id]);
  });

  it("replaces membership rather than appending to it", async () => {
    const ci = await createApiKeyGroup({ name: "CI" });
    const staging = await createApiKeyGroup({ name: "Staging" });

    await setApiKeyGroups("k1", [ci.id]);
    await setApiKeyGroups("k1", [staging.id]);

    expect(await getGroupIdsForApiKey("k1")).toEqual([staging.id]);
  });

  it("clears membership when given an empty list", async () => {
    const ci = await createApiKeyGroup({ name: "CI" });
    await setApiKeyGroups("k1", [ci.id]);
    await setApiKeyGroups("k1", []);
    expect(await getGroupIdsForApiKey("k1")).toEqual([]);
  });

  it("collapses duplicate ids instead of failing on the primary key", async () => {
    const ci = await createApiKeyGroup({ name: "CI" });
    await expect(setApiKeyGroups("k1", [ci.id, ci.id])).resolves.toEqual([ci.id]);
  });

  it("REJECTS an unknown group id and leaves existing membership untouched", async () => {
    const ci = await createApiKeyGroup({ name: "CI" });
    await setApiKeyGroups("k1", [ci.id]);

    await expect(setApiKeyGroups("k1", [ci.id, "deleted-elsewhere"])).rejects.toThrow(
      /unknown group id/i,
    );
    // The pre-existing assignment must survive the rejected write.
    expect(await getGroupIdsForApiKey("k1")).toEqual([ci.id]);
  });

  it("rejects malformed ids", async () => {
    await expect(setApiKeyGroups("k1", [""])).rejects.toThrow(/array of group id strings/i);
    await expect(setApiKeyGroups("k1", [42])).rejects.toThrow(/array of group id strings/i);
    await expect(setApiKeyGroups("k1", "not-an-array")).rejects.toThrow(/array of group id strings/i);
  });

  it("indexes membership by key for a single-query list view", async () => {
    const ci = await createApiKeyGroup({ name: "CI" });
    state.db.prepare(`INSERT INTO apiKeys (id, key, name, isActive, allowedCombos, createdAt) VALUES ('k2','sk-2','other',1,'[]','now')`).run();
    await setApiKeyGroups("k1", [ci.id]);
    const byKey = await getGroupIdsByApiKey();
    expect(byKey.k1).toEqual([ci.id]);
    expect(byKey.k2).toBeUndefined();
  });

  it("rejects assigning groups to a key that does not exist", async () => {
    const ci = await createApiKeyGroup({ name: "CI" });
    await expect(setApiKeyGroups("no-such-key", [ci.id])).rejects.toThrow(/API key not found/i);
  });

  it("rolls back the whole replacement when an insert fails partway", async () => {
    const ci = await createApiKeyGroup({ name: "CI" });
    const staging = await createApiKeyGroup({ name: "Staging" });
    await setApiKeyGroups("k1", [ci.id]);

    // Fail the first membership INSERT so it throws after the DELETE has run.
    // Without a transaction the key would be left with NO groups at all.
    const original = state.db.prepare.bind(state.db);
    let calls = 0;
    state.db.prepare = (sql) => {
      if (sql.includes("INSERT OR IGNORE INTO apiKeyGroupMembers") && calls++ === 0) {
        throw new Error("simulated write failure");
      }
      return original(sql);
    };

    await expect(setApiKeyGroups("k1", [staging.id])).rejects.toThrow(/simulated write failure/);
    state.db.prepare = original;

    // The prior assignment survives: no silent membership wipe.
    expect(await getGroupIdsForApiKey("k1")).toEqual([ci.id]);
  });
});

describe("atomic key + group updates", () => {
  it("commits the scalar edit and the membership change together", async () => {
    const { updateApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const ci = await createApiKeyGroup({ name: "CI" });

    const updated = await updateApiKey("k1", { name: "renamed", groupIds: [ci.id] });

    expect(updated.name).toBe("renamed");
    expect(await getGroupIdsForApiKey("k1")).toEqual([ci.id]);
  });

  it("rolls the scalar edit back when the group id is unknown", async () => {
    const { updateApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const ci = await createApiKeyGroup({ name: "CI" });
    await updateApiKey("k1", { groupIds: [ci.id] });

    await expect(
      updateApiKey("k1", { name: "should-not-persist", groupIds: ["missing"] }),
    ).rejects.toThrow(/unknown group id/i);

    // Neither half of the update may survive: the name stays, the groups stay.
    const row = state.db.prepare(`SELECT name FROM apiKeys WHERE id='k1'`).get();
    expect(row.name).toBe("ci-deploy");
    expect(await getGroupIdsForApiKey("k1")).toEqual([ci.id]);
  });
});
