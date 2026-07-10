import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  publishLaunchAuthorization,
  waitForLaunchAuthorization,
} = require("../../src/mitm/launchGate.js");

describe("MITM pre-listen launch authorization", () => {
  let temp;
  let filePath;
  const nonce = "a".repeat(48);

  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-launch-gate-"));
    filePath = path.join(temp, ".launch.gate");
  });

  afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

  it("fsyncs the authorization file and directory before returning", () => {
    const fsyncSync = vi.fn(fs.fsyncSync.bind(fs));
    publishLaunchAuthorization(filePath, nonce, { ...fs, constants: fs.constants, fsyncSync });
    expect(fsyncSync).toHaveBeenCalledTimes(process.platform === "win32" ? 1 : 2);
    expect(fs.readFileSync(filePath, "utf8")).toBe(`${nonce}\n`);
  });

  it("rejects executable startup without manager authorization metadata", async () => {
    await expect(waitForLaunchAuthorization({
      filePath: null,
      nonce: null,
      managerPid: null,
    })).rejects.toThrow("authorization file is required");
  });

  it("consumes the exact nonce with compare-and-remove semantics", async () => {
    publishLaunchAuthorization(filePath, nonce);
    await expect(waitForLaunchAuthorization({
      filePath,
      nonce,
      managerPid: 42,
      processImpl: { kill: vi.fn() },
      timeoutMs: 100,
    })).resolves.toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("fails closed when the manager dies before authorization", async () => {
    await expect(waitForLaunchAuthorization({
      filePath,
      nonce,
      managerPid: 42,
      processImpl: { kill: () => { throw Object.assign(new Error("dead"), { code: "ESRCH" }); } },
      timeoutMs: 100,
    })).rejects.toThrow("manager exited");
  });

  it("rejects a mismatched nonce without deleting the evidence", async () => {
    publishLaunchAuthorization(filePath, "b".repeat(48));
    await expect(waitForLaunchAuthorization({
      filePath,
      nonce,
      managerPid: 42,
      processImpl: { kill: vi.fn() },
      timeoutMs: 100,
    })).rejects.toThrow("nonce mismatch");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("times out without authorizing a listener", async () => {
    await expect(waitForLaunchAuthorization({
      filePath,
      nonce,
      managerPid: 42,
      processImpl: { kill: vi.fn() },
      timeoutMs: 30,
    })).rejects.toThrow("timed out");
  });
});
