import { describe, expect, it } from "vitest";
import { isBlockedHost } from "../../src/shared/utils/ssrfGuard.js";
import { assertOutboundUrlAllowed, isPrivateHost } from "../../open-sse/utils/outboundUrlGuard.js";

describe("review s-ssrf-guard", () => {
  it.each([
    "::ffff:192.0.0.1",
    "::ffff:224.0.0.1",
    "64:ff9b::f000:1",
    "ff02::1",
  ])("uses one blocked-address verdict for %s", (address) => {
    expect(isBlockedHost(address)).toBe(true);
    expect(isPrivateHost(address)).toBe(true);
    expect(() => assertOutboundUrlAllowed(`http://[${address}]/`, "public-only")).toThrow();
  });

  it("blocks the unbracketed special-use IPv4 literals through the outbound URL API", () => {
    for (const address of ["192.0.0.1", "224.0.0.1", "240.0.0.1", "255.255.255.255"]) {
      expect(() => assertOutboundUrlAllowed(`http://${address}/`, "public-only")).toThrow();
    }
  });
});
