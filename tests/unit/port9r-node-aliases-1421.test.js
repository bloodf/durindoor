import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const originalDataDir = process.env.DATA_DIR;
let dir, db;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-alias-"));
  process.env.DATA_DIR = dir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});
afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});
it("removes aliases targeting a deleted node and preserves neighboring IDs", async () => {
  const node = await db.createProviderNode({ id: "node", type: "openai-compatible", name: "Node" });
  await db.setModelAlias("deleted", `${node.id}/model`);
  await db.setModelAlias("neighbor", `${node.id}-other/model`);
  await db.deleteProviderNode(node.id);
  expect(await db.getModelAliases()).toMatchObject({ neighbor: "node-other/model" });
  expect((await db.getModelAliases()).deleted).toBeUndefined();
});
