// macOS (no /proc) browser shard cleanup is fail-closed.
//
// Stock macOS tools cannot prove shard ownership or completed cleanup: `ps -E`
// joins the environment to the arguments (and a process can rewrite its
// arguments between reads), hides the environment of platform binaries, may
// print only the command name, and reports start times to the second. A
// process scan plus a port probe can both look clear while a late child binds
// the port. So without /proc, cleanup signals nothing and never reports
// success. These tests pin that contract with a mocked `kill` that must never
// run and a missing procfs root; they behave the same on every host.
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cleanupShardServer } from "../../scripts/lib/website-shard-server.mjs";

const owner = "e".repeat(32);
const missingProc = path.join(os.tmpdir(), "durindoor-no-proc-here", "proc");
const base = { owner, port: 4000, procRoot: missingProc, pollMs: 1, selfExitMs: 20 };

describe("cleanup without /proc (macOS)", () => {
  it("never reports success, even when the port is free, and signals nothing", async () => {
    const kill = vi.fn();
    const result = await cleanupShardServer({ ...base, platform: "darwin", kill, probe: async () => false });
    expect(result).toMatchObject({ ok: false, verification: "port-only", signalled: [], unattributedListener: false });
    expect(result.reason).toMatch(/cannot be verified/);
    expect(kill).not.toHaveBeenCalled();
  });

  it("fails without signalling while the port stays held", async () => {
    const kill = vi.fn();
    const result = await cleanupShardServer({ ...base, platform: "darwin", kill, probe: async () => true });
    expect(result).toMatchObject({ ok: false, verification: "port-only", signalled: [] });
    expect(result).toMatchObject({ unattributedListener: true });
    expect(result.reason).toMatch(/still held/);
    expect(kill).not.toHaveBeenCalled();
  });

  it("does not consult ps or any other process table", async () => {
    const kill = vi.fn();
    const runPs = vi.fn(() => { throw new Error("ps must not be used"); });
    const result = await cleanupShardServer({ ...base, platform: "darwin", kill, runPs, probe: async () => false });
    expect(result.ok).toBe(false);
    expect(runPs).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });
});
