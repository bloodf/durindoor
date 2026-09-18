import { describe, it, expect } from "vitest";
import {
  generateBackupCode,
  normalizeBackupCode,
  generateBackupCodes,
  consumeBackupCode,
  BACKUP_CODE_COUNT,
} from "../../src/lib/auth/backupCodes.js";

describe("generateBackupCode", () => {
  it("produces a grouped, unambiguous-alphabet code", () => {
    const code = generateBackupCode();
    expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    expect(code).not.toMatch(/[01OIL]/);
  });
});

describe("normalizeBackupCode", () => {
  it("strips separators/whitespace and uppercases", () => {
    expect(normalizeBackupCode(" a3f7k-qm29x ")).toBe("A3F7KQM29X");
  });

  it("handles null/undefined input", () => {
    expect(normalizeBackupCode(undefined)).toBe("");
  });
});

describe("generateBackupCodes / consumeBackupCode", () => {
  it("generates the default count, all distinct", async () => {
    const { codes, hashes } = await generateBackupCodes();
    expect(codes).toHaveLength(BACKUP_CODE_COUNT);
    expect(hashes).toHaveLength(BACKUP_CODE_COUNT);
    expect(new Set(codes).size).toBe(BACKUP_CODE_COUNT);
  });

  it("matches a valid code and removes only that hash", async () => {
    const { codes, hashes } = await generateBackupCodes(3);
    const { matched, remainingHashes } = await consumeBackupCode(codes[1], hashes);
    expect(matched).toBe(true);
    expect(remainingHashes).toHaveLength(2);

    // The consumed code no longer matches any remaining hash (single use).
    const replay = await consumeBackupCode(codes[1], remainingHashes);
    expect(replay.matched).toBe(false);
    expect(replay.remainingHashes).toHaveLength(2);
  });

  it("rejects a code that was never issued", async () => {
    const { hashes } = await generateBackupCodes(2);
    const { matched, remainingHashes } = await consumeBackupCode("ZZZZZ-ZZZZZ", hashes);
    expect(matched).toBe(false);
    expect(remainingHashes).toBe(hashes);
  });

  it("rejects empty input without touching the stored hashes", async () => {
    const { hashes } = await generateBackupCodes(2);
    const { matched, remainingHashes } = await consumeBackupCode("", hashes);
    expect(matched).toBe(false);
    expect(remainingHashes).toBe(hashes);
  });
});
