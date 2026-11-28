// Synthetic procfs: protected environments must not require real credentials
// or non-dumpable processes, and no process is spawned or signalled.
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyProcess,
  readProcessIdentity,
  scanShardProcesses,
} from "../../scripts/lib/website-shard-server.mjs";

const euid = 1000;
const owner = "f".repeat(32);

function fixture({ ppid = 1, pgid = 300, session = 300 } = {}) {
  const specs = new Map([
    [200, { ppid: 1, pgid: 200, session: 200 }],
    [300, { ppid, pgid, session }],
    [301, { ppid: 200, pgid: 301, session: 301 }],
  ]);
  const readFile = (file) => {
    const pid = Number(path.basename(path.dirname(file)));
    const spec = specs.get(pid);
    if (!spec) throw Object.assign(new Error("gone"), { code: "ENOENT" });
    switch (path.basename(file)) {
      case "stat": {
        const fields = ["S", spec.ppid, spec.pgid, spec.session, 0, 0, 0, ...Array(12).fill(0), "100"];
        return `${pid} (ssh (protected)) ${fields.join(" ")}`;
      }
      case "status": return `Uid:\t${Array(4).fill(euid).join("\t")}\n`;
      case "environ": throw Object.assign(new Error("protected"), { code: "EACCES" });
      default: throw new Error(`unexpected file ${file}`);
    }
  };
  const processes = new Map([...specs.keys()].map((pid) =>
    [pid, readProcessIdentity(pid, "/fake-proc", { readFile })]));
  const serverIdentity = processes.get(200);
  return { readFile, processes, serverIdentity };
}

function classify(options) {
  const shard = fixture(options);
  return classifyProcess(shard.processes.get(300), owner, euid, shard);
}

describe("unrelated protected processes (#2715)", () => {
  it("classifies an unrelated same-uid process with unreadable environ as foreign", () => {
    expect(classify()).toMatchObject({
      verdict: "foreign", reason: "unrelated same-uid process with unreadable environ",
    });
    const shard = fixture();
    const result = scanShardProcesses(owner, {
      procRoot: "/fake-proc", euid, selfPid: 0, ...shard,
      readDirectory: () => ["200", "300", "301"],
    });
    expect(result.uncertain.map(({ pid }) => pid)).toEqual([200, 301]);
  });

  it.each([
    ["direct descendant", { ppid: 200 }],
    ["indirect descendant", { ppid: 301 }],
    ["process group peer", { pgid: 200 }],
    ["session peer", { session: 200 }],
    ["unreadable ancestor", { ppid: 999 }],
  ])("keeps a %s uncertain", (_name, options) => {
    expect(classify(options)).toMatchObject({ verdict: "uncertain", reason: "environ EACCES" });
  });

  it("stays fail-closed without the shard identity", () => {
    const shard = fixture();
    expect(classifyProcess(shard.processes.get(300), owner, euid).verdict).toBe("uncertain");
  });
});
