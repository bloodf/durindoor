import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

describe("updater data directory", () => {
  it("uses the shared resolver for an inaccessible configured directory", () => {
    const { resolveDataDir } = require("../../src/lib/updater/dataDir.cjs");
    const original = process.env.DATA_DIR;
    const mkdir = fs.mkdirSync;
    const target = path.join(os.tmpdir(), "updater-inaccessible-test");
    process.env.DATA_DIR = target;
    fs.mkdirSync = (dir, options) => {
      if (dir === target) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return mkdir(dir, options);
    };
    try {
      expect(resolveDataDir(() => false)).toBe(path.join(os.homedir(), ".9router"));
    } finally {
      fs.mkdirSync = mkdir;
      if (original === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = original;
    }
  });
  it("copies the updater and resolver to the resolved fallback directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "updater-fallback-"));
    const target = path.join(root, "denied");
    const oldData = process.env.DATA_DIR;
    const oldHome = process.env.HOME;
    const mkdir = fs.mkdirSync;
    process.env.DATA_DIR = target;
    process.env.HOME = root;
    fs.mkdirSync = (dir, options) => {
      if (dir === target) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return mkdir(dir, options);
    };
    vi.doMock("@/mitm/manager", () => ({ stopServer: vi.fn(), getCachedPassword: vi.fn(), loadEncryptedPassword: vi.fn() }));
    try {
      const { ensureRuntimeUpdater } = await import("../../src/lib/appUpdater.js");
      const bundled = path.resolve("../src/lib/updater/updater.js");
      const runtime = ensureRuntimeUpdater(bundled);
      expect(runtime).toBe(path.join(root, ".9router", "runtime", "updater", "updater.js"));
      expect(fs.existsSync(path.join(path.dirname(runtime), "dataDir.cjs"))).toBe(true);
    } finally {
      fs.mkdirSync = mkdir;
      if (oldData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldData;
      if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
      fs.rmSync(root, { recursive: true, force: true });
      vi.doUnmock("@/mitm/manager");
    }
  });
});
