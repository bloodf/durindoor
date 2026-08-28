import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  fs: {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    openSync: vi.fn(() => 17),
    closeSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

vi.mock("child_process", () => ({ spawn: mocks.spawn }));
vi.mock("fs", () => ({ default: mocks.fs, ...mocks.fs }));
vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: "/tmp/headroom-process-test" }));
vi.mock("../../src/lib/headroom/pythonEnv.js", () => ({
  ensureManagedVenv: vi.fn(async () => ({ python: "/usr/bin/python3" })),
  managedVenvBinary: vi.fn(() => null),
}));
vi.mock("../../src/lib/headroom/detect.js", () => ({
  findHeadroomBinary: vi.fn(() => "/usr/bin/headroom"),
  findPython310: vi.fn(),
  HEADROOM_COMPRESSION_EXTRAS: ["code", "ml"],
  getInstalledHeadroomExtras: vi.fn(),
}));

import { installHeadroomExtras, startHeadroomProxy, stopHeadroomProxy } from "../../src/lib/headroom/process.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fs.existsSync.mockReset().mockReturnValue(false);
  mocks.fs.readFileSync.mockReset();
  mocks.fs.openSync.mockReset().mockReturnValue(17);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mocks.spawn.mockReset();
});

describe("startHeadroomProxy", () => {
  it("disables Kompress by default", async () => {
    vi.useFakeTimers();
    vi.spyOn(process, "kill").mockImplementation(() => true);
    const child = new EventEmitter();
    child.pid = 1234;
    child.unref = vi.fn();
    mocks.spawn.mockReturnValue(child);

    const started = startHeadroomProxy();
    await vi.advanceTimersByTimeAsync(8000);
    await started;

    expect(mocks.spawn).toHaveBeenCalledWith(
      "/usr/bin/headroom",
      ["proxy", "--port", "8787", "--disable-kompress"],
      expect.any(Object),
    );
  });

  it("closes the log fd when spawn throws synchronously", async () => {
    mocks.spawn.mockImplementation(() => { throw new Error("sync spawn failure"); });

    await expect(startHeadroomProxy()).rejects.toMatchObject({ code: "SPAWN_FAILED" });
    expect(mocks.fs.closeSync).toHaveBeenCalledWith(17);
  });

  it("settles once when the child errors during startup", async () => {
    vi.useFakeTimers();
    const child = new EventEmitter();
    child.pid = 1234;
    child.unref = vi.fn();
    mocks.spawn.mockReturnValue(child);

    const started = startHeadroomProxy();
    child.emit("error", Object.assign(new Error("spawn error"), { code: "EACCES" }));

    await expect(started).rejects.toMatchObject({ code: "EACCES" });
    await vi.advanceTimersByTimeAsync(8000);
    expect(mocks.fs.closeSync).toHaveBeenCalledTimes(1);
  });

  it("does not clear a newer PID owner after a successful child's late exit", async () => {
    vi.useFakeTimers();
    const child = new EventEmitter();
    child.pid = 1234;
    child.unref = vi.fn();
    mocks.spawn.mockReturnValue(child);
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (signal === 0 && pid !== 1234) throw new Error("dead");
      return true;
    });
    mocks.fs.existsSync.mockImplementation((file) => String(file).endsWith("proxy.pid"));
    mocks.fs.readFileSync.mockReturnValue("9999");

    const started = startHeadroomProxy();
    await vi.advanceTimersByTimeAsync(8000);
    await started;
    child.emit("exit", 0);

    expect(mocks.fs.unlinkSync).not.toHaveBeenCalled();
  });
});

describe("stopHeadroomProxy", () => {
  it("awaits death before clearing its owned PID", async () => {
    vi.useFakeTimers();
    let alive = true;
    mocks.fs.existsSync.mockImplementation((file) => String(file).endsWith("proxy.pid"));
    mocks.fs.readFileSync.mockReturnValue("5555");
    vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      if (signal === 0 && !alive) throw new Error("dead");
      return true;
    });

    const stopped = stopHeadroomProxy();
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.fs.unlinkSync).not.toHaveBeenCalled();
    alive = false;
    await vi.advanceTimersByTimeAsync(100);

    await expect(stopped).resolves.toEqual({ stopped: true, pid: 5555 });
    expect(mocks.fs.unlinkSync).toHaveBeenCalledTimes(1);
  });

  it("escalates TERM to KILL", async () => {
    vi.useFakeTimers();
    let alive = true;
    mocks.fs.existsSync.mockImplementation((file) => String(file).endsWith("proxy.pid"));
    mocks.fs.readFileSync.mockReturnValue("6666");
    const kill = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      if (signal === "SIGKILL") alive = false;
      if (signal === 0 && !alive) throw new Error("dead");
      return true;
    });

    const stopped = stopHeadroomProxy();
    await vi.advanceTimersByTimeAsync(2200);

    await expect(stopped).resolves.toEqual({ stopped: true, pid: 6666 });
    expect(kill).toHaveBeenCalledWith(6666, "SIGKILL");
  });

  it("keeps the PID file when death is never observed", async () => {
    vi.useFakeTimers();
    mocks.fs.existsSync.mockImplementation((file) => String(file).endsWith("proxy.pid"));
    mocks.fs.readFileSync.mockReturnValue("7777");
    vi.spyOn(process, "kill").mockImplementation(() => true);

    const stopped = stopHeadroomProxy();
    const rejection = expect(stopped).rejects.toMatchObject({ code: "STOP_FAILED" });
    await vi.advanceTimersByTimeAsync(4000);

    await rejection;
    expect(mocks.fs.unlinkSync).not.toHaveBeenCalled();
  });

  it("does not delete a PID file rewritten during stop", async () => {
    vi.useFakeTimers();
    let owner = "8888";
    let alive = true;
    mocks.fs.existsSync.mockImplementation((file) => String(file).endsWith("proxy.pid"));
    mocks.fs.readFileSync.mockImplementation(() => owner);
    vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      if (signal === 0 && !alive) throw new Error("dead");
      return true;
    });

    const stopped = stopHeadroomProxy();
    owner = "9999";
    alive = false;
    await vi.advanceTimersByTimeAsync(100);

    await expect(stopped).resolves.toEqual({ stopped: true, pid: 8888 });
    expect(mocks.fs.unlinkSync).not.toHaveBeenCalled();
  });
});

describe("installHeadroomExtras", () => {
  it("closes the install log fd when spawn throws synchronously", async () => {
    mocks.spawn.mockImplementation(() => { throw new Error("sync install spawn failure"); });

    await expect(installHeadroomExtras(["code"])).rejects.toThrow("sync install spawn failure");
    expect(mocks.fs.closeSync).toHaveBeenCalledWith(17);
  });
});
