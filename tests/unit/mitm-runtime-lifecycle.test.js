import { describe, expect, it } from "vitest";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("MITM runtime lifecycle packaging", () => {
  it("restarts ordinary clean exits but recognizes only the reserved handoff code", () => {
    const { INTENTIONAL_HANDOFF_EXIT_CODE } = require("../../src/shared/constants/processExitCodes.js");
    const { isIntentionalWorkerHandoff } = require("../../cli/src/cli/workerExit.js");

    expect(isIntentionalWorkerHandoff(0, INTENTIONAL_HANDOFF_EXIT_CODE, false)).toBe(false);
    expect(isIntentionalWorkerHandoff(1, INTENTIONAL_HANDOFF_EXIT_CODE, false)).toBe(false);
    expect(isIntentionalWorkerHandoff(
      INTENTIONAL_HANDOFF_EXIT_CODE,
      INTENTIONAL_HANDOFF_EXIT_CODE,
      true,
    )).toBe(false);
    expect(isIntentionalWorkerHandoff(
      INTENTIONAL_HANDOFF_EXIT_CODE,
      INTENTIONAL_HANDOFF_EXIT_CODE,
      false,
    )).toBe(true);
  });
  it("imports the production manager without resolving its child entrypoint eagerly", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-manager-import-"));
    try {
      const managerPath = path.join(repoRoot, "src", "mitm", "manager.js");
      const output = childProcess.execFileSync(process.execPath, [
        "-e",
        `require(${JSON.stringify(managerPath)}); process.stdout.write("loaded")`,
      ], {
        cwd: tmp,
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "production",
          HOME: path.join(tmp, "home"),
          DATA_DIR: path.join(tmp, "data"),
          APPDATA: path.join(tmp, "appdata"),
        },
      });
      expect(output).toBe("loaded");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("copies the CLI worker handoff constant into the standalone runtime", () => {
    const buildScript = fs.readFileSync(path.join(repoRoot, "scripts", "build-app.mjs"), "utf8");
    expect(buildScript).toContain('"processExitCodes.js"');
    expect(buildScript).toContain("sharedConstantsDir");
  });

  it("canonicalizes relative DATA_DIR before the standalone server loads", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-data-dir-"));
    try {
      const wrapperPath = path.join(repoRoot, "custom-server.js");
      const output = childProcess.execFileSync(process.execPath, [
        "-e",
        `const wrapper=require(${JSON.stringify(wrapperPath)}); process.stdout.write(wrapper.canonicalizeRuntimePaths())`,
      ], {
        cwd: tmp,
        encoding: "utf8",
        env: { ...process.env, DATA_DIR: "./relative-data" },
      });
      expect(output).toBe(fs.realpathSync(path.join(tmp, "relative-data")));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("keeps the owner-aware wrapper dependency closure in CLI builds", () => {
    const buildMitm = fs.readFileSync(path.join(repoRoot, "cli/scripts/buildMitm.js"), "utf8");
    const buildCli = fs.readFileSync(path.join(repoRoot, "cli/scripts/build-cli.js"), "utf8");
    const cli = fs.readFileSync(path.join(repoRoot, "cli/cli.js"), "utf8");

    expect(buildMitm).toContain("cleanPlainFiles: false");
    expect(buildCli).toContain("copyRequiredStandaloneSidecars(appDir, cliAppDir)");
    expect(cli).toContain("owner-aware custom-server.js is missing");
    expect(cli).not.toContain(": path.join(standaloneDir, \"server.js\")");
    expect(cli).toContain('stdio: "ignore"');
    expect(JSON.parse(fs.readFileSync(path.join(repoRoot, "cli/package.json"), "utf8")).engines.node).toBe("20.20.2");
    expect(buildMitm).toContain('target: "node20"');
  });

  it("wires development WebSocket upgrades before loading Next", () => {
    const source = fs.readFileSync(path.join(repoRoot, "scripts/next-owner-server.cjs"), "utf8");
    expect(source).toContain('process.env.NODE_ENV = "development"');
    expect(source).toContain('server.on("upgrade", app.getUpgradeHandler())');
    expect(source).toContain("webpack: true");
    expect(source.indexOf('process.env.NODE_ENV = "development"')).toBeLessThan(source.indexOf('require("next")'));
  });

  it("lets the central MITM handler own process exit after DB signal flush", () => {
    for (const file of ["betterSqliteAdapter.js", "nodeSqliteAdapter.js", "bunSqliteAdapter.js"]) {
      const source = fs.readFileSync(path.join(repoRoot, "src/lib/db/adapters", file), "utf8");
      expect(source).not.toMatch(/SIG(?:INT|TERM)[\s\S]{0,100}process\.exit/);
      expect(source).toContain('process.once("SIGINT", onSignal)');
      expect(source).toContain('process.once("SIGTERM", onSignal)');
    }
  });
});
