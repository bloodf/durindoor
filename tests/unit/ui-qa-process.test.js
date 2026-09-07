import { describe, expect, it, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { closeProcess } from "../e2e/process.mjs";

const live = [];

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function spawnReady(source) {
  const child = spawn(process.execPath, ["-e", source], { stdio: ["ignore", "pipe", "ignore"] });
  live.push(child);
  return new Promise((resolve, reject) => {
    const onData = (chunk) => { if (chunk.toString() === "ready\n") settle(resolve, child); };
    const onError = (error) => settle(reject, error);
    const settle = (fn, value) => {
      child.stdout.off("data", onData);
      child.off("error", onError);
      fn(value);
    };
    child.stdout.on("data", onData);
    child.once("error", onError);
  });
}

describe("closeProcess (tests/e2e/process.mjs)", () => {
  afterEach(async () => {
    for (const child of live.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(child.pid, "SIGKILL"); } catch { /* ignore */ }
      }
    }
  });

  it("treats default SIGTERM termination (exitCode null, signalCode SIGTERM) as stopped, PID actually dead", async () => {
    const child = await spawnReady("process.stdout.write('ready\\n'); setInterval(() => {}, 1e9)");

    await closeProcess(child, { timeoutMs: 1500 });

    // Node leaves exitCode null for signal termination and sets signalCode instead.
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBe("SIGTERM");
    expect(isAlive(child.pid)).toBe(false);
  });

  it("upgrades to SIGKILL when child ignores SIGTERM, PID actually dead after return", async () => {
    const child = await spawnReady("process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1e9)");

    await closeProcess(child, { timeoutMs: 300 });

    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBe("SIGKILL");
    expect(isAlive(child.pid)).toBe(false);
  });

  it("keeps bounded hung-child failure when the process never dies", async () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = () => true;

    await expect(closeProcess(child, { timeoutMs: 10 })).rejects.toThrow("server did not stop after SIGKILL");
  });
});
