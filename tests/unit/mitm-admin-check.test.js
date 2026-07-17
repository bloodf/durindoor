import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isAdmin } = require("../../src/mitm/winElevated.js");

// 9router #2291: the Windows elevation probe must invoke `fltmc` (Filter
// Manager control) rather than `net session`. These tests inject a mock
// execFileSync and force platform "win32" so the Windows branch is exercised
// on every host OS.
describe("Windows Admin Privilege Check (winElevated.js)", () => {
  let execFileSyncImpl;

  beforeEach(() => {
    execFileSyncImpl = vi.fn();
  });

  it("returns true and probes the trusted fltmc.exe when elevated", () => {
    execFileSyncImpl.mockReturnValue(Buffer.from(""));

    const result = isAdmin({ platform: "win32", execFileSyncImpl });

    expect(result).toBe(true);
    expect(execFileSyncImpl).toHaveBeenCalledTimes(1);
    const [binary, argv, options] = execFileSyncImpl.mock.calls[0];
    expect(binary).toBe("C:\\Windows\\System32\\fltmc.exe");
    expect(argv).toEqual([]);
    expect(options).toMatchObject({ windowsHide: true, stdio: "ignore", timeout: 5000 });
  });

  it("returns false when fltmc throws (non-elevated process)", () => {
    execFileSyncImpl.mockImplementation(() => {
      throw new Error("Access is denied");
    });

    const result = isAdmin({ platform: "win32", execFileSyncImpl });

    expect(result).toBe(false);
    expect(execFileSyncImpl).toHaveBeenCalledTimes(1);
  });

  it("never probes fltmc on non-Windows platforms", () => {
    const result = isAdmin({ platform: "linux", execFileSyncImpl });

    expect(execFileSyncImpl).not.toHaveBeenCalled();
    const realUid = typeof process.getuid === "function" ? process.getuid() : null;
    const effectiveUid = typeof process.geteuid === "function" ? process.geteuid() : realUid;
    expect(result).toBe(realUid === 0 || effectiveUid === 0);
  });
});
