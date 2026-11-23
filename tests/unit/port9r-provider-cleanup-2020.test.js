import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const originalDataDir = process.env.DATA_DIR;
let dir, db, adapter;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-2020-"));
  process.env.DATA_DIR = dir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
});
afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

it("preserves shared prefixes and deletes exclusive aliases after a rename", async () => {
  const node = await db.createProviderNode({ id: "node_1", type: "openai-compatible", name: "One", prefix: "old%" });
  await db.setModelAlias("renamed", "old%/model");
  await db.setModelAlias("neighbor", "oldX/model");
  await db.updateProviderNode(node.id, { prefix: "new" });
  await db.setModelAlias("current", "new/model");
  await db.addCustomModel({ providerAlias: "new", id: "m", capabilities: { maxInput: 123, maxOutput: 45 } });
  expect((await db.getCustomModels()).find((m) => m.id === "m").capabilities).toEqual({ maxInput: 123, maxOutput: 45 });
  await db.deleteProviderNodeWithConnections(node.id);
  expect(await db.getModelAliases()).toEqual({ neighbor: "oldX/model" });
  const a = await db.createProviderNode({ id: "a", type: "openai-compatible", name: "A", prefix: "shared" });
  await db.createProviderNode({ id: "b", type: "openai-compatible", name: "B", prefix: "shared" });
  await db.setModelAlias("shared", "shared/model");
  await db.deleteProviderNodeWithConnections(a.id);
  expect((await db.getModelAliases()).shared).toBe("shared/model");
});

it("rolls back connections and aliases if node deletion fails", async () => {
  const node = await db.createProviderNode({ id: "rollback", type: "openai-compatible", name: "Rollback", prefix: "rb" });
  const connection = await db.createProviderConnection({ provider: node.id, authType: "apikey", name: "Account", apiKey: "secret" });
  await db.setModelAlias("rollback", "rb/model");
  adapter.run("CREATE TRIGGER fail_node_delete BEFORE DELETE ON providerNodes BEGIN SELECT RAISE(ABORT, 'blocked'); END");
  try {
    await expect(db.deleteProviderNodeWithConnections(node.id)).rejects.toThrow("blocked");
    expect(await db.getProviderNodeById(node.id)).not.toBeNull();
    expect(await db.getProviderConnectionById(connection.id)).not.toBeNull();
    expect((await db.getModelAliases()).rollback).toBe("rb/model");
  } finally { adapter.run("DROP TRIGGER fail_node_delete"); }
});
