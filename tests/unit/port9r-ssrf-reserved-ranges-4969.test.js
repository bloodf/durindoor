// decolua/9router #4969 (SSRF guard gaps): multicast, reserved and benchmarking ranges are
// not public targets. Hex-mapped IPv4 and NAT64 forms were already blocked.
import { describe, it, expect } from "vitest";
import { isBlockedHost, assertPublicUrl } from "../../src/shared/utils/ssrfGuard.js";

describe("ssrfGuard reserved ranges", () => {
  it.each([
    "198.18.0.1", "198.19.255.254", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
    "ff02::1", "ff00::", "[ff05::2]", "::ffff:e000:1", "::ffff:224.0.0.1", "64:ff9b::c612:1",
  ])("blocks %s", (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  it.each(["8.8.8.8", "198.17.255.255", "198.20.0.1", "223.255.255.254", "2606:4700:4700::1111"])("allows public %s", (host) => {
    expect(isBlockedHost(host)).toBe(false);
  });

  it("still blocks the existing private forms", () => {
    for (const host of ["::ffff:7f00:1", "64:ff9b::7f00:1", "::", "fe80::1", "100.64.0.1", "169.254.169.254"]) {
      expect(isBlockedHost(host)).toBe(true);
    }
  });

  it("rejects a multicast URL", () => {
    expect(() => assertPublicUrl("http://224.0.0.251/")).toThrow(/internal host/);
  });
});
