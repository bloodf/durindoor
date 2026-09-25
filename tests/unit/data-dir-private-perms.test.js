/**
 * GHSA-2pg2-xm9r-8544 (ported from OmniRoute #14712): the default DATA_DIR
 * (~/.9router, used when no DATA_DIR env var is set) and the columnCrypto
 * master key were created without an explicit mode, so under a permissive
 * umask (e.g. 002) they landed group/world readable — any other local user
 * could read the key that decrypts every stored credential. These cases
 * pin the private-by-default contract: a fresh default dir is 0700, an
 * existing broader-mode dir is repaired, and a pre-existing master-key file
 * gets its mode tightened on next use. POSIX-only: Windows has no mode bits.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { getAppDataDir } = require("../../cli/src/cli/appDataDir.js");

const describePosix = process.platform === "win32" ? describe.skip : describe;

function modeOf(target) {
  return fs.statSync(target).mode & 0o777;
}

describePosix("CLI default data dir permissions (appDataDir.js)", () => {
  let tempHome;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-appdatadir-"));
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it("creates a fresh default data dir owner-only (0700)", () => {
    const dir = getAppDataDir({ env: {}, platform: "linux", homedir: () => tempHome });
    expect(dir).toBe(path.join(tempHome, ".9router"));
    expect(modeOf(dir)).toBe(0o700);
  });

  it("repairs an existing default data dir that is group/world readable", () => {
    const dir = path.join(tempHome, ".9router");
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o755);

    getAppDataDir({ env: {}, platform: "linux", homedir: () => tempHome });

    expect(modeOf(dir)).toBe(0o700);
  });

  it("repairs an existing configured DATA_DIR that is group/world readable", () => {
    const dir = path.join(tempHome, "configured-data");
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o775);

    getAppDataDir({ env: { DATA_DIR: dir }, platform: "linux", homedir: () => tempHome, cwd: () => tempHome });

    expect(modeOf(dir)).toBe(0o700);
  });
});

describePosix("Default data dir permissions (src/lib/dataDir.js)", () => {
  const originalDataDir = process.env.DATA_DIR;
  let tempHome;
  let homedirSpy;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-datadir-"));
    delete process.env.DATA_DIR;
    homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    vi.resetModules();
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    vi.resetModules();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it("creates a fresh default data dir owner-only (0700)", async () => {
    const { getDataDir } = await import("@/lib/dataDir.js");
    const dir = getDataDir();
    expect(dir).toBe(path.join(tempHome, ".9router"));
    expect(modeOf(dir)).toBe(0o700);
  });

  it("repairs an existing default data dir that is group/world readable", async () => {
    const dir = path.join(tempHome, ".9router");
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o755);

    const { getDataDir } = await import("@/lib/dataDir.js");
    getDataDir();

    expect(modeOf(dir)).toBe(0o700);
  });
});

describePosix("columnCrypto master-key permission repair", () => {
  const originalDataDir = process.env.DATA_DIR;
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-crypto-perms-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    vi.resetModules();
  });

  it("tightens a pre-existing master-key file back to 0600 on next use", async () => {
    const keyPath = path.join(tempDir, "master-key");
    fs.writeFileSync(keyPath, Buffer.alloc(32, 1));
    fs.chmodSync(keyPath, 0o644);

    const columnCrypto = await import("@/lib/crypto/columnCrypto.js");
    columnCrypto.__resetColumnCryptoForTests();
    columnCrypto.encryptField("hello", "row-1");

    expect(modeOf(keyPath)).toBe(0o600);
  });
});
