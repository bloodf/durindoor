// Saving a visible-model allowlist also clears its ids from the disabled
// blacklist, inside the same transaction as the allowlist write.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-enabled-models-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("setEnabledModels", () => {
  it("drops allowlisted ids from the blacklist and keeps the rest", async () => {
    await db.disableModels("ds", ["deepseek-chat", "deepseek-reasoner"]);
    await db.setEnabledModels("ds", ["deepseek-chat"]);

    expect(await db.getEnabledByProvider("ds")).toEqual(["deepseek-chat"]);
    expect(await db.getDisabledByProvider("ds")).toEqual(["deepseek-reasoner"]);
  });

  it("removes the blacklist row once every id is allowlisted", async () => {
    await db.setEnabledModels("ds", ["deepseek-chat", "deepseek-reasoner"]);
    expect((await db.getDisabledModels()).ds).toBeUndefined();
  });

  it("leaves the blacklist untouched when the allowlist is cleared", async () => {
    await db.disableModels("ds", ["deepseek-chat"]);
    await db.setEnabledModels("ds", []);

    expect((await db.getEnabledModels()).ds).toBeUndefined();
    expect(await db.getDisabledByProvider("ds")).toEqual(["deepseek-chat"]);
  });
});
