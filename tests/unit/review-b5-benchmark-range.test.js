import { describe, expect, it } from "vitest";
import { assertOutboundUrlAllowed, assertResolvedAddressAllowed } from "../../open-sse/utils/outboundUrlGuard.js";
import { isBlockedHost } from "../../src/shared/utils/ssrfGuard.js";

describe("benchmarking addresses and guard policies", () => {
  it.each(["198.18.0.1", "198.19.255.254", "::ffff:198.18.0.1", "64:ff9b::c613:fffe"])(
    "allows %s for provider egress while blocking it for SSRF",
    (address) => {
      for (const mode of ["public-only", "block-metadata", "none"]) {
        expect(() => assertResolvedAddressAllowed(address, mode)).not.toThrow();
        expect(() => assertOutboundUrlAllowed(`http://${address.includes(":") ? `[${address}]` : address}/`, mode)).not.toThrow();
      }
      expect(isBlockedHost(address)).toBe(true);
    }
  );

  it.each(["192.0.0.1", "224.0.0.1", "240.0.0.1", "255.255.255.255"])(
    "blocks %s in both guards",
    (address) => {
      expect(() => assertResolvedAddressAllowed(address, "public-only")).toThrow();
      expect(isBlockedHost(address)).toBe(true);
    }
  );
});
