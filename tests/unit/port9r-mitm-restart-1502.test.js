import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installLifecycleHarness } from "./mitm-manager-harness.js";

const require = createRequire(import.meta.url);
const managerPath = require.resolve("../../src/mitm/manager.js");

describe("MITM restart recovery", () => {
  let tmpDir;
  let restorers;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-restart-"));
    process.env.MITM_GLOBAL_STATE_DIR = path.join(tmpDir, "global");
    restorers = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    delete require.cache[managerPath];
    for (const restore of restorers.reverse()) restore();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.MITM_GLOBAL_STATE_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function setup() {
    const harness = installLifecycleHarness({ tmpDir, restorers, healthPid: 525252 });
    const manager = require("../../src/mitm/manager.js");
    manager.initDbHooks(async () => ({ mitmEnabled: true }), vi.fn(async () => {}));
    const start = manager.startServer("key", "password");
    await vi.advanceTimersByTimeAsync(250);
    await start;
    harness.child.emit("exit", 1);
    const replacement = manager.startServer("key", "password");
    await vi.advanceTimersByTimeAsync(250);
    await replacement;
    return { harness, manager };
  }

  it("recovers an authenticated running replacement without removing its redirect", async () => {
    const { harness, manager } = await setup();
    const before = harness.commands.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect((await manager.getMitmStatus()).running).toBe(true);
    expect(harness.commands.slice(before)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["foreign", "public failure"])("rejects %s health during recovery", async (failure) => {
    const { harness } = await setup();
    if (failure === "foreign") harness.setHealthNonce("f".repeat(48));
    else harness.setPublicHealthFailure(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it("does not restart after a concurrent stop", async () => {
    const { manager } = await setup();
    const stop = manager.stopServer("password");
    await vi.advanceTimersByTimeAsync(5000);
    await stop;
    expect((await manager.getMitmStatus()).running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
