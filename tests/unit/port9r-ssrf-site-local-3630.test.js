// decolua/9router#3630 (SSRF hardening): deprecated site-local IPv6 (fec0::/10) is an
// internal range and must not be a public fetch target.
import { describe, it, expect } from "vitest";
import { isBlockedHost, assertPublicUrl } from "../../src/shared/utils/ssrfGuard.js";

describe("ssrfGuard site-local IPv6 (#3630)", () => {
  it.each(["fec0::1", "[fec0::1]", "feff:ffff::1", "fec0:0:0:1::5"])("blocks %s", (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  it("blocks site-local through assertPublicUrl", () => {
    expect(() => assertPublicUrl("http://[fec0::1]/")).toThrow("Blocked URL");
  });

  it.each(["fbff::1", "ff00::1", "2606:4700:4700::1111"])("does not misclassify neighbour %s as site-local", (host) => {
    // fbff:: is outside fc00::/7 and fec0::/10; ff00::/8 is multicast (blocked for a different reason).
    if (host.startsWith("ff")) expect(isBlockedHost(host)).toBe(true);
    else expect(isBlockedHost(host)).toBe(false);
  });
});
