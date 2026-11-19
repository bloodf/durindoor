import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-lan-discovery-default-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("lanDiscoveryEnabled setting default (#2025)", () => {
  it("defaults to false on a fresh settings row", async () => {
    const settings = await db.getSettings();
    expect(settings.lanDiscoveryEnabled).toBe(false);
  });

  it("preserves an explicitly persisted true value", async () => {
    await db.updateSettings({ lanDiscoveryEnabled: true });
    const settings = await db.getSettings();
    expect(settings.lanDiscoveryEnabled).toBe(true);
  });
});
