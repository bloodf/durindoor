import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { COMMAND_TIMEOUT_MS, killGroup, processGroupMembers, runSupervised } from "../__baseline__/run-ci.mjs";

const alive = (pid, group) => processGroupMembers(group).includes(pid);

describe("test:ci batched supervision", () => {
  const errno = (code) => Object.assign(new Error(code), { code });

  it.each(["EPERM", "EACCES", "EIO"])("falls back after %s and verifies worker exit", async (code) => {
    const calls = [];
    let live = [123, 124];
    await killGroup(123, {
      kill: (pid) => {
        calls.push(pid);
        if (pid < 0) throw errno(code);
        live = live.filter((member) => member !== pid);
      },
      members: () => [...live],
    });
    expect(calls).toEqual([-123, 123, 124]);
    expect(live).toEqual([]);
  });

  it.each([null, "ESRCH"])("verifies exit after signal result %s", async (code) => {
    let inspected = false;
    await killGroup(123, {
      kill: () => { if (code) throw errno(code); },
      members: () => { inspected = true; return []; },
    });
    expect(inspected).toBe(true);
  });

  it("does not interpret ESRCH as proof that workers exited", async () => {
    await expect(killGroup(123, {
      kill: () => { throw errno("ESRCH"); }, members: () => [124], deadline: Date.now(),
    })).rejects.toThrow("live workers may remain");
  });

  it("fails closed when inventory cannot be read", async () => {
    await expect(killGroup(123, {
      kill: () => { throw errno("EPERM"); }, members: () => { throw errno("EIO"); },
    })).rejects.toMatchObject({ message: "command cleanup could not be verified", errors: [
      expect.objectContaining({ code: "EPERM" }), expect.objectContaining({ code: "EPERM" }),
      expect.objectContaining({ code: "EIO" }),
    ] });
  });

  it("propagates denied cleanup at the deadline without waiting forever for close", async () => {
    const child = new EventEmitter();
    child.pid = 123;
    const result = await runSupervised("fake", [], { timeoutMs: 80, operations: {
      spawn: () => child,
      kill: () => { throw errno("EPERM"); }, members: () => [123, 124],
    } });
    expect(result.timedOut).toBe(true);
    expect(result.error.message).toContain("live workers may remain");
    expect(result.error.errors.every((error) => error.code === "EPERM")).toBe(true);
    expect(result.durationMs).toBeLessThan(200);
  });

  it("propagates cleanup failure after successful close", async () => {
    const child = new EventEmitter();
    child.pid = 123;
    const pending = runSupervised("fake", [], { timeoutMs: 80, operations: {
      spawn: () => child, kill: () => {}, members: () => { throw errno("EIO"); },
    } });
    child.emit("close", 0, null);
    expect(await pending).toMatchObject({ code: 0, timedOut: false,
      error: expect.objectContaining({ message: "command cleanup could not be verified" }) });
  });

  it("runs the inventory as sequential batch commands under the five-minute ceiling", () => {
    expect(COMMAND_TIMEOUT_MS).toBe(300_000);
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.scripts["test:ci"]).toBe("node __baseline__/run-ci.mjs");
    const source = fs.readFileSync(new URL("../__baseline__/run-ci.mjs", import.meta.url), "utf8");
    expect(source).toContain("partitionInventory(");
    expect(source).toContain("fullBatchArgs(");
    expect(source).toContain("missingFromDiscovery(");
    // The whole inventory must never again be a single unbounded Vitest command.
    expect(source).not.toMatch(/spawnSync\(process\.execPath,\s*\[vitestBin,\s*"run"/);
  });

  it("returns the exit code of a command that finishes in time", async () => {
    const result = await runSupervised(process.execPath, ["-e", "process.exit(3)"], { timeoutMs: 10_000 });
    expect(result).toMatchObject({ code: 3, timedOut: false });
  });

  it.each([false, true])("kills real fork workers at the ceiling (injected group EPERM: %s)", async (denyGroup) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-ci-supervise-"));
    const pidFile = path.join(dir, "grandchild.pid");
    const groupFile = path.join(dir, "group.pid");
    try {
      const script = `const { spawn } = require("node:child_process");
        const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));
        require("node:fs").writeFileSync(${JSON.stringify(groupFile)}, String(process.pid));
        setInterval(() => {}, 1000);`;
      const result = await runSupervised(process.execPath, ["-e", script], { timeoutMs: 1_000, operations: {
        kill: (pid, signal) => {
          if (denyGroup && pid < 0) throw errno("EPERM");
          return process.kill(pid, signal);
        },
      } });
      expect(result.timedOut).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.code === 0).toBe(false);
      const grandchild = Number(fs.readFileSync(pidFile, "utf8"));
      const group = Number(fs.readFileSync(groupFile, "utf8"));
      for (let i = 0; i < 50 && alive(grandchild, group); i++) await new Promise(r => setTimeout(r, 50));
      expect(alive(grandchild, group)).toBe(false);
    } finally {
      if (fs.existsSync(groupFile)) await killGroup(Number(fs.readFileSync(groupFile, "utf8")));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
