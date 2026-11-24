import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  acquireSocketLock,
  createStartGate,
  readFileSnapshot,
  releaseSocketLock,
  replaceFileIfUnchanged,
  removeFileIfUnchanged,
} = require("../../src/mitm/startLock.js");

describe("MITM OS-backed startup lock", () => {
  const owners = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (owners.length > 0) {
      await releaseSocketLock(owners.pop()).catch(() => {});
    }
  });

  it("creates a private lockfile, reports contention, and is reusable after release", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-lock-"));
    const first = await acquireSocketLock({ port: "startup", directory });
    owners.push(first);

    expect(fs.statSync(first.filePath).mode & 0o777).toBe(0o600);
    await expect(acquireSocketLock({ port: "startup", directory })).rejects.toMatchObject({
      code: "MITM_START_IN_PROGRESS",
    });

    await releaseSocketLock(owners.pop());
    const second = await acquireSocketLock({ port: "startup", directory });
    owners.push(second);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("propagates non-contention filesystem failures", async () => {
    await expect(acquireSocketLock({
      port: "failure",
      directory: "/dev/null/impossible",
    })).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it("returns false when an already released lock is absent", async () => {
    await expect(releaseSocketLock({ filePath: "/dev/null/missing-lock" })).resolves.toBe(false);
  });
});

describe("MITM in-process operation gate", () => {
  it("rejects a concurrent start and resolves waiters after cleanup", async () => {
    let resolveStart;
    const pending = new Promise((resolve) => { resolveStart = resolve; });
    const release = vi.fn(() => Promise.resolve());
    const gate = createStartGate({
      acquire: vi.fn(() => Promise.resolve({ token: "owner" })),
      release,
    });

    const first = gate.run(() => pending);
    let idle = false;
    const idleWait = gate.waitForIdle().then(() => { idle = true; });
    await expect(gate.run(() => Promise.resolve("second"))).rejects.toMatchObject({
      code: "MITM_START_IN_PROGRESS",
    });
    expect(idle).toBe(false);

    resolveStart("started");
    await expect(first).resolves.toBe("started");
    await idleWait;
    expect(idle).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("serializes a stop-style operation with an active start", async () => {
    let resolveStart;
    const pending = new Promise((resolve) => { resolveStart = resolve; });
    const order = [];
    const gate = createStartGate({
      acquire: vi.fn(async () => ({ token: "owner" })),
      release: vi.fn(async () => { order.push("release"); }),
    });

    const start = gate.run(async () => {
      order.push("start");
      await pending;
      order.push("start-done");
    });
    const stop = gate.runAfterIdle(async () => { order.push("stop"); });
    await Promise.resolve();
    expect(order).toEqual(["start"]);

    resolveStart();
    await Promise.all([start, stop]);
    expect(order).toEqual(["start", "start-done", "release", "stop", "release"]);
  });

  it("makes an owned-lock release failure visible and invokes rollback", async () => {
    const cleanupFailure = new Error("release failed");
    const rollback = vi.fn(async () => {});
    const gate = createStartGate({
      acquire: async () => ({ token: "owner" }),
      release: async () => { throw cleanupFailure; },
      onCleanupError: rollback,
    });

    await expect(gate.run(async () => "started")).rejects.toBe(cleanupFailure);
    expect(rollback).toHaveBeenCalledWith(cleanupFailure);
    expect(gate.isStarting()).toBe(false);
  });
});

describe("MITM PID metadata snapshots", () => {
  it("does not remove a metadata replacement seen before cleanup", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-mitm-pid-"));
    const pidFile = path.join(tmpDir, ".mitm.pid");
    try {
      fs.writeFileSync(pidFile, "first");
      const snapshot = readFileSnapshot(pidFile);
      fs.unlinkSync(pidFile);
      fs.writeFileSync(pidFile, "replacement");
      expect(removeFileIfUnchanged(pidFile, snapshot)).toBe(false);
      expect(fs.readFileSync(pidFile, "utf8")).toBe("replacement");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("keeps the current record when atomic replacement fails", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-mitm-pid-"));
    const pidFile = path.join(tmpDir, ".mitm.pid");
    const replacement = path.join(tmpDir, ".mitm.pid.next");
    try {
      fs.writeFileSync(pidFile, "current");
      fs.writeFileSync(replacement, "next");
      const snapshot = readFileSnapshot(pidFile);
      const failure = new Error("injected rename failure");
      const fsImpl = new Proxy(fs, {
        get(target, property) {
          if (property === "renameSync") return () => { throw failure; };
          return Reflect.get(target, property);
        },
      });

      expect(() => replaceFileIfUnchanged(pidFile, snapshot, replacement, fsImpl)).toThrow(failure);
      expect(fs.readFileSync(pidFile, "utf8")).toBe("current");
      expect(fs.readFileSync(replacement, "utf8")).toBe("next");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("atomically replaces the current record", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-mitm-pid-"));
    const pidFile = path.join(tmpDir, ".mitm.pid");
    const replacement = path.join(tmpDir, ".mitm.pid.next");
    try {
      fs.writeFileSync(pidFile, "current");
      fs.writeFileSync(replacement, "next");
      const snapshot = readFileSnapshot(pidFile);

      expect(replaceFileIfUnchanged(pidFile, snapshot, replacement)).toBe(true);
      expect(fs.readFileSync(pidFile, "utf8")).toBe("next");
      expect(fs.existsSync(replacement)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
