import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { acquireSocketLock, releaseSocketLock } = require("../../src/mitm/startLock.js");

describe("MITM private lockfile (#2456)", () => {
  const dirs = [];
  const owners = [];
  afterEach(async () => {
    while (owners.length) await releaseSocketLock(owners.pop()).catch(() => {});
    while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
  });

  function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-mitm-lock-"));
    dirs.push(dir);
    return dir;
  }

  it("is independent of a listener on the former lock port", async () => {
    const listener = net.createServer();
    await new Promise((resolve, reject) => {
      listener.once("error", reject);
      listener.listen({ host: "127.0.0.1", port: 30000 }, resolve);
    });
    try {
      const owner = await acquireSocketLock({ port: "mitm-start", directory: tempDir() });
      owners.push(owner);
      expect(fs.existsSync(owner.filePath)).toBe(true);
    } finally {
      await new Promise((resolve) => listener.close(resolve));
    }
  });

  it("recovers a lockfile whose PID is gone", async () => {
    const directory = tempDir();
    const lockPath = path.join(directory, ".mitm-start.lock");
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 2147483647, startedAt: 1 }), { mode: 0o600 });
    const owner = await acquireSocketLock({ lockPath });
    owners.push(owner);
    expect(JSON.parse(fs.readFileSync(lockPath, "utf8")).pid).toBe(process.pid);
  });

  it("blocks a second acquisition while the owner PID is live", async () => {
    const directory = tempDir();
    const owner = await acquireSocketLock({ port: "root-ca", directory });
    owners.push(owner);
    await expect(acquireSocketLock({ port: "root-ca", directory })).rejects.toMatchObject({
      code: "MITM_START_IN_PROGRESS",
    });
  });
});
