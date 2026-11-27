import { describe, expect, it, vi } from "vitest";
import path from "node:path";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
const { isDevinBinAvailable } = await import("../../open-sse/executors/devin-acp-stdio.js");

// In-memory filesystem; Windows paths compare case-insensitively like NTFS.
function fakeFs(entries, { win = true } = {}) {
  const norm = (p) => (win ? path.win32.normalize(p).toLowerCase() : p);
  const table = new Map(Object.entries(entries).map(([p, kind]) => [norm(p), kind]));
  const lookup = (p) => {
    const kind = table.get(norm(p));
    if (!kind) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
    return kind;
  };
  return {
    constants: { X_OK: 1 },
    existsSync: (p) => table.has(norm(p)),
    statSync: (p) => ({ isFile: () => lookup(p) !== "dir" }),
    accessSync: (p) => { if (lookup(p) !== "exec") throw Object.assign(new Error("EACCES"), { code: "EACCES" }); }
  };
}

const win = (env, entries, extra = {}) => isDevinBinAvailable({ platform: "win32", env, fs: fakeFs(entries), ...extra });
const PATH = "C:\\Windows\\System32;C:\\Tools";

describe("isDevinBinAvailable on Windows", () => {
  it("resolves a bare CLI_DEVIN_BIN through PATH and PATHEXT like cmd.exe", () => {
    expect(win({ CLI_DEVIN_BIN: "devin", PATH }, { "C:\\Tools\\devin.exe": "file" })).toBe(true);
    expect(win({ CLI_DEVIN_BIN: "devin", Path: PATH, PathExt: ".COM;.EXE" }, { "C:\\Tools\\devin.exe": "file" })).toBe(true);
    expect(win({ CLI_DEVIN_BIN: "devin", PATH: `"C:\\Program Files\\Devin";C:\\Tools` }, { "C:\\Program Files\\Devin\\devin.cmd": "file" })).toBe(true);
  });

  it("accepts names that already carry an executable extension, in any case", () => {
    expect(win({ CLI_DEVIN_BIN: "devin.exe", PATH }, { "C:\\Tools\\devin.exe": "file" })).toBe(true);
    expect(win({ CLI_DEVIN_BIN: "DEVIN.EXE", PATH, PATHEXT: ".com;.exe" }, { "C:\\Tools\\devin.exe": "file" })).toBe(true);
  });

  it("resolves directory-qualified paths with or without an extension", () => {
    const files = { "C:\\Tools\\devin.exe": "file" };
    expect(win({ CLI_DEVIN_BIN: "C:\\Tools\\devin", PATH: "" }, files)).toBe(true);
    expect(win({ CLI_DEVIN_BIN: "C:\\Tools\\devin.EXE", PATH: "" }, files)).toBe(true);
    expect(win({ CLI_DEVIN_BIN: "C:/Tools/devin", PATH: "" }, files)).toBe(true);
  });

  it("uses the default LOCALAPPDATA install when CLI_DEVIN_BIN is unset", () => {
    expect(win({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local", PATH: "" }, { "C:\\Users\\u\\AppData\\Local\\devin\\cli\\bin\\devin.exe": "file" })).toBe(true);
  });

  it("rejects files Windows would not launch and missing candidates", () => {
    expect(win({ CLI_DEVIN_BIN: "devin", PATH }, { "C:\\Tools\\devin": "file" })).toBe(false);
    expect(win({ CLI_DEVIN_BIN: "devin", PATH }, { "C:\\Tools\\devin.ps1": "file" })).toBe(false);
    expect(win({ CLI_DEVIN_BIN: "C:\\Tools\\devin.ps1", PATH }, { "C:\\Tools\\devin.ps1": "file" })).toBe(false);
    expect(win({ CLI_DEVIN_BIN: "C:\\Tools\\devin", PATH }, { "C:\\Tools\\devin": "file" })).toBe(false);
    expect(win({ CLI_DEVIN_BIN: "devin", PATH, PATHEXT: ".BAT;.CMD" }, { "C:\\Tools\\devin.exe": "file" })).toBe(false);
    expect(win({ CLI_DEVIN_BIN: "devin", PATH }, { "C:\\Tools\\devin.exe": "dir" })).toBe(false);
    expect(win({ CLI_DEVIN_BIN: "devin", PATH: "" }, { "C:\\Tools\\devin.exe": "file" })).toBe(false);
    expect(win({ CLI_DEVIN_BIN: "devin" }, { "C:\\Tools\\devin.exe": "file" })).toBe(false);
    expect(win({ CLI_DEVIN_BIN: "devin.exe", PATH: "C:\\Other" }, { "C:\\Tools\\devin.exe": "file" })).toBe(false);
  });

  it("keeps the agentic provider unavailable on Windows", () => {
    expect(win({ CLI_DEVIN_BIN: "C:\\Tools\\devin.exe", PATH }, { "C:\\Tools\\devin.exe": "file" }, { agentic: true })).toBe(false);
    expect(win({ CLI_DEVIN_BIN: "devin", PATH }, { "C:\\Tools\\devin.exe": "file" }, { agentic: true })).toBe(false);
  });

  it("never executes a candidate", () => {
    win({ CLI_DEVIN_BIN: "devin", PATH }, { "C:\\Tools\\devin.exe": "file" });
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("isDevinBinAvailable on POSIX (injected)", () => {
  const posix = (env, entries, extra = {}) => isDevinBinAvailable({ platform: "linux", env, fs: fakeFs(entries, { win: false }), ...extra });

  it("still requires an executable regular file and ignores PATHEXT", () => {
    expect(posix({ CLI_DEVIN_BIN: "devin", PATH: "/opt/bin" }, { "/opt/bin/devin": "exec" })).toBe(true);
    expect(posix({ CLI_DEVIN_BIN: "devin", PATH: "/opt/bin" }, { "/opt/bin/devin": "file" })).toBe(false);
    expect(posix({ CLI_DEVIN_BIN: "devin", PATH: "/opt/bin", PATHEXT: ".EXE" }, { "/opt/bin/devin.exe": "exec" })).toBe(false);
    expect(posix({ CLI_DEVIN_BIN: "/opt/bin/devin", PATH: "" }, { "/opt/bin/devin": "exec" }, { agentic: true })).toBe(true);
    expect(posix({ CLI_DEVIN_BIN: "devin", PATH: "/opt/bin" }, { "/opt/bin/devin": "exec" }, { agentic: true })).toBe(false);
  });
});
