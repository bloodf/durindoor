// Port decolua/9router#2558: reorder-by-availability sort + atomic bulk persist.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { sortConnectionsByAvailability } from "@/shared/utils/connectionReorder";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-reorder-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function freshDb() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  return getAdapter();
}

async function freshRepo() {
  return import("@/lib/db/repos/connectionsRepo.js");
}

async function seedProviderWithPriorities(db, provider, ids) {
  for (const [i, id] of ids.entries()) {
    db.run(
      `INSERT INTO providerConnections (id, provider, name, priority, isActive, authType, data, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 1, 'api_key', '{}', ?, ?)`,
      [id, provider, id, i + 1, new Date().toISOString(), new Date().toISOString()],
    );
  }
}

async function prioritiesOf(db, provider) {
  return db
    .all(`SELECT id, priority FROM providerConnections WHERE provider = ? ORDER BY priority`, [provider])
    .map((r) => r.id);
}

describe("sortConnectionsByAvailability (port 9router#2558)", () => {
  it("partitions available-first, stable within groups", () => {
    const now = Date.now();
    const conns = [
      { id: "a", testStatus: "error" },
      { id: "b", testStatus: "active" },
      { id: "c", testStatus: "unavailable", modelLock_gpt: new Date(now - 1000).toISOString() }, // expired cooldown
      { id: "d", testStatus: "success" },
      { id: "e", testStatus: "unavailable", modelLock_gpt: new Date(now + 60000).toISOString() }, // live cooldown
      { id: "f", testStatus: "active", isActive: false }, // disabled → demoted
    ];
    expect(sortConnectionsByAvailability(conns).map((c) => c.id)).toEqual(["b", "c", "d", "a", "e", "f"]);
  });

  it("keeps input order when all share availability", () => {
    const conns = [{ id: "x", testStatus: "active" }, { id: "y", testStatus: "success" }];
    expect(sortConnectionsByAvailability(conns).map((c) => c.id)).toEqual(["x", "y"]);
  });

  it("handles empty and single-connection input", () => {
    expect(sortConnectionsByAvailability([])).toEqual([]);
    expect(sortConnectionsByAvailability([{ id: "only", testStatus: "error" }]).map((c) => c.id)).toEqual(["only"]);
  });
});

describe("reorderProviderConnectionsByIds (atomic persist for port 9router#2558)", () => {
  it("applies the full order in one transaction with priorities 1..N", async () => {
    const repo = await freshRepo();
    const db = await freshDb();
    await seedProviderWithPriorities(db, "p1", ["a", "b", "c"]);

    await repo.reorderProviderConnectionsByIds("p1", ["c", "a", "b"]);

    expect(await prioritiesOf(db, "p1")).toEqual(["c", "a", "b"]);
  });

  it("rolls back entirely on duplicate ids", async () => {
    const repo = await freshRepo();
    const db = await freshDb();
    await seedProviderWithPriorities(db, "p1", ["a", "b", "c"]);

    await expect(repo.reorderProviderConnectionsByIds("p1", ["c", "c", "a"])).rejects.toThrow(/duplicate/i);

    expect(await prioritiesOf(db, "p1")).toEqual(["a", "b", "c"]); // unchanged
  });

  it("rolls back entirely on missing/extra ids", async () => {
    const repo = await freshRepo();
    const db = await freshDb();
    await seedProviderWithPriorities(db, "p1", ["a", "b", "c"]);

    await expect(repo.reorderProviderConnectionsByIds("p1", ["a", "b"])).rejects.toThrow(/exactly/i);
    await expect(repo.reorderProviderConnectionsByIds("p1", ["a", "b", "zzz"])).rejects.toThrow(/exactly/i);

    expect(await prioritiesOf(db, "p1")).toEqual(["a", "b", "c"]); // unchanged
  });
});
