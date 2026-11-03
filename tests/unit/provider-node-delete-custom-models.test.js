// Upstream a8f63f4d: deleting a provider node must also drop its customModels
// kv rows, otherwise the deleted node keeps surfacing models.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-node-cm-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
}, 30000);

afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("deleteProviderNode prunes custom models", () => {
  it("removes rows keyed by node id or prefix and keeps other providers", async () => {
    const node = await db.createProviderNode({ type: "openai-compatible", name: "N", prefix: "myp", baseUrl: "https://api.test", apiType: "chat" });
    const other = await db.createProviderNode({ type: "openai-compatible", name: "O", prefix: "other", baseUrl: "https://api.test", apiType: "chat" });
    await db.addCustomModel({ providerAlias: node.id, id: "m1" });
    await db.addCustomModel({ providerAlias: "myp", id: "m2" });
    await db.addCustomModel({ providerAlias: other.id, id: "m3" });
    await db.addCustomModel({ providerAlias: "openai", id: "m4" });

    await db.deleteProviderNode(node.id);

    const left = (await db.getCustomModels()).map((m) => m.id).sort();
    expect(left).toEqual(["m3", "m4"]);
  });
});
