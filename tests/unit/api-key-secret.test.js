import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET_FILE_BASENAME = "api-key-secret";

function resetEnv() {
  delete process.env.API_KEY_SECRET;
  delete process.env.DATA_DIR;
}

async function loadModuleFresh() {
  // Each test must see a clean cached secret and a fresh DATA_DIR binding.
  vi.resetModules();
  return await import("../../src/shared/utils/apiKey.js");
}

describe("apiKey secret resolution (SEC-B-01)", () => {
  let tempDir;
  let warnSpy;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-apikey-"));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    resetEnv();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("prefers process.env.API_KEY_SECRET when set", async () => {
    process.env.API_KEY_SECRET = "env-supplied-secret";
    const { getApiKeySecret } = await loadModuleFresh();
    expect(getApiKeySecret()).toBe("env-supplied-secret");
  });

  it("throws when API_KEY_SECRET is unset and DATA_DIR is not configured", async () => {
    resetEnv();
    const { getApiKeySecret } = await loadModuleFresh();
    expect(() => getApiKeySecret()).toThrow(
      /API_KEY_SECRET required/,
    );
  });

  it("mints a fresh 32-byte hex secret under DATA_DIR on first boot and reuses it", async () => {
    process.env.DATA_DIR = tempDir;
    const { getApiKeySecret, __resetApiKeySecretForTests } = await loadModuleFresh();

    const first = getApiKeySecret();
    expect(first).toMatch(/^[0-9a-f]{64}$/);

    const secretPath = path.join(tempDir, SECRET_FILE_BASENAME);
    const stored = fs.readFileSync(secretPath, "utf8").trim();
    expect(stored).toBe(first);
    // Mode 0600: owner read/write only.
    const mode = fs.statSync(secretPath).mode & 0o777;
    expect(mode).toBe(0o600);

    // Warned about minting, but never leaked the value.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnArg = String(warnSpy.mock.calls[0][0]);
    expect(warnArg).toContain("API_KEY_SECRET unset");
    expect(warnArg).not.toContain(first);
    expect(warnArg).not.toContain(tempDir);

    // A second boot (fresh module cache, same DATA_DIR) reuses the stored value.
    __resetApiKeySecretForTests();
    warnSpy.mockClear();
    const second = getApiKeySecret();
    expect(second).toBe(first);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("generates a CRC that round-trips through parseApiKey against the file-backed secret", async () => {
    process.env.DATA_DIR = tempDir;
    const {
      generateApiKeyWithMachine,
      parseApiKey,
      verifyApiKeyCrc,
      getApiKeySecret,
    } = await loadModuleFresh();

    const machineId = "0123456789abcdef";
    const { key, keyId } = generateApiKeyWithMachine(machineId);
    expect(key).toMatch(/^sk-0123456789abcdef-[a-z0-9]{6}-[0-9a-f]{8}$/);
    expect(keyId).toHaveLength(6);

    const parsed = parseApiKey(key);
    expect(parsed).toEqual({ machineId, keyId, isNewFormat: true });
    expect(verifyApiKeyCrc(key)).toBe(true);

    // Tampered CRC is rejected.
    const forged = key.replace(/-[0-9a-f]{8}$/, "-deadbeef");
    expect(parseApiKey(forged)).toBeNull();
    expect(verifyApiKeyCrc(forged)).toBe(false);

    // Same secret backs both: CRC computed directly against the resolved secret
    // matches what parseApiKey accepts.
    const crypto = await import("node:crypto");
    const manual = crypto
      .createHmac("sha256", getApiKeySecret())
      .update(machineId + keyId)
      .digest("hex")
      .slice(0, 8);
    expect(key.endsWith(`-${manual}`)).toBe(true);
  });

  it("leaves legacy sk-<8 hex> keys untouched (AGENTS.md §2/§3 invariant)", async () => {
    process.env.DATA_DIR = tempDir;
    const { parseApiKey, verifyApiKeyCrc, isNewFormatKey } = await loadModuleFresh();
    const legacy = "sk-a1b2c3d4";
    expect(parseApiKey(legacy)).toEqual({
      machineId: null,
      keyId: "a1b2c3d4",
      isNewFormat: false,
    });
    expect(verifyApiKeyCrc(legacy)).toBe(true);
    expect(isNewFormatKey(legacy)).toBe(false);
  });

  it("the file-backed secret is not embedded in any exported DB dump (exportDb)", async () => {
    process.env.DATA_DIR = tempDir;
    const { getApiKeySecret } = await loadModuleFresh();
    const secret = getApiKeySecret();

    // Bring up the SQLite adapter against the same DATA_DIR and dump it.
    const { exportDb } = await import("../../src/lib/db/index.js");
    const dump = await exportDb();
    const serialized = JSON.stringify(dump);

    // Neither the secret value nor its path leaks into the dump.
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(SECRET_FILE_BASENAME);
    expect(serialized).not.toContain(path.join(tempDir, SECRET_FILE_BASENAME));
  });
});
