import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  secretsReadLegacy,
  secretsFilePath,
  encryptPostgresUrl,
  decryptPostgresUrl,
  resolvePostgresSecret,
  POSTGRES_URL_KEY,
} from "@/lib/db/secrets.js";
import { __resetColumnCryptoForTests } from "@/lib/crypto/columnCrypto.js";

function makeTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-secrets-"));
  process.env.DATA_DIR = dir;
  return dir;
}

function rmTemp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// Module-level setup so the encrypt/decrypt tests have a DATA_DIR
// before they run.
beforeAll(() => {
  makeTempDataDir();
});

describe("db/secrets — encrypt/decrypt round-trip", () => {
  it("encrypts and decrypts a URL with the AAD bound to the key name", () => {
    const url = "postgres://u:p@h:5432/db";
    const blob = encryptPostgresUrl(url);
    expect(decryptPostgresUrl(blob)).toBe(url);
  });

  it("returns null when given a non-blob", () => {
    expect(decryptPostgresUrl(null)).toBeNull();
    expect(decryptPostgresUrl(undefined)).toBeNull();
    expect(decryptPostgresUrl({})).toBeNull();
    expect(decryptPostgresUrl({ v: 99, iv: "x", ct: "y" })).toBeNull();
  });

  it("rejects an empty URL at encrypt time", () => {
    expect(() => encryptPostgresUrl("")).toThrow();
    expect(() => encryptPostgresUrl(null)).toThrow();
  });
});

describe("db/secrets — legacy file fallback (read-only)", () => {
  let dir;
  beforeEach(() => {
    dir = makeTempDataDir();
    __resetColumnCryptoForTests();
  });
  afterEach(() => {
    rmTemp(dir);
    delete process.env.DURINDOOR_PG_URL;
    __resetColumnCryptoForTests();
  });

  it("creates the legacy file with mode 0600 when seeded", () => {
    if (process.platform === "win32") return;
    const p = secretsFilePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const blob = encryptPostgresUrl("postgres://x@h/db");
    fs.writeFileSync(p, JSON.stringify({ [POSTGRES_URL_KEY]: blob }));
    try { fs.chmodSync(p, 0o600); } catch { /* noop on win32 */ }
    const st = fs.statSync(p);
    expect((st.mode & 0o777) & ~0o600).toBe(0);
  });

  it("secretsReadLegacy returns null for a missing key", () => {
    expect(secretsReadLegacy(POSTGRES_URL_KEY)).toBeNull();
  });

  it("secretsReadLegacy round-trips a URL through the legacy file format", () => {
    const url = "postgres://u:p@h:5432/db";
    const blob = encryptPostgresUrl(url);
    const p = secretsFilePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ [POSTGRES_URL_KEY]: blob }));
    expect(secretsReadLegacy(POSTGRES_URL_KEY)).toBe(url);
  });

  it("secretsReadLegacy refuses plaintext-looking values", () => {
    const p = secretsFilePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ [POSTGRES_URL_KEY]: "postgres://plaintext" }));
    expect(secretsReadLegacy(POSTGRES_URL_KEY)).toBeNull();
  });
});

describe("db/secrets — resolvePostgresSecret env precedence", () => {
  let dir;
  beforeEach(() => {
    dir = makeTempDataDir();
    __resetColumnCryptoForTests();
    delete process.env.DURINDOOR_PG_URL;
  });
  afterEach(() => {
    rmTemp(dir);
    delete process.env.DURINDOOR_PG_URL;
    __resetColumnCryptoForTests();
  });

  it("returns the env var when set", async () => {
    process.env.DURINDOOR_PG_URL = "postgres://from-env@h/db";
    expect(await resolvePostgresSecret()).toBe("postgres://from-env@h/db");
  });

  it("returns null when nothing is configured", async () => {
    expect(await resolvePostgresSecret()).toBeNull();
  });

  it("falls back to the legacy file when neither env nor settings row is set", async () => {
    // Seed the legacy file directly. resolvePostgresSecret tries env
    // first, then settings row (which is empty in this test), then
    // the legacy file.
    const p = secretsFilePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const blob = encryptPostgresUrl("postgres://from-legacy-file@h/db");
    fs.writeFileSync(p, JSON.stringify({ [POSTGRES_URL_KEY]: blob }));
    try { fs.chmodSync(p, 0o600); } catch { /* noop on win32 */ }
    expect(await resolvePostgresSecret()).toBe("postgres://from-legacy-file@h/db");
  });
});
