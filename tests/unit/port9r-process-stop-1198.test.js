import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { killAppPids } = require("../../cli/src/lib/processScan.js");

describe.skipIf(process.platform === "win32")("stale app shutdown", () => {
  it("stops every target before killing any of them", async () => {
    const children = [spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]), spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"])];
    const calls = [];
    const originalKill = process.kill;
    process.kill = (pid, signal) => { calls.push([pid, signal]); return originalKill(pid, signal); };
    try {
      expect(killAppPids(children.map((child) => child.pid))).toBe(2);
      expect(calls).toEqual(children.map((child) => [child.pid, "SIGSTOP"]));
      await Promise.all(children.map((child) => new Promise((resolve) => child.once("exit", resolve))));
    } finally {
      process.kill = originalKill;
      for (const child of children) { try { originalKill(child.pid, "SIGKILL"); } catch {} }
    }
  });
});
