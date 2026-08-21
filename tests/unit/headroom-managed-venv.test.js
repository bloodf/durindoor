import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const DATA_DIR = "/tmp/headroom-managed-venv-test";
const VENV_DIR = path.join(DATA_DIR, "headroom", "venv");
const VENV_PYTHON = path.join(VENV_DIR, "bin", "python");
const BASE_PYTHON = "/usr/bin/python3.13";
const currentUid = typeof process.getuid === "function" ? process.getuid() : 0;

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  fs: {
    existsSync: vi.fn(() => false),
    lstatSync: vi.fn(),
    mkdirSync: vi.fn(),
    mkdtempSync: vi.fn(() => "/tmp/durindoor-venv-probe-test"),
    realpathSync: vi.fn((value) => value),
    rmSync: vi.fn(),
    statSync: vi.fn(),
  },
}));

vi.mock("node:child_process", () => ({ execFileSync: mocks.execFileSync }));
vi.mock("node:fs", () => ({ default: mocks.fs, ...mocks.fs }));
vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR }));

const pythonEnv = await import("../../src/lib/headroom/pythonEnv.js");

function trustedInterpreter() {
  return { uid: currentUid, mode: 0o100755 };
}

function setupExistingVenv(stat = trustedInterpreter()) {
  mocks.fs.existsSync.mockImplementation((value) => value === VENV_PYTHON);
  mocks.fs.statSync.mockReturnValue(stat);
  mocks.fs.lstatSync.mockReturnValue(stat);
}

afterEach(() => {
  pythonEnv.invalidateInterpreterCache();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.fs.existsSync.mockImplementation(() => false);
  mocks.fs.realpathSync.mockImplementation((value) => value);
});

describe("managed Headroom virtual environment", () => {
  it("reuses an existing trusted managed venv without spawning python -m venv", () => {
    setupExistingVenv();

    expect(pythonEnv.ensureManagedVenv()).toEqual({
      python: VENV_PYTHON,
      binDir: path.dirname(VENV_PYTHON),
      created: false,
    });
    expect(mocks.execFileSync).not.toHaveBeenCalledWith(
      expect.any(String),
      ["-m", "venv", VENV_DIR],
      expect.any(Object),
    );
  });

  it("rejects managed venv interpreters owned by another uid or writable by group or others", () => {
    for (const stat of [
      { uid: currentUid + 1, mode: 0o100755 },
      { uid: currentUid, mode: 0o100775 },
    ]) {
      vi.clearAllMocks();
      setupExistingVenv(stat);

      expect(() => pythonEnv.ensureManagedVenv()).toThrow(expect.objectContaining({
        code: "VENV_UNTRUSTED",
        diagnostic: expect.objectContaining({ fixes: expect.any(Array) }),
      }));
      try {
        pythonEnv.ensureManagedVenv();
      } catch (error) {
        expect(error.diagnostic.fixes.length).toBeGreaterThan(0);
      }
    }
  });

  it("preserves a pre-existing venv on creation failure and removes only a venv created by this call", () => {
    // Explicit dispatcher: `which` must return a real-looking path, the version
    // probe must return the JSON shape, the throwaway capability probe must
    // SUCCEED, and only the real creation into VENV_DIR may fail. A generic
    // catch-all mock makes pickVenvBasePython throw first, and the cleanup
    // assertion then passes vacuously against the wrong error.
    const dispatch = ({ failRealCreate }) => (command, args) => {
      if (command === "which" || command === "where") return Buffer.from(`${BASE_PYTHON}\n`);
      if (args?.[0] === "-c") return Buffer.from('{"major":3,"minor":13,"em":false}');
      if (args?.[0] === "-m" && args?.[1] === "venv") {
        if (args[2] === VENV_DIR && failRealCreate) throw new Error("venv creation failed");
        return Buffer.from("");
      }
      return Buffer.from("");
    };

    // Case 1: the venv directory already exists -> a failed create must NOT delete it.
    mocks.fs.existsSync.mockImplementation((value) => value === VENV_DIR);
    mocks.execFileSync.mockImplementation(dispatch({ failRealCreate: true }));

    const preExisting = (() => { try { pythonEnv.ensureManagedVenv(); return null; } catch (e) { return e; } })();
    expect(preExisting?.code).toBe("VENV_CREATE_FAILED");
    expect(mocks.fs.rmSync).not.toHaveBeenCalledWith(VENV_DIR, expect.any(Object));

    // Case 2: nothing existed beforehand -> the partial venv this call made is removed.
    pythonEnv.invalidateInterpreterCache();
    vi.clearAllMocks();
    mocks.fs.existsSync.mockImplementation(() => false);
    mocks.fs.realpathSync.mockImplementation((value) => value);
    mocks.execFileSync.mockImplementation(dispatch({ failRealCreate: true }));

    const created = (() => { try { pythonEnv.ensureManagedVenv(); return null; } catch (e) { return e; } })();
    expect(created?.code).toBe("VENV_CREATE_FAILED");
    expect(mocks.fs.rmSync).toHaveBeenCalledWith(VENV_DIR, { recursive: true, force: true });
  });

  it("creates the managed venv parent with mode 0700", () => {
    let created = false;
    mocks.fs.existsSync.mockImplementation((value) => value === VENV_PYTHON && created);
    mocks.fs.statSync.mockReturnValue(trustedInterpreter());
    mocks.fs.lstatSync.mockReturnValue(trustedInterpreter());
    mocks.execFileSync.mockImplementation((command, args) => {
      if (args?.[0] === "-m" && args?.[1] === "venv") {
        created = true;
        return Buffer.from("");
      }
      return Buffer.from('{"major":3,"minor":13,"em":false}');
    });

    pythonEnv.ensureManagedVenv();

    expect(mocks.fs.mkdirSync).toHaveBeenCalledWith(path.dirname(VENV_DIR), {
      recursive: true,
      mode: 0o700,
    });
  });

  it("invalidates interpreter discovery after successful managed venv creation", () => {
    let created = false;
    mocks.fs.existsSync.mockImplementation(() => false);
    mocks.fs.statSync.mockReturnValue(trustedInterpreter());
    mocks.fs.lstatSync.mockReturnValue(trustedInterpreter());
    mocks.execFileSync.mockImplementation((command, args) => {
      if (command === BASE_PYTHON && args?.[0] === "-m" && args?.[1] === "venv" && args?.[2] === VENV_DIR) {
        created = true;
        return Buffer.from("");
      }
      if (args?.[0] === "-m" && args?.[1] === "venv") {
        return Buffer.from("");
      }
      if (command === "which" || command === "where") {
        return Buffer.from(`${BASE_PYTHON}\n`);
      }
      return Buffer.from('{"major":3,"minor":13,"em":false}');
    });

    pythonEnv.pickVenvBasePython();
    vi.clearAllMocks();
    mocks.fs.existsSync.mockImplementation((value) => value === VENV_PYTHON && created);
    mocks.fs.statSync.mockReturnValue(trustedInterpreter());
    mocks.fs.lstatSync.mockReturnValue(trustedInterpreter());
    mocks.execFileSync.mockImplementation((command, args) => {
      if (command === BASE_PYTHON && args?.[0] === "-m" && args?.[1] === "venv" && args?.[2] === VENV_DIR) {
        created = true;
        return Buffer.from("");
      }
      if (args?.[0] === "-m" && args?.[1] === "venv") {
        return Buffer.from("");
      }
      if (command === "which" || command === "where") {
        return Buffer.from(`${BASE_PYTHON}\n`);
      }
      return Buffer.from('{"major":3,"minor":13,"em":false}');
    });

    pythonEnv.ensureManagedVenv();
    expect(created).toBe(true);

    vi.clearAllMocks();
    mocks.execFileSync.mockImplementation((command) => {
      if (command === "which" || command === "where") {
        return Buffer.from(`${BASE_PYTHON}\n`);
      }
      return Buffer.from('{"major":3,"minor":13,"em":false}');
    });

    pythonEnv.discoverInterpreters();

    const resolverCalls = mocks.execFileSync.mock.calls.filter(
      ([command]) => command === "which" || command === "where",
    );
    expect(resolverCalls.length).toBeGreaterThan(0);
  });
});
