import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DATA_DIR = "/tmp/headroom-lifecycle-test";
const HEADROOM_DIR = `${DATA_DIR}/headroom`;
const VENV_PYTHON = `${HEADROOM_DIR}/venv/bin/python`;
const INSTALL_LOG = `${HEADROOM_DIR}/install.log`;
const VALID_EXTRAS = ["code", "ml"];

const mocks = vi.hoisted(() => ({
  fs: {
    closeSync: vi.fn(),
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    openSync: vi.fn(() => 17),
    readFileSync: vi.fn(() => ""),
    unlinkSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  spawn: vi.fn(),
  findHeadroomBinary: vi.fn(() => null),
  getInstalledHeadroomExtras: vi.fn(() => ({
    installed: true, version: "0.1.0", extras: { code: true, ml: false },
  })),
  ensureManagedVenv: vi.fn(),
  managedVenvBinary: vi.fn(() => null),
}));

vi.mock("fs", () => ({ default: mocks.fs, ...mocks.fs }));
vi.mock("child_process", () => ({ spawn: mocks.spawn }));
vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR }));
vi.mock("../../src/lib/headroom/detect.js", () => ({
  HEADROOM_COMPRESSION_EXTRAS: VALID_EXTRAS,
  findHeadroomBinary: mocks.findHeadroomBinary,
  getInstalledHeadroomExtras: mocks.getInstalledHeadroomExtras,
}));
vi.mock("../../src/lib/headroom/pythonEnv.js", () => ({
  ensureManagedVenv: mocks.ensureManagedVenv,
  managedVenvBinary: mocks.managedVenvBinary,
}));

const { installHeadroomExtras } = await import("../../src/lib/headroom/process.js");

function spawnThatExits(code) {
  return () => {
    const child = new EventEmitter();
    child.pid = 4321;
    child.kill = vi.fn();
    child.unref = vi.fn();
    setImmediate(() => child.emit("exit", code));
    return child;
  };
}

function spawnThatNeverExits() {
  const child = new EventEmitter();
  child.pid = 4321;
  child.kill = vi.fn();
  child.unref = vi.fn();
  return child;
}

function awaitSetupError(promise) {
  return promise.then(
    () => { throw new Error("expected a SetupError"); },
    (error) => error,
  );
}

beforeEach(() => {
  mocks.ensureManagedVenv.mockResolvedValue({
    python: VENV_PYTHON,
    binDir: `${HEADROOM_DIR}/venv/bin`,
    created: false,
  });
  mocks.fs.closeSync.mockClear();
  mocks.fs.openSync.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.fs.existsSync.mockImplementation(() => false);
  mocks.fs.readFileSync.mockReturnValue("");
});

describe("Headroom install lifecycle", () => {
  it("times out a wedged pip install, closes its log fd once, and escalates SIGKILL after grace", async () => {
    vi.useFakeTimers();
    const child = spawnThatNeverExits();
    mocks.spawn.mockReturnValue(child);

    const errorPromise = awaitSetupError(installHeadroomExtras(["code"]));
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    const error = await errorPromise;

    expect(error.code).toBe("INSTALL_TIMEOUT");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(mocks.fs.closeSync).toHaveBeenCalledTimes(1);
    expect(mocks.fs.closeSync).toHaveBeenCalledWith(17);

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("does not close the install log fd again when exit arrives after timeout settlement", async () => {
    vi.useFakeTimers();
    const child = spawnThatNeverExits();
    mocks.spawn.mockReturnValue(child);

    const errorPromise = awaitSetupError(installHeadroomExtras(["code"]));
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    await errorPromise;
    expect(mocks.fs.closeSync).toHaveBeenCalledTimes(1);

    child.emit("exit", 0);
    await Promise.resolve();
    expect(mocks.fs.closeSync).toHaveBeenCalledTimes(1);
  });

  it("serializes overlapping installs with one spawn", async () => {
    const child = spawnThatNeverExits();
    mocks.spawn.mockReturnValue(child);

    const first = installHeadroomExtras(["code"]);
    await Promise.resolve();
    await Promise.resolve();
    const second = installHeadroomExtras(["code"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);

    child.emit("exit", 0);
    const [firstResult, secondResult] = await Promise.allSettled([first, second]);
    expect(firstResult.status).toBe("fulfilled");
    if (secondResult.status === "fulfilled") {
      expect(secondResult.value).toEqual(firstResult.value);
    } else {
      expect(secondResult.reason.code).toBe("INSTALL_IN_PROGRESS");
    }
  });

  it("rejects unknown extras before spawning pip", async () => {
    const error = await awaitSetupError(installHeadroomExtras(["bogus"]));
    expect(error.code).toBe("UNKNOWN_EXTRA");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("redacts credentials and tokens from failed pip log tails", async () => {
    mocks.fs.readFileSync.mockReturnValue(
      "index https://user:secret@index.example/simple\n"
      + "token ABCDEFGHIJKLMNOPQRSTUVWXYZ123456\n"
      + "ok\n",
    );
    mocks.spawn.mockImplementation(spawnThatExits(1));

    const error = await awaitSetupError(installHeadroomExtras(["code"]));
    const tail = error.diagnostic.logTail;
    expect(tail).not.toContain("user:secret");
    expect(tail).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
    expect(tail).toContain("[redacted]");
  });


  it("refuses an ml install that cannot fit before pip downloads anything", async () => {
    // Observed on the real host: /tmp is a 4 GiB tmpfs, the ml extra needs about
    // 5.4 GiB in the venv alone, and the old code discovered this only after
    // downloading gigabytes and then reported "installation did not complete".
    mocks.fs.statfsSync = vi.fn(() => ({ bavail: 512, bsize: 1024 * 1024 })); // 512 MiB free
    mocks.ensureManagedVenv.mockResolvedValue({ python: VENV_PYTHON, binDir: `${HEADROOM_DIR}/venv/bin`, created: false });

    const error = await installHeadroomExtras(["ml"]).then(() => null, (e) => e);

    expect(error?.code).toBe("INSTALL_DISK_FULL");
    expect(error.diagnostic.detail).toContain("0.5 GiB");
    expect(error.diagnostic.fixes.some((fix) => fix.command?.includes("headroom-ai[proxy,code]"))).toBe(true);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("classifies an ENOSPC pip failure as INSTALL_DISK_FULL rather than a generic failure", async () => {
    mocks.fs.statfsSync = vi.fn(() => ({ bavail: 64 * 1024, bsize: 1024 * 1024 })); // plenty
    mocks.ensureManagedVenv.mockResolvedValue({ python: VENV_PYTHON, binDir: `${HEADROOM_DIR}/venv/bin`, created: false });
    mocks.fs.readFileSync.mockReturnValue("Using cached nvidia_cublas.whl (423.1 MB)\nERROR: Could not install packages due to an OSError: [Errno 28] No space left on device\n");
    mocks.spawn.mockImplementation(spawnThatExits(1));

    const error = await installHeadroomExtras(["code", "ml"]).then(() => null, (e) => e);

    expect(error?.code).toBe("INSTALL_DISK_FULL");
    expect(error.diagnostic.logTail).toContain("No space left on device");
    expect(error.diagnostic.fixes[0].command).toContain("df -h");
  });

  it("keeps pip's scratch space on the venv filesystem, not the system tmpfs", async () => {
    mocks.fs.statfsSync = vi.fn(() => ({ bavail: 64 * 1024, bsize: 1024 * 1024 }));
    mocks.ensureManagedVenv.mockResolvedValue({ python: VENV_PYTHON, binDir: `${HEADROOM_DIR}/venv/bin`, created: false });
    mocks.spawn.mockImplementation(spawnThatExits(0));

    await installHeadroomExtras(["code"]);

    const [, , options] = mocks.spawn.mock.calls[0];
    expect(options.env.TMPDIR).toBe(`${HEADROOM_DIR}/pip-tmp`);
    expect(options.env.PIP_CACHE_DIR).toContain(`${HEADROOM_DIR}/pip-tmp`);
  });
});
