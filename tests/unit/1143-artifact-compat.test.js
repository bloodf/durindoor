import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { validateArtifact } from "../../scripts/smoke-installed-artifact.mjs";

const require = createRequire(import.meta.url);
const { copyRequiredStandaloneSidecars } = require("../../cli/scripts/standaloneSidecars.js");
const root = fileURLToPath(new URL("../..", import.meta.url));
const tempDirs = [];

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-1143-"));
  tempDirs.push(dir);
  return dir;
}

function run(args, dir) {
  return spawnSync(process.execPath, args, {
    cwd: dir,
    env: { HOME: dir, USERPROFILE: dir, APPDATA: dir, DATA_DIR: path.join(dir, "data"), PATH: path.dirname(process.execPath) },
    encoding: "utf8",
    timeout: 10_000,
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("offline staged artifact compatibility (#1143)", () => {
  it("runs the staged CLI fast paths with a stubbed machine ID and an isolated data directory", () => {
    const dir = fixture();
    const cli = path.join(root, "cli");
    for (const name of ["cli.js", "package.json", "src"]) {
      fs.cpSync(path.join(cli, name), path.join(dir, name), { recursive: true });
    }
    const startup = path.join(dir, "app/src/lib/startup");
    fs.mkdirSync(startup, { recursive: true });
    fs.copyFileSync(path.join(root, "src/lib/startup/listenConfig.cjs"), path.join(startup, "listenConfig.cjs"));
    const updater = path.join(dir, "app/src/lib/updater");
    fs.mkdirSync(updater, { recursive: true });
    fs.copyFileSync(path.join(root, "src/lib/updater/dataDir.cjs"), path.join(updater, "dataDir.cjs"));
    const stub = path.join(dir, "node_modules", "node-machine-id");
    fs.mkdirSync(stub, { recursive: true });
    fs.writeFileSync(path.join(stub, "index.js"), "exports.machineIdSync = () => \"fixture\";");
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    for (const [flag, expected] of [["--help", "Usage:"], ["--version", pkg.version]]) {
      const result = run([path.join(dir, pkg.bin.durindoor), flag], dir);
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(expected);
      expect(result.stderr).toBe("");
    }
    expect(fs.readdirSync(path.join(dir, "data"))).toEqual([]);
  });

  it("loads copied standalone sidecars in Node and rejects a missing entry", () => {
    const dir = fixture();
    copyRequiredStandaloneSidecars(root, dir);
    const shared = path.join("src", "shared", "utils", "typeChecks.cjs");
    fs.mkdirSync(path.dirname(path.join(dir, shared)), { recursive: true });
    fs.copyFileSync(path.join(root, shared), path.join(dir, shared));
    const entry = path.join(dir, "custom-server.js");
    expect(validateArtifact(entry)).toBe(fs.realpathSync(dir));
    const probe = 'const g = require("./head-response-guard.cjs"); require("./web-login-host-boundary.cjs"); if (!g.isHeadRequest({method:"HEAD"})) process.exit(1)';
    const result = run(["-e", probe], dir);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    fs.unlinkSync(entry);
    expect(() => validateArtifact(entry)).toThrow();
  });
});
