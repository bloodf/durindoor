import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for Headroom extras, managed-binary selection, and
 * operator diagnostics (contract Module 5, items 5, 6, 7, and part of 8).
 *
 * Only the OS boundary is mocked: child_process, fs, and pythonEnv.js (which
 * itself shells out to real interpreters/venvs). detect.js and process.js
 * run for real, including process.js's real reuse of detect.js's
 * getInstalledHeadroomExtras/findHeadroomBinary — matching how they are
 * actually wired in production. No pip, no real interpreter spawn, no real
 * DATA_DIR (mocked to a fake path; fs itself is mocked so nothing is
 * ever written to disk).
 */

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn(),
  fs: {
    closeSync: vi.fn(),
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    openSync: vi.fn(() => 17),
    readFileSync: vi.fn(() => ""),
    unlinkSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  pythonEnv: {
    ensureManagedVenv: vi.fn(),
    managedVenvBinary: vi.fn(),
    managedVenvDir: vi.fn(() => "/tmp/headroom-extras-test/headroom/venv"),
    managedVenvPython: vi.fn(),
    pickVenvBasePython: vi.fn(),
    // detect.findPython310() resolves cheaply through this before ever reaching
    // the expensive picker.
    discoverInterpreters: vi.fn(() => []),
  },
}));

vi.mock("child_process", () => ({
  execFileSync: mocks.execFileSync,
  execSync: mocks.execSync,
  spawn: mocks.spawn,
}));
vi.mock("fs", () => ({ default: mocks.fs, ...mocks.fs }));
vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: "/tmp/headroom-extras-test" }));
vi.mock("../../src/lib/headroom/pythonEnv.js", () => mocks.pythonEnv);

import { getHeadroomStatus, getInstalledHeadroomExtras } from "../../src/lib/headroom/detect.js";
import { installHeadroomExtras, startHeadroomProxy } from "../../src/lib/headroom/process.js";

// Fake ChildProcess: fires "exit" via setImmediate so the real code's
// `child.once("exit", ...)` listener (registered synchronously right after
// spawn() returns) is attached before the event fires.
function spawnThatExits(code) {
  return () => {
    const child = new EventEmitter();
    child.pid = 4321;
    child.unref = vi.fn();
    setImmediate(() => child.emit("exit", code));
    return child;
  };
}

function readSetupError(promise) {
  return promise.then(
    () => { throw new Error("expected a SetupError"); },
    (error) => error,
  );
}

afterEach(() => {
  mocks.execFileSync.mockReset();
  mocks.execSync.mockReset();
  mocks.spawn.mockReset();
  mocks.fs.closeSync.mockReset();
  mocks.fs.existsSync.mockReset();
  mocks.fs.existsSync.mockReturnValue(false);
  mocks.fs.mkdirSync.mockReset();
  mocks.fs.openSync.mockReset();
  mocks.fs.openSync.mockReturnValue(17);
  mocks.fs.readFileSync.mockReset();
  mocks.fs.readFileSync.mockReturnValue("");
  mocks.fs.unlinkSync.mockReset();
  mocks.fs.writeFileSync.mockReset();
  for (const mock of Object.values(mocks.pythonEnv)) mock.mockReset();
  mocks.pythonEnv.managedVenvDir.mockReturnValue("/tmp/headroom-extras-test/headroom/venv");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getInstalledHeadroomExtras", () => {
  it("reports code and ml through importlib when pip is absent (bug 2)", () => {
    const python = "/tmp/headroom-extras-test/headroom/venv/bin/python";
    mocks.pythonEnv.managedVenvPython.mockReturnValue(python);
    mocks.execFileSync.mockImplementation((command, args) => {
      if (command === python && args[0] === "-c") {
        return JSON.stringify({ version: "0.36.1", extras: { code: true, ml: true } });
      }
      // A uv tool venv has no pip. The old implementation only took this
      // branch and returned false for both extras; it must never execute now.
      if (command === python && args[0] === "-m" && args[1] === "pip") {
        throw new Error("No module named pip");
      }
      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });

    const result = getInstalledHeadroomExtras();

    expect(result).toEqual({ installed: true, version: "0.36.1", extras: { code: true, ml: true } });
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      python,
      ["-c", expect.any(String)],
      expect.objectContaining({ timeout: 8000 }),
    );
    expect(mocks.execFileSync.mock.calls.some(([, args]) => args[0] === "-m" && args[1] === "pip")).toBe(false);
  });
});

describe("managed Headroom binary selection", () => {
  it("uses the managed venv binary before PATH and reports source as managed (bug 4)", async () => {
    const managed = "/tmp/headroom-extras-test/headroom/venv/bin/headroom";
    const python = "/tmp/headroom-extras-test/headroom/venv/bin/python";
    mocks.pythonEnv.managedVenvBinary.mockReturnValue(managed);
    mocks.pythonEnv.managedVenvPython.mockReturnValue(python);
    mocks.execFileSync.mockReturnValue(JSON.stringify({ version: "0.36.1", extras: { code: true, ml: true } }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const status = await getHeadroomStatus("http://127.0.0.1:8787");

    expect(status).toMatchObject({ path: managed, source: "managed", installed: true, diagnostic: null });
    // Proves managed precedence, not merely that a source field exists:
    // PATH lookup (`which headroom`, via execSync) must not run when the
    // managed binary is available.
    expect(mocks.execSync).not.toHaveBeenCalled();
  });

  it("NOT_INSTALLED exposes an actionable diagnostic rather than a bare path failure", async () => {
    mocks.pythonEnv.managedVenvBinary.mockReturnValue(null);
    mocks.pythonEnv.managedVenvPython.mockReturnValue(null);
    mocks.pythonEnv.pickVenvBasePython.mockReturnValue({ command: "/opt/durindoor-fixture/bin/python3" });
    mocks.execSync.mockImplementation(() => { throw new Error("headroom missing"); });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const status = await getHeadroomStatus("http://127.0.0.1:8787");

    expect(status.diagnostic.code).toBe("NOT_INSTALLED");
    expect(status.diagnostic.fixes.length).toBeGreaterThan(0);
    expect(status.diagnostic.fixes[0].command).toContain("POST /api/headroom/extras");
  });
});

describe("installHeadroomExtras diagnostics", () => {
  it("preserves failed pip output and classifies generic failures versus unavailable extra wheels", async () => {
    const python = "/tmp/headroom-extras-test/headroom/venv/bin/python";
    mocks.pythonEnv.ensureManagedVenv.mockResolvedValue({ python, binDir: "/tmp/headroom-extras-test/headroom/venv/bin", created: false });

    mocks.fs.readFileSync.mockReturnValue("Collecting headroom-ai\nnetwork timeout while downloading dependency\n");
    mocks.spawn.mockImplementation(spawnThatExits(1));
    const installFailure = await readSetupError(installHeadroomExtras(["code", "ml"]));

    expect(installFailure.code).toBe("INSTALL_FAILED");
    expect(installFailure.diagnostic.logTail).toContain("network timeout");
    expect(installFailure.diagnostic.fixes[0].command).toContain(python);
    expect(mocks.spawn).toHaveBeenCalledWith(
      python,
      ["-m", "pip", "install", "--upgrade", "headroom-ai[proxy,code,ml]"],
      expect.any(Object),
    );

    mocks.fs.readFileSync.mockReturnValue("ERROR: No matching distribution found for tree-sitter-language-pack\n");
    mocks.execFileSync.mockReturnValue("3.14\n");
    mocks.spawn.mockImplementation(spawnThatExits(1));
    const unavailableWheel = await readSetupError(installHeadroomExtras(["code", "ml"]));

    expect(unavailableWheel.code).toBe("EXTRA_WHEEL_UNAVAILABLE");
    expect(unavailableWheel.diagnostic.detail).toContain("Python 3.14");
    expect(unavailableWheel.diagnostic.logTail).toContain("No matching distribution");
    expect(unavailableWheel.diagnostic.fixes[0].command).toContain("python3.13-venv");
  });

  it("PEP668 explains the managed venv was bypassed and supplies a repair command", async () => {
    const python = "/tmp/headroom-extras-test/headroom/venv/bin/python";
    mocks.pythonEnv.ensureManagedVenv.mockResolvedValue({ python, binDir: "/tmp/headroom-extras-test/headroom/venv/bin", created: false });
    mocks.fs.readFileSync.mockReturnValue("error: externally-managed-environment\nThis environment is externally managed\n");
    mocks.spawn.mockImplementation(spawnThatExits(1));

    const error = await readSetupError(installHeadroomExtras(["code"]));

    expect(error.code).toBe("PEP668");
    expect(error.diagnostic.logTail).toContain("externally-managed-environment");
    expect(error.diagnostic.fixes[0].command).toContain("rm -rf");
  });
});

describe("startHeadroomProxy diagnostics", () => {
  it("EARLY_EXIT includes the proxy log tail and a copy-paste inspection command", async () => {
    const managed = "/tmp/headroom-extras-test/headroom/venv/bin/headroom";
    mocks.pythonEnv.managedVenvBinary.mockReturnValue(managed);
    mocks.fs.existsSync.mockImplementation((target) => String(target).includes("proxy.log"));
    mocks.fs.readFileSync.mockReturnValue("headroom crashed: malformed config\n");
    mocks.spawn.mockImplementation(spawnThatExits(2));

    const error = await readSetupError(startHeadroomProxy());

    expect(error.code).toBe("EARLY_EXIT");
    expect(error.diagnostic.logTail).toContain("malformed config");
    expect(error.diagnostic.fixes[0].command).toContain("tail -n 40");
  });
});
