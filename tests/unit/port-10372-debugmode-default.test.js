// Port of OmniRoute #10372: getSettings() must default debugMode to false
// for fresh/absent settings rows, while preserving an explicitly persisted
// true or false value.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-debugmode-default-"));
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

describe("port(upstream): #10372 - debugMode defaults to false", () => {
  it("fresh install with no stored debugMode resolves to false", async () => {
    const settings = await db.getSettings();
    expect(settings.debugMode).toBe(false);
  });

  it("explicitly persisted debugMode: true is preserved", async () => {
    await db.updateSettings({ debugMode: true });
    const settings = await db.getSettings();
    expect(settings.debugMode).toBe(true);
  });

  it("explicitly persisted debugMode: false stays false", async () => {
    await db.updateSettings({ debugMode: false });
    const settings = await db.getSettings();
    expect(settings.debugMode).toBe(false);
  });
});
