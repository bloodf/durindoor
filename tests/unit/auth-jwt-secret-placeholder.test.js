/**
 * A JWT_SECRET copied from .env.example or the docs is public, so sessions
 * signed with it could be forged (decolua/9router#4286 item 4). DurinDoor
 * ignores it with a warning and treats it as unset: legacy DATA_DIR/jwt-secret
 * if present, otherwise throw.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanDocExamples } from "../utils/docExamples.js";
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function forge(secret) {
  return new SignJWT({ authenticated: true, passwordSessionEpoch: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(new TextEncoder().encode(secret));
}

async function loadModuleFresh(dataDir, jwtSecret) {
  vi.resetModules();
  process.env.JWT_SECRET = jwtSecret;
  vi.doMock("@/lib/dataDir", () => ({ DATA_DIR: dataDir }));
  vi.doMock("@/lib/localDb", () => ({
    getSettings: vi.fn(async () => ({ passwordSessionEpoch: 1 })),
    getSettingsSync: vi.fn(() => ({ passwordSessionEpoch: 1 })),
  }));
  return await import("../../src/lib/auth/dashboardSession.js");
}

describe("placeholder JWT_SECRET", () => {
  let tempDir;
  let warnSpy;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-jwt-ph-"));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env.JWT_SECRET;
    vi.doUnmock("@/lib/dataDir");
    vi.doUnmock("@/lib/localDb");
    vi.resetModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("fails closed when the only secret is a published example", async () => {
    const { loadJwtSecret } = await loadModuleFresh(tempDir, "replace-me");

    expect(() => loadJwtSecret()).toThrow(/JWT_SECRET environment variable is required/);
    expect(String(warnSpy.mock.calls[0][0])).toContain("published example value");
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });

  it("does not accept a token forged with the .env.example value", async () => {
    fs.writeFileSync(path.join(tempDir, "jwt-secret"), "b".repeat(64), { mode: 0o600 });
    const session = await loadModuleFresh(tempDir, "CHANGE_ME_LONG_RANDOM_SECRET");

    expect(await session.verifyDashboardAuthToken(await forge("CHANGE_ME_LONG_RANDOM_SECRET"))).toBe(false);
    expect(await session.verifyDashboardAuthToken(await session.createDashboardAuthToken())).toBe(true);
  });

  it("keeps honoring an operator-chosen JWT_SECRET", async () => {
    const secret = "f3b1c9e2-operator-chosen-secret-7d41a0";
    const session = await loadModuleFresh(tempDir, secret);

    expect(await session.verifyDashboardAuthToken(await forge(secret))).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // A new JWT_SECRET example in any doc must also be added to PLACEHOLDER_JWT_SECRETS.
  it("covers every literal JWT_SECRET example shipped in the repo docs", async () => {
    const { isPlaceholderJwtSecret } = await loadModuleFresh(tempDir, "");
    const examples = scanDocExamples("JWT_SECRET", REPO_ROOT);

    expect(examples.size).toBeGreaterThan(0);
    for (const [value, file] of examples) {
      expect(isPlaceholderJwtSecret(value), `${value} (${file})`).toBe(true);
    }
  });
});
