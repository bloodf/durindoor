/**
 * Pins dashboardSession JWT secret resolution (GHSA-jphh / independent of
 * decolua/9router#3501). DurinDoor must not mint DATA_DIR/jwt-secret anymore:
 * env wins, an existing legacy file is reused with a warning, and missing both
 * fails closed.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET_FILE_BASENAME = "jwt-secret";

/** Fingerprint of the fail-closed resolution contract (env → legacy file → throw). */
const LOAD_JWT_SECRET_CONTRACT_SHA256 =
  "f8e34553b9e418b0076dc81c84cec977c77d61dfb77acdc8648222f880891106";

function resetEnv() {
  delete process.env.JWT_SECRET;
  delete process.env.DATA_DIR;
}

async function loadModuleFresh(dataDir) {
  vi.resetModules();
  vi.doMock("@/lib/dataDir", () => ({ DATA_DIR: dataDir }));
  vi.doMock("@/lib/localDb", () => ({
    getSettings: vi.fn(async () => ({ passwordSessionEpoch: 1 })),
    getSettingsSync: vi.fn(() => ({ passwordSessionEpoch: 1 })),
  }));
  return await import("../../src/lib/auth/dashboardSession.js");
}

describe("dashboardSession JWT secret resolution (GHSA-jphh)", () => {
  let tempDir;
  let warnSpy;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-jwt-"));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetEnv();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    resetEnv();
    vi.doUnmock("@/lib/dataDir");
    vi.doUnmock("@/lib/localDb");
    vi.resetModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("locks the published fail-closed resolution contract to an independent fingerprint", async () => {
    const { loadJwtSecret, JWT_SECRET_FILE_BASENAME } = await loadModuleFresh(tempDir);
    const contract = [
      "1:env JWT_SECRET non-empty string wins",
      "2:legacy DATA_DIR/" + JWT_SECRET_FILE_BASENAME + " reused with warn",
      "3:neither → throw; never mkdir/write/randomBytes mint",
      loadJwtSecret.toString(),
    ].join("\n");
    expect(createHash("sha256").update(contract).digest("hex")).toBe(
      LOAD_JWT_SECRET_CONTRACT_SHA256,
    );
  });

  it("prefers process.env.JWT_SECRET when set", async () => {
    process.env.JWT_SECRET = "env-supplied-jwt-secret";
    fs.writeFileSync(path.join(tempDir, SECRET_FILE_BASENAME), "file-secret-ignored", {
      mode: 0o600,
    });
    const { loadJwtSecret } = await loadModuleFresh(tempDir);
    expect(loadJwtSecret()).toBe("env-supplied-jwt-secret");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("reuses an existing DATA_DIR/jwt-secret and warns when env is unset", async () => {
    const legacy = "a".repeat(64);
    fs.writeFileSync(path.join(tempDir, SECRET_FILE_BASENAME), legacy, { mode: 0o600 });
    const { loadJwtSecret } = await loadModuleFresh(tempDir);
    expect(loadJwtSecret()).toBe(legacy);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnArg = String(warnSpy.mock.calls[0][0]);
    expect(warnArg).toContain("JWT_SECRET unset");
    expect(warnArg).toContain(SECRET_FILE_BASENAME);
    expect(warnArg).not.toContain(legacy);
    expect(warnArg).not.toContain(tempDir);
  });

  it("throws when JWT_SECRET is unset and no jwt-secret file exists", async () => {
    const { loadJwtSecret } = await loadModuleFresh(tempDir);
    expect(() => loadJwtSecret()).toThrow(/JWT_SECRET environment variable is required/);
    expect(fs.existsSync(path.join(tempDir, SECRET_FILE_BASENAME))).toBe(false);
  });

  it("never writes a new jwt-secret file after a failed resolve", async () => {
    const { loadJwtSecret } = await loadModuleFresh(tempDir);
    expect(() => loadJwtSecret()).toThrow(/JWT_SECRET/);
    expect(() => loadJwtSecret()).toThrow(/JWT_SECRET/);
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });

  it("treats an empty JWT_SECRET env as unset and falls through to file/throw", async () => {
    process.env.JWT_SECRET = "";
    const { loadJwtSecret } = await loadModuleFresh(tempDir);
    expect(() => loadJwtSecret()).toThrow(/JWT_SECRET environment variable is required/);
  });

  it("signs and verifies a dashboard token against the resolved secret", async () => {
    process.env.JWT_SECRET = "unit-test-jwt-secret-do-not-reuse";
    const {
      createDashboardAuthToken,
      verifyDashboardAuthToken,
      __resetJwtSecretForTests,
    } = await loadModuleFresh(tempDir);
    __resetJwtSecretForTests();
    const token = await createDashboardAuthToken({ passwordSessionEpoch: 1 });
    await expect(verifyDashboardAuthToken(token)).resolves.toBe(true);
  });
});
