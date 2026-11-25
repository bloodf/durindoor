import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { acquireAntigravityLease } from "../../src/lib/antigravity/leaseSql.js";
import { browserRecoveryAvailable, classifyBrowserUrl } from "../../src/lib/antigravity/browserRecovery.js";

let tempDir;
let originalDataDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-port758-"));
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
});

afterEach(() => {
  try { global._dbAdapter?.close?.(); } catch { /* already closed */ }
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

it("holds one Antigravity refresh lease and leaves browser recovery closed", async () => {
  expect(browserRecoveryAvailable({})).toBe(false);
  const consent = classifyBrowserUrl(
    "https://accounts.google.com/signin/oauth/consent",
    "https://localhost/callback"
  );
  expect(consent).toEqual({ action: "block", category: "consent" });

  const { getAdapter } = await import("../../src/lib/db/driver.js");
  const db = await getAdapter();
  const claim = { connectionId: "port-758", refreshToken: "refresh-port-758", force: false };
  const first = acquireAntigravityLease(db, { ...claim, owner: "owner-a" });
  const second = acquireAntigravityLease(db, { ...claim, owner: "owner-b" });
  expect(first.ok).toBe(true);
  expect(first.lease.owner).toBe("owner-a");
  expect(second).toMatchObject({ ok: false, category: "busy" });
});

it("keeps the scheduler disabled when enable is requested", async () => {
  const { readAntigravityScheduler, setAntigravitySchedulerEnabled, runAntigravitySchedulerTick } =
    await import("../../src/lib/antigravity/scheduler.js");
  expect(await setAntigravitySchedulerEnabled(true)).toEqual({ enabled: false });
  expect(await readAntigravityScheduler()).toEqual({ enabled: false });
  expect(await runAntigravitySchedulerTick()).toEqual({ skipped: "disabled" });
});
