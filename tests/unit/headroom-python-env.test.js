import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for Headroom's managed-venv Python discovery
 * (contract Module 5, items 1, 2, 3, 4, and part of 8).
 *
 * Every test mocks "node:child_process" (pythonEnv.js's exact import
 * specifier) at the OS boundary: no pip, no real interpreter spawn, no real
 * DATA_DIR (dataDir.js is mocked because merely importing it has the
 * side effect of mkdirSync-ing a real directory).
 *
 * Bug 1: the OLD findPython310() only accepted an interpreter that already
 * had `pip show headroom-ai` succeed, so a demonstrably-installed Python
 * reported as "not found" whenever headroom lived in a separate uv/pipx
 * tool venv (no pip visibility). pickVenvBasePython() must accept ANY
 * interpreter >= MIN_PYTHON and must never probe for headroom-ai at all.
 */

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFileSync: mocks.execFileSync }));
vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: "/tmp/headroom-pyenv-test-unused" }));

import { createDiagnostic } from "@/shared/utils/setupDiagnostics.js";
import { invalidateInterpreterCache, MIN_PYTHON, pickVenvBasePython } from "../../src/lib/headroom/pythonEnv.js";

afterEach(() => {
  mocks.execFileSync.mockReset();
  vi.restoreAllMocks();
  // Interpreter discovery is memoised for 60s so polled status endpoints do not
  // rescan; without this, one test's scan would answer the next one.
  invalidateInterpreterCache();
});

/**
 * Dispatches execFileSync calls the way pythonEnv.js issues them:
 *   which <cmd>            -> resolve a candidate to a path (throw = not found)
 *   <path> -c <script>     -> version + EXTERNALLY-MANAGED probe
 *   <path> -m venv <dir>   -> venv-creation probe
 * `entries[].resolvedPath` are deliberately fictitious/nonexistent paths so
 * fs.realpathSync() (never mocked here) always ENOENTs and falls back to the
 * raw path unchanged — deterministic on any machine, not coupled to what
 * Python happens to be really installed on the host running the test.
 */
function mockInterpreters(entries) {
  mocks.execFileSync.mockImplementation((cmd, args) => {
    if (cmd === "which") {
      const entry = entries.find((e) => e.command === args[0]);
      if (!entry) throw new Error(`which: ${args[0]}: not found`);
      return entry.resolvedPath;
    }
    const entry = entries.find((e) => e.resolvedPath === cmd);
    if (!entry) throw new Error(`unexpected execFileSync target: ${cmd}`);
    if (args[0] === "-c") {
      return JSON.stringify({ major: entry.major, minor: entry.minor, em: false });
    }
    if (args[0] === "-m" && args[1] === "venv") {
      if (entry.venvError) {
        const error = new Error("venv creation failed");
        error.stderr = Buffer.from(entry.venvError);
        throw error;
      }
      return "";
    }
    throw new Error(`unexpected execFileSync args for ${cmd}: ${JSON.stringify(args)}`);
  });
}

describe("pickVenvBasePython", () => {
  it("accepts an interpreter without headroom-ai installed as a venv base (bug 1)", () => {
    mockInterpreters([
      { command: "python3", resolvedPath: "/opt/durindoor-fixture/bin/python3", major: 3, minor: 14 },
    ]);

    const result = pickVenvBasePython();

    expect(result).toEqual({ command: "/opt/durindoor-fixture/bin/python3" });
    // The regression this guards: the OLD findPython310() shelled out to
    // `pip show headroom-ai` before accepting a candidate. Any call naming
    // pip/show/headroom-ai proves that false-negative gate is back.
    for (const [, args] of mocks.execFileSync.mock.calls) {
      expect(args.join(" ")).not.toMatch(/pip|show|headroom-ai/i);
    }
  });

  it("NO_SUPPORTED_PYTHON detail names every interpreter found, with version, and offers an install command", () => {
    mockInterpreters([
      { command: "python3", resolvedPath: "/opt/durindoor-fixture/python3-old/bin/python3", major: 3, minor: 9 },
    ]);

    let error;
    try {
      pickVenvBasePython();
    } catch (e) {
      error = e;
    }

    expect(error.code).toBe("NO_SUPPORTED_PYTHON");
    expect(error.diagnostic.detail).toBe(
      `below Python ${MIN_PYTHON.join(".")}: python3 3.9 (/opt/durindoor-fixture/python3-old/bin/python3)`,
    );
    expect(error.diagnostic.fixes.length).toBeGreaterThan(0);
    expect(error.diagnostic.fixes[0].command).toBe("sudo apt install -y python3");
  });

  it("PYTHON_USER_SCOPED_ONLY fires when the only supported interpreter is user-scoped and the process runs as root (bug 5)", () => {
    vi.spyOn(process, "getuid").mockReturnValue(0);
    const resolvedPath = "/home/durindoor-fixture-user/.local/share/uv/python/cpython-3.11.15-linux-x86_64-gnu/bin/python3.11";
    mockInterpreters([{ command: "python3.11", resolvedPath, major: 3, minor: 11 }]);

    let error;
    try {
      pickVenvBasePython();
    } catch (e) {
      error = e;
    }

    expect(error.code).toBe("PYTHON_USER_SCOPED_ONLY");
    expect(error.diagnostic.detail).toBe(`user-scoped, unusable by the service: python3.11 3.11 (${resolvedPath})`);
    expect(error.diagnostic.fixes.length).toBeGreaterThan(0);
  });

  it("VENV_TOOLS_MISSING is distinct from VENV_CREATE_FAILED and names the python3.X-venv package to install", () => {
    mockInterpreters([{
      command: "python3.12",
      resolvedPath: "/opt/durindoor-fixture/bin/python3.12",
      major: 3,
      minor: 12,
      venvError: "Error: Command '['/opt/durindoor-fixture/bin/python3.12', '-Im', 'ensurepip', '--upgrade']' returned non-zero exit status 1.",
    }]);
    let ensurepipError;
    try {
      pickVenvBasePython();
    } catch (e) {
      ensurepipError = e;
    }
    expect(ensurepipError.code).toBe("VENV_TOOLS_MISSING");
    expect(ensurepipError.code).not.toBe("NO_SUPPORTED_PYTHON");
    expect(ensurepipError.diagnostic.fixes[0].command).toBe("sudo apt install -y python3.12-venv");

    // Second scenario in the same test: discovery is memoised, so the cache
    // must be dropped or the ensurepip result above would answer again.
    invalidateInterpreterCache();
    mockInterpreters([{
      command: "python3.12",
      resolvedPath: "/opt/durindoor-fixture/bin/python3.12",
      major: 3,
      minor: 12,
      venvError: "OSError: [Errno 28] No space left on device",
    }]);
    let genericError;
    try {
      pickVenvBasePython();
    } catch (e) {
      genericError = e;
    }
    expect(genericError.code).toBe("VENV_CREATE_FAILED");
    expect(genericError.code).not.toBe("VENV_TOOLS_MISSING");
    expect(genericError.diagnostic.fixes.length).toBeGreaterThan(0);
  });
});

describe("createDiagnostic", () => {
  it("refuses to construct a diagnostic with an empty fixes array (contract item 8, universal guarantee)", () => {
    expect(() => createDiagnostic({ code: "X", summary: "s", detail: "d", fixes: [] })).toThrow(TypeError);
    expect(() => createDiagnostic({ code: "X", summary: "s", detail: "d", fixes: [{ label: "fix it" }] })).not.toThrow();
  });
});
