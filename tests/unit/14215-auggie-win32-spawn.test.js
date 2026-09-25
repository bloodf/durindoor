// Port of OmniRoute #14215: on Windows, Node's CVE-2024-27980 fix makes
// spawn() on a .cmd/.bat shim throw synchronously with `spawn EINVAL` unless
// shell:true is set. resolveAuggieBin() falls back to "auggie.cmd" on win32,
// but checkAuggieCliVersion, spawnAuggie, and the inline streaming spawn all
// called spawn() with no shell option, so every one of them broke on
// Windows, not just request-time streaming. buildAuggieSpawnOptions() now
// backs all three call sites.
import { describe, expect, it } from "vitest";
import { buildAuggieSpawnOptions } from "../../open-sse/executors/auggie.js";

function withPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

describe("port 14215 — Windows-safe auggie spawn options", () => {
  it("enables shell + windowsHide on win32 so a .cmd shim does not throw EINVAL", () => {
    withPlatform("win32", () => {
      expect(buildAuggieSpawnOptions(["pipe", "pipe", "pipe"])).toMatchObject({
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
        windowsHide: true,
      });
    });
  });

  it("keeps shell disabled on non-Windows platforms", () => {
    withPlatform("linux", () => {
      expect(buildAuggieSpawnOptions(["ignore", "pipe", "pipe"])).toMatchObject({
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
    });
  });

  it("passes the caller's exact stdio layout through unchanged", () => {
    withPlatform("darwin", () => {
      expect(buildAuggieSpawnOptions(["ignore", "pipe", "pipe"]).stdio).toEqual(["ignore", "pipe", "pipe"]);
      expect(buildAuggieSpawnOptions(["pipe", "pipe", "pipe"]).stdio).toEqual(["pipe", "pipe", "pipe"]);
    });
  });
});
