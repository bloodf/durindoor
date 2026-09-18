// Exercises consumeBackupCodeAtomic against a real (temp-dir) db adapter,
// not a mock, so the test actually proves the transaction serializes
// concurrent access instead of asserting on a hand-written promise.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mfa-race-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("consumeBackupCodeAtomic concurrency (decolua/9router#4144 TOCTOU fix)", () => {
  it("lets exactly one of two concurrent requests for the SAME code succeed", async () => {
    const { updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const { generateBackupCodes, findBackupCodeHashIndexSync } = await import(
      "../../src/lib/auth/backupCodes.js"
    );
    const { consumeBackupCodeAtomic } = await import("@/lib/db/repos/settingsRepo.js");

    const { codes, hashes } = await generateBackupCodes(3);
    await updateSettings({ mfaEnabled: true, mfaSecret: "irrelevant", mfaBackupCodes: hashes });

    // Two "concurrent" attempts to redeem the SAME physical backup code, as
    // two browser tabs racing a login would produce. The buggy version
    // (getSettings + async bcrypt.compare loop + updateSettings) let both
    // calls see the pre-write array and both report a match; the atomic
    // version re-reads inside the write transaction, so only the one that
    // actually lands the write can report a match.
    const [first, second] = await Promise.all([
      consumeBackupCodeAtomic(codes[0], findBackupCodeHashIndexSync),
      consumeBackupCodeAtomic(codes[0], findBackupCodeHashIndexSync),
    ]);

    const matchedCount = [first, second].filter((r) => r.matched).length;
    expect(matchedCount).toBe(1);

    // The stored set shrank by exactly one hash, not two (double-consumed)
    // and not zero (both lost the race).
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    expect(settings.mfaBackupCodes).toHaveLength(2);

    // The code is now fully spent: a third attempt fails.
    const third = await consumeBackupCodeAtomic(codes[0], findBackupCodeHashIndexSync);
    expect(third.matched).toBe(false);
  });

  it("lets two concurrent requests for two DIFFERENT codes both succeed, without clobbering each other", async () => {
    const { updateSettings, getSettings, consumeBackupCodeAtomic } = await import(
      "@/lib/db/repos/settingsRepo.js"
    );
    const { generateBackupCodes, findBackupCodeHashIndexSync } = await import(
      "../../src/lib/auth/backupCodes.js"
    );

    const { codes, hashes } = await generateBackupCodes(3);
    await updateSettings({ mfaEnabled: true, mfaSecret: "irrelevant", mfaBackupCodes: hashes });

    const [first, second] = await Promise.all([
      consumeBackupCodeAtomic(codes[0], findBackupCodeHashIndexSync),
      consumeBackupCodeAtomic(codes[1], findBackupCodeHashIndexSync),
    ]);

    expect(first.matched).toBe(true);
    expect(second.matched).toBe(true);

    // Both consumptions landed -- the naive last-write-wins version would
    // have one of these silently resurrect the other's already-spent code.
    const settings = await getSettings();
    expect(settings.mfaBackupCodes).toHaveLength(1);
    expect(settings.mfaBackupCodes[0]).toBe(hashes[2]);
  });
});
