import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, "../../cli/cli.js");

/**
 * Codex P1 (PR #96 / 9router#2414): the upstream PR moves --help and
 * --version handling above the runtime hooks (SQLite self-heal, tray
 * runtime, MITM hosts cleanup, settings lookup) so cold-start latency
 * is only a JS parse. This test asserts that the help/version flags
 * exit without stderr noise (which would indicate a runtime hook ran
 * and tried to touch a missing native module) and that output is
 * deterministic. If a future change reorders the flags back below the
 * runtime hooks and the hooks gain side effects under --help/--version,
 * the stderr-clean assertion or the runtime-marker grep will fail.
 */
describe("cli fast-path for --help / --version", () => {
  it("--help prints usage and exits 0 cleanly", () => {
    const res = spawnSync("node", [CLI_PATH, "--help"], {
      timeout: 10_000,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Usage:");
    expect(res.stdout).toContain("--help");
    expect(res.stdout).toContain("--version");
    // The runtime hooks log "[SQLITE]" / "[TRAY]" / "[POSTINSTALL]" when they
    // run. Fast-path must NOT touch them, so stdout stays free of those markers.
    expect(res.stdout).not.toMatch(/\[SQLITE\]|\[TRAY\]|\[POSTINSTALL\]/);
    expect(res.stderr || "").toBe("");
  });

  it("--version prints semver and exits 0", () => {
    const res = spawnSync("node", [CLI_PATH, "--version"], {
      timeout: 10_000,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(res.stderr || "").toBe("");
  });

  it("-h and -v short flags match the long ones", () => {
    const h = spawnSync("node", [CLI_PATH, "-h"], { timeout: 10_000, encoding: "utf8" });
    const v = spawnSync("node", [CLI_PATH, "-v"], { timeout: 10_000, encoding: "utf8" });
    expect(h.status).toBe(0);
    expect(h.stdout).toContain("Usage:");
    expect(v.status).toBe(0);
    expect(v.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
