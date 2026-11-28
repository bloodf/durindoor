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
    realpathSync: (p) => p,
    existsSync: (p) => table.has(norm(p)),
    statSync: (p) => ({ isFile: () => lookup(p) !== "dir", isDirectory: () => lookup(p) === "dir" }),
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

  it("accepts explicitly named .exe/.com/.bat/.cmd paths even when PATHEXT omits their extension", () => {
    const narrow = { PATH: "", PATHEXT: ".BAT;.CMD" };
    expect(win({ ...narrow, CLI_DEVIN_BIN: "C:\\Tools\\devin.exe" }, { "C:\\Tools\\devin.exe": "file" })).toBe(true);
    expect(win({ ...narrow, CLI_DEVIN_BIN: "C:/Tools/DEVIN.EXE" }, { "C:\\Tools\\devin.exe": "file" })).toBe(true);
    expect(win({ ...narrow, CLI_DEVIN_BIN: "\\\\server\\share\\devin.com" }, { "\\\\server\\share\\devin.com": "file" })).toBe(true);
    expect(win({ PATH: "", PATHEXT: ".EXE", CLI_DEVIN_BIN: "C:\\Tools\\devin.cmd" }, { "C:\\Tools\\devin.cmd": "file" })).toBe(true);
    expect(win({ ...narrow, CLI_DEVIN_BIN: ".\\bin\\devin.exe" }, { "bin\\devin.exe": "file" })).toBe(true);
  });

  it("finds a bare name with .exe/.com/.bat/.cmd on PATH even when PATHEXT omits its extension", () => {
    // cmd searches each PATH directory for the exact file name when the command includes an extension.
    const narrow = { PATH, PATHEXT: ".BAT;.CMD" };
    expect(win({ ...narrow, CLI_DEVIN_BIN: "devin.exe" }, { "C:\\Tools\\devin.exe": "file" })).toBe(true);
    expect(win({ ...narrow, CLI_DEVIN_BIN: "DEVIN.EXE" }, { "C:\\Tools\\devin.exe": "file" })).toBe(true);
    expect(win({ ...narrow, CLI_DEVIN_BIN: '"devin.exe"' }, { "C:\\Tools\\devin.exe": "file" })).toBe(true);
    expect(win({ PATH, PATHEXT: ".EXE", CLI_DEVIN_BIN: "devin.com" }, { "C:\\Tools\\devin.com": "file" })).toBe(true);
    expect(win({ PATH, PATHEXT: ".EXE", CLI_DEVIN_BIN: "devin.cmd" }, { "C:\\Tools\\devin.cmd": "file" })).toBe(true);
    expect(win({ PATH, PathExt: ".JS", CLI_DEVIN_BIN: "devin.exe" }, { "C:\\Tools\\devin.exe": "file" })).toBe(true);
    // The unset-CLI_DEVIN_BIN fallback is the bare name devin.exe.
    expect(win({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local", PATH, PATHEXT: ".CMD" }, { "C:\\Tools\\devin.exe": "file" })).toBe(true);
  });

  it("keeps the bare-name exemption to exact, launchable files found on PATH", () => {
    const narrow = { PATH, PATHEXT: ".BAT;.CMD" };
    expect(win({ ...narrow, CLI_DEVIN_BIN: "devin.exe" }, { "C:\\Tools\\devin.exe.bat": "file" })).toBe(false); // exact name only
    expect(win({ ...narrow, CLI_DEVIN_BIN: "devin.exe" }, { "C:\\Tools\\devin.exe": "dir" })).toBe(false);
    expect(win({ ...narrow, CLI_DEVIN_BIN: "devin.exe" }, { "C:\\Other\\devin.exe": "file" })).toBe(false); // not on PATH
    expect(win({ ...narrow, CLI_DEVIN_BIN: "devin.exe", PATH: "" }, { "devin.exe": "file" })).toBe(false); // cwd is not searched
    expect(win({ ...narrow, CLI_DEVIN_BIN: "devin.ps1" }, { "C:\\Tools\\devin.ps1": "file" })).toBe(false);
    expect(win({ ...narrow, CLI_DEVIN_BIN: "devin.js" }, { "C:\\Tools\\devin.js": "file" })).toBe(false);
    expect(win({ ...narrow, CLI_DEVIN_BIN: "devin.exe" }, {})).toBe(false);
    expect(win({ ...narrow, CLI_DEVIN_BIN: '"devin.exe' }, { "C:\\Tools\\devin.exe": "file" })).toBe(false);
    expect(win({ ...narrow, CLI_DEVIN_BIN: "devin.exe&x" }, { "C:\\Tools\\devin.exe&x": "file" })).toBe(false);
    expect(win({ ...narrow, CLI_DEVIN_BIN: "devin.exe" }, { "C:\\Tools\\devin.exe": "file" }, { agentic: true })).toBe(false);
  });

  it("does not stretch the inherent-extension exemption to other extensions or missing files", () => {
    const narrow = { PATH, PATHEXT: ".BAT;.CMD" };
    expect(win({ ...narrow, CLI_DEVIN_BIN: "C:\\Tools\\devin.ps1" }, { "C:\\Tools\\devin.ps1": "file" })).toBe(false);
    expect(win({ ...narrow, CLI_DEVIN_BIN: "C:\\Tools\\devin.js" }, { "C:\\Tools\\devin.js": "file" })).toBe(false);
    expect(win({ ...narrow, CLI_DEVIN_BIN: "C:\\Tools\\devin.exe" }, { "C:\\Tools\\devin.exe.bat": "file" })).toBe(false);
    expect(win({ ...narrow, CLI_DEVIN_BIN: "C:\\Tools\\devin.exe" }, { "C:\\Tools\\devin.exe": "dir" })).toBe(false);
    expect(win({ ...narrow, CLI_DEVIN_BIN: "C:\\Tools\\devin.exe" }, {})).toBe(false);
  });

  it("strips one balanced pair of quotes the shell would remove", () => {
    const files = { "C:\\Program Files\\Devin\\devin.exe": "file" };
    expect(win({ CLI_DEVIN_BIN: '"C:\\Program Files\\Devin\\devin.exe"', PATH: "" }, files)).toBe(true);
    expect(win({ CLI_DEVIN_BIN: '"C:\\Program Files\\Devin\\devin"', PATH: "" }, files)).toBe(true);
    expect(win({ CLI_DEVIN_BIN: '"C:\\Program Files\\Devin\\devin.exe"', PATH: "", PATHEXT: ".CMD" }, files)).toBe(true);
    expect(win({ CLI_DEVIN_BIN: '"devin"', PATH: "C:\\Program Files\\Devin" }, files)).toBe(true);
    expect(win({ CLI_DEVIN_BIN: '"C:\\Tools\\devin.exe"', PATH: "" }, { "C:\\Tools\\devin.exe": "file" })).toBe(true);
  });

  it("rejects malformed or shell-ambiguous command strings instead of guessing", () => {
    const files = {
      "C:\\Program Files\\Devin\\devin.exe": "file",
      "C:\\Tools\\devin.exe": "file",
      '"C:\\Tools\\devin.exe"': "file",
      "C:\\Tools\\%X%\\devin.exe": "file",
      "C:\\Tools\\a&b\\devin.exe": "file"
    };
    const reject = (bin, env = {}) => expect(win({ CLI_DEVIN_BIN: bin, PATH: "C:\\Tools", ...env }, files)).toBe(false);
    reject("C:\\Program Files\\Devin\\devin.exe"); // unquoted whitespace: cmd splits at the space
    reject('"C:\\Tools\\devin.exe'); // unbalanced
    reject('C:\\Tools\\devin.exe"');
    reject('"'); // lone quote
    reject('""'); // empty quoted
    reject('"C:\\Tools\\"devin.exe"'); // interior quote
    reject('C:\\"Program Files"\\Devin\\devin.exe'); // partial quoting
    reject('""C:\\Tools\\devin.exe""'); // nested quotes
    reject('" C:\\Tools\\devin.exe"'); // padding inside quotes
    reject("C:\\Tools\\%X%\\devin.exe"); // env expansion
    reject('"C:\\Tools\\%X%\\devin.exe"');
    reject("C:\\Tools\\a&b\\devin.exe"); // command separator
    reject("devin|more");
    reject("devin>out");
    reject("dev^in");
    reject("C:devin.exe"); // drive-relative
    reject("C:\\Tools\\devin.exe:stream");
    reject("C:\\Tools\\dev\tin.exe");
  });

  it("does not claim the default install when its path would be split by the shell", () => {
    const local = "C:\\Users\\Jo Doe\\AppData\\Local";
    expect(win({ LOCALAPPDATA: local, PATH: "" }, { [`${local}\\devin\\cli\\bin\\devin.exe`]: "file" })).toBe(false);
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
    expect(posix({ CLI_DEVIN_BIN: "/opt/bin/devin", PATH: "" }, { "/opt/bin/devin": "exec" }, { agentic: true })).toBe(false);
    expect(posix({ CLI_DEVIN_BIN: "/opt/bin/devin", DEVIN_AGENTIC_HOME: "/isolated-devin", PATH: "" }, { "/opt/bin/devin": "exec", "/isolated-devin": "dir" }, { agentic: true })).toBe(true);
    expect(posix({ CLI_DEVIN_BIN: "devin", PATH: "/opt/bin" }, { "/opt/bin/devin": "exec" }, { agentic: true })).toBe(false);
  });

  it("does not apply Windows quote or explicit-extension handling", () => {
    // POSIX spawns without a shell, so quotes are literal file-name characters.
    expect(posix({ CLI_DEVIN_BIN: '"/opt/bin/devin"', PATH: "" }, { "/opt/bin/devin": "exec" })).toBe(false);
    expect(posix({ CLI_DEVIN_BIN: "/opt/my bin/devin", PATH: "" }, { "/opt/my bin/devin": "exec" })).toBe(true);
    expect(posix({ CLI_DEVIN_BIN: "/opt/bin/devin.exe", PATH: "" }, { "/opt/bin/devin.exe": "file" })).toBe(false);
    expect(posix({ CLI_DEVIN_BIN: "devin.exe", PATH: "/opt/bin", PATHEXT: ".CMD" }, { "/opt/bin/devin.exe": "file" })).toBe(false);
    expect(posix({ CLI_DEVIN_BIN: "devin.exe", PATH: "/opt/bin", PATHEXT: ".CMD" }, { "/opt/bin/devin.exe": "exec" })).toBe(true);
  });
});
