// SEC-B-02: column-level AES-256-GCM encryption tests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
let columnCrypto;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-crypto-"));
  process.env.DATA_DIR = tempDir;
  columnCrypto = await import("@/lib/crypto/columnCrypto.js");
  columnCrypto.__resetColumnCryptoForTests();
});

afterEach(() => {
  columnCrypto.__resetColumnCryptoForTests();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("columnCrypto", () => {
  it("mints a 32-byte master key with 0o600 permissions on first use", () => {
    columnCrypto.encryptField("hello", "row-1");
    const keyPath = path.join(tempDir, "master-key");
    const stat = fs.statSync(keyPath);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(stat.size).toBe(32);
  });

  it("throws when DATA_DIR is unset", () => {
    delete process.env.DATA_DIR;
    columnCrypto.__resetColumnCryptoForTests();
    expect(() => columnCrypto.encryptField("x", "row-1")).toThrow(/DATA_DIR/);
  });

  it("round-trips UTF-8 plaintext", () => {
    const plaintext = "sk-live-àéß-🔐-12345";
    const blob = columnCrypto.encryptField(plaintext, "row-1");
    expect(columnCrypto.decryptField(blob, "row-1")).toBe(plaintext);
  });

  it("produces non-deterministic ciphertext (random IV)", () => {
    const a = columnCrypto.encryptField("same-plaintext", "row-1");
    const b = columnCrypto.encryptField("same-plaintext", "row-1");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("does not leak plaintext in the ciphertext or iv", () => {
    const secret = "sk-super-secret-token-value-12345";
    const blob = columnCrypto.encryptField(secret, "row-1");
    const ctBuf = Buffer.from(blob.ct, "base64");
    const ivBuf = Buffer.from(blob.iv, "base64");
    expect(ctBuf.includes(Buffer.from(secret, "utf8"))).toBe(false);
    expect(ivBuf.includes(Buffer.from(secret, "utf8"))).toBe(false);
  });

  it("rejects decryption with the wrong AAD (row binding)", () => {
    const blob = columnCrypto.encryptField("token", "row-1");
    expect(() => columnCrypto.decryptField(blob, "row-2")).toThrow(/authentication failed/);
  });

  it("rejects tampered ciphertext", () => {
    const blob = columnCrypto.encryptField("token", "row-1");
    const ctBuf = Buffer.from(blob.ct, "base64");
    ctBuf[0] ^= 0xff;
    const tampered = { ...blob, ct: ctBuf.toString("base64") };
    expect(() => columnCrypto.decryptField(tampered, "row-1")).toThrow(/authentication failed/);
  });

  it("rejects unsupported blob versions", () => {
    const blob = columnCrypto.encryptField("token", "row-1");
    expect(() => columnCrypto.decryptField({ ...blob, v: 99 }, "row-1")).toThrow(/unsupported blob version/);
  });

  it("isEncryptedBlob returns true only for our blob shape", () => {
    const blob = columnCrypto.encryptField("x", "row-1");
    expect(columnCrypto.isEncryptedBlob(blob)).toBe(true);
    expect(columnCrypto.isEncryptedBlob({ v: 1, iv: "x" })).toBe(false);
    expect(columnCrypto.isEncryptedBlob("not-a-blob")).toBe(false);
    expect(columnCrypto.isEncryptedBlob(null)).toBe(false);
    expect(columnCrypto.isEncryptedBlob(undefined)).toBe(false);
  });

  it("persists the master key across cache resets (same key serves both encrypt and decrypt)", () => {
    const blob = columnCrypto.encryptField("token", "row-1");
    columnCrypto.__resetColumnCryptoForTests();
    expect(columnCrypto.decryptField(blob, "row-1")).toBe("token");
  });

  it("throws when master-key file has wrong length", () => {
    fs.writeFileSync(path.join(tempDir, "master-key"), Buffer.alloc(16), { mode: 0o600 });
    columnCrypto.__resetColumnCryptoForTests();
    expect(() => columnCrypto.encryptField("x", "row-1")).toThrow(/must be exactly/);
  });
});
