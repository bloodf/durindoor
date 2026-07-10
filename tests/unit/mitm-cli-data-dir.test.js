import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { getAppDataDir } = require("../../cli/src/cli/appDataDir.js");

describe("CLI data-directory resolution", () => {
  it.each([
    ["linux", "/fixture/work", "/fixture/work/relative-fixture-data"],
    ["win32", "C:\\fixture\\work", "C:\\fixture\\work\\relative-fixture-data"],
  ])("canonicalizes configured DATA_DIR before worker cwd changes on %s", (platform, cwd, expected) => {
    const mkdir = vi.fn();
    expect(getAppDataDir({
      env: { DATA_DIR: "relative-fixture-data" },
      platform,
      homedir: () => "/fixture/home",
      cwd: () => cwd,
      mkdir,
    })).toBe(expected);
    expect(mkdir).toHaveBeenCalledWith(expected, { recursive: true });
  });

  it("uses the Windows home fallback when APPDATA is absent", () => {
    expect(getAppDataDir({
      env: {},
      platform: "win32",
      homedir: () => "C:\\Users\\fixture",
    })).toBe(path.win32.join("C:\\Users\\fixture", "AppData", "Roaming", "9router"));
  });

  it("falls back from a Unix path on Windows without creating it", () => {
    const mkdir = vi.fn();
    const warn = vi.fn();
    expect(getAppDataDir({
      env: { DATA_DIR: "/var/lib/9router", APPDATA: "C:\\FixtureData" },
      platform: "win32",
      homedir: () => "C:\\Users\\fixture",
      mkdir,
      warn,
    })).toBe(path.win32.join("C:\\FixtureData", "9router"));
    expect(mkdir).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });
});
