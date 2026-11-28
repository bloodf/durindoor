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
const shardCgroup = "0::/user.slice/user-1000.slice/session-1.scope\n";
const otherCgroup = "0::/user.slice/user-1000.slice/other.scope\n";

// The server (200) starts at 100. pid 300 defaults to a reparented process
// (ppid 1, own group and session) that started with the server in its cgroup.
function fixture({
  ppid = 1, pgid = 300, session = 300, startTime = "100", cgroup = shardCgroup, serverCgroup = shardCgroup,
} = {}) {
  const specs = new Map([
    [200, { ppid: 1, pgid: 200, session: 200, startTime: "100", cgroup: serverCgroup }],
    [300, { ppid, pgid, session, startTime, cgroup }],
    [301, { ppid: 200, pgid: 301, session: 301, startTime: "100", cgroup: shardCgroup }],
  ]);
  const readFile = (file) => {
    const pid = Number(path.basename(path.dirname(file)));
    const spec = specs.get(pid);
    if (!spec) throw Object.assign(new Error("gone"), { code: "ENOENT" });
    switch (path.basename(file)) {
      case "stat": {
        const fields = ["S", spec.ppid, spec.pgid, spec.session, 0, 0, 0, ...Array(12).fill(0), spec.startTime];
        return `${pid} (ssh (protected)) ${fields.join(" ")}`;
      }
      case "status": return `Uid:\t${Array(4).fill(euid).join("\t")}\n`;
      case "environ": throw Object.assign(new Error("protected"), { code: "EACCES" });
      case "cgroup":
        if (spec.cgroup === null) throw Object.assign(new Error("protected"), { code: "EACCES" });
        return spec.cgroup;
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

function scanUncertain(options) {
  const shard = fixture(options);
  const result = scanShardProcesses(owner, {
    procRoot: "/fake-proc", euid, selfPid: 0, ...shard,
    readDirectory: () => ["200", "300", "301"],
  });
  return result.uncertain.map(({ pid }) => pid);
}

describe("unrelated protected processes (#2715)", () => {
  it.each([
    ["started before the server", { startTime: "99" }],
    ["started before the server with an unreadable cgroup", { startTime: "99", cgroup: null }],
    ["in a different, readable cgroup", { startTime: "150", cgroup: otherCgroup }],
  ])("classifies a same-uid process with unreadable environ %s as foreign", (_name, options) => {
    expect(classify(options)).toMatchObject({
      verdict: "foreign", reason: "unrelated same-uid process with unreadable environ",
    });
    expect(scanUncertain(options)).toEqual([200, 301]);
  });

  it.each([
    ["reparented process started with the server", {}],
    ["reparented process started after the server", { startTime: "150" }],
    ["reparented process with an unreadable cgroup", { startTime: "150", cgroup: null }],
    ["reparented process when the server cgroup is unreadable", { startTime: "150", cgroup: otherCgroup, serverCgroup: null }],
    ["direct descendant", { ppid: 200 }],
    ["indirect descendant", { ppid: 301 }],
    ["process group peer", { pgid: 200 }],
    ["session peer", { session: 200 }],
    ["unreadable ancestor", { ppid: 999 }],
  ])("keeps a %s uncertain", (_name, options) => {
    expect(classify(options)).toMatchObject({ verdict: "uncertain", reason: "environ EACCES" });
  });

  it("reports a reparented setsid descendant as uncertain in a scan", () => {
    expect(scanUncertain()).toEqual([200, 300, 301]);
    expect(scanUncertain({ startTime: "150" })).toEqual([200, 300, 301]);
  });

  it("stays fail-closed without the shard identity", () => {
    const shard = fixture({ startTime: "99", cgroup: otherCgroup });
    expect(classifyProcess(shard.processes.get(300), owner, euid).verdict).toBe("uncertain");
  });
});
