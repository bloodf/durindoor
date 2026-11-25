import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMMAND_TIMEOUT_MS, runSupervised } from "../__baseline__/run-ci.mjs";

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

describe("test:ci batched supervision", () => {
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

  it("kills the whole process group, including fork workers, at the ceiling", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-ci-supervise-"));
    const pidFile = path.join(dir, "grandchild.pid");
    try {
      const script = `const { spawn } = require("node:child_process");
        const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));
        setInterval(() => {}, 1000);`;
      const result = await runSupervised(process.execPath, ["-e", script], { timeoutMs: 1_000 });
      expect(result.timedOut).toBe(true);
      expect(result.code === 0).toBe(false);
      const grandchild = Number(fs.readFileSync(pidFile, "utf8"));
      for (let i = 0; i < 50 && alive(grandchild); i++) await new Promise(r => setTimeout(r, 50));
      expect(alive(grandchild)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
