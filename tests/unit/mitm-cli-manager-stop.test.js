import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { stopMitmViaManagerSync } = require("../../cli/src/cli/mitmManagerStop.js");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("CLI MITM manager shutdown", () => {
  it("requests manager-owned cleanup without putting credentials in argv", () => {
    const execFile = vi.fn();
    expect(stopMitmViaManagerSync(20128, {
      execFile,
      nodePath: "/trusted/node",
      cliToken: "fixture-cli-token",
    })).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0][0]).toBe("/trusted/node");
    expect(execFile.mock.calls[0][1].join(" ")).not.toContain("20128");
    expect(execFile.mock.calls[0][1].join(" ")).not.toContain("fixture-cli-token");
    expect(JSON.parse(execFile.mock.calls[0][2].input)).toEqual({
      port: 20128,
      token: "fixture-cli-token",
      preserveDesiredState: true,
    });
    expect(execFile.mock.calls[0][2].timeout).toBe(370000);
    const managerScript = execFile.mock.calls[0][1][1];
    expect(managerScript).toContain("req.setTimeout(360000");
  });

  it("fails closed when manager cleanup cannot be confirmed", () => {
    const execFile = vi.fn(() => { throw new Error("manager unavailable"); });
    expect(stopMitmViaManagerSync(20128, { execFile, cliToken: "fixture-cli-token" })).toBe(false);
  });

  it("restarts after an unexpected clean app-worker exit instead of orphaning MITM", () => {
    const cliSource = fs.readFileSync(path.join(repoRoot, "cli", "cli.js"), "utf8");
    const closeHandler = cliSource.slice(
      cliSource.indexOf('server.on("close"'),
      cliSource.indexOf("function tryRestart"),
    );
    expect(closeHandler).toContain("tryRestart(code || 1)");
    expect(closeHandler).not.toContain("code === 0");
    expect(cliSource).toMatch(/if\s*\(!cleanup\(\)\)\s*\{/);
  });
});
