import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import processScan from "../../cli/src/lib/processScan.js";

const { collectAppPids } = processScan;
const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-cli-launcher-"));
  tempDirs.push(dir);
  return dir;
}

describe("CLI launcher ownership", () => {
  it("selects only this install's cli.js running on appPort", () => {
    const root = tempDir();
    const install = path.join(root, "own", "node_modules", "durindoor");
    const otherInstall = path.join(root, "other", "node_modules", "9router");
    const unrelated = path.join(root, "durindoor-network", "scripts");
    for (const dir of [install, otherInstall, unrelated]) fs.mkdirSync(dir, { recursive: true });
    const ownCli = path.join(install, "cli.js");
    const otherCli = path.join(otherInstall, "cli.js");
    const unrelatedCli = path.join(unrelated, "foo", "cli.js");
    const otherServer = path.join(otherInstall, "app", "server.js");
    for (const file of [ownCli, otherCli, unrelatedCli, otherServer]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "// fixture");
    }
    const rows = [
      { pid: 1_001, command: `node ${ownCli} --port 20128` },
      { pid: 1_002, command: `node ${otherCli} --port 20200` },
      { pid: 1_003, command: `node ${unrelatedCli} --port 20128` },
      { pid: 1_004, command: `node ${otherServer} --port 20128` },
      { pid: 1_005, command: `node ${ownCli}` },
    ];
    const readCommand = (pid) => rows.find((row) => row.pid === pid)?.command ?? null;
    const options = { processes: rows, readCommand, exclude: new Set(), installDir: install, appPort: 20128 };
    expect(collectAppPids(options)).toEqual([1_001]);
    expect(collectAppPids({ ...options, appPort: undefined })).toEqual([]);
  });
});
