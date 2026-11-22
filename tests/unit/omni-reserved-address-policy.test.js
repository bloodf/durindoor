import { describe, expect, it } from "vitest";

import {
  assertOutboundUrlAllowed,
  assertResolvedAddressAllowed,
  createOutboundUrlLookup,
  isPrivateHost,
  OutboundUrlGuardError,
} from "../../open-sse/utils/outboundUrlGuard.js";

// Pure classification fixtures only: nothing here opens a socket or queries DNS.
// Lookups are injected stubs that return a canned answer.

// [IPv4, expanded IPv4-mapped IPv6, NAT64 well-known prefix]
const RESERVED = [
  ["192.0.0.1", "0:0:0:0:0:ffff:c000:1", "64:ff9b::c000:1"],
  ["192.0.0.255", "0:0:0:0:0:ffff:c000:ff", "64:ff9b::c000:ff"],
  ["224.0.0.1", "0:0:0:0:0:ffff:e000:1", "64:ff9b::e000:1"],
  ["239.255.255.250", "0:0:0:0:0:ffff:efff:fffa", "64:ff9b::efff:fffa"],
  ["240.0.0.0", "0:0:0:0:0:ffff:f000:0", "64:ff9b::f000:0"],
  ["250.10.20.30", "0:0:0:0:0:ffff:fa0a:141e", "64:ff9b::fa0a:141e"],
  ["255.255.255.255", "0:0:0:0:0:ffff:ffff:ffff", "64:ff9b::ffff:ffff"],
];

// Already covered before this change; pinned so the table cannot lose them.
const PRIVATE_BEFORE = [
  ["0.0.0.1", "0:0:0:0:0:ffff:0:1", "64:ff9b::1"],
  ["10.1.2.3", "0:0:0:0:0:ffff:a01:203", "64:ff9b::a01:203"],
  ["100.64.0.1", "0:0:0:0:0:ffff:6440:1", "64:ff9b::6440:1"],
  ["127.0.0.1", "0:0:0:0:0:ffff:7f00:1", "64:ff9b::7f00:1"],
  ["169.254.169.254", "0:0:0:0:0:ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe"],
  ["172.16.0.1", "0:0:0:0:0:ffff:ac10:1", "64:ff9b::ac10:1"],
  ["192.168.1.1", "0:0:0:0:0:ffff:c0a8:101", "64:ff9b::c0a8:101"],
];

// Neighbours of the blocked ranges, ordinary public hosts and the benchmarking
// block, which stays allowed for fake-IP proxy setups.
const PUBLIC = [
  "8.8.8.8",
  "1.1.1.1",
  "93.184.216.34",
  "191.255.255.255",
  "192.0.1.1",
  "192.0.2.10",
  "198.18.0.1",
  "198.19.255.254",
  "203.0.113.10",
  "223.255.255.255",
  "100.63.255.255",
  "100.128.0.0",
  "0:0:0:0:0:ffff:808:808",
  "64:ff9b::808:808",
  "2001:4860:4860::8888",
];

// The guard blocks the full special-use 192.0.0.0/24, including the anycast
// subranges, to keep all classifiers and connection-time checks consistent.
//
// [IPv4, expanded IPv4-mapped IPv6, NAT64 well-known prefix]
const RESERVED_ANYCAST = [
  ["192.0.0.9", "0:0:0:0:0:ffff:c000:9", "64:ff9b::c000:9"],
  ["192.0.0.10", "0:0:0:0:0:ffff:c000:a", "64:ff9b::c000:a"],
];

// The rest of 192.0.0.0/24 stays non-public: the IPv4 Service Continuity
// Prefix 192.0.0.0/29 (RFC 7335), the 192.0.0.8 dummy address (RFC 7600),
// the NAT64/DNS64 discovery addresses 192.0.0.170/171 (RFC 8880, RFC 7050)
// and the unassigned remainder of the block.
const RESERVED_ANYCAST_NEIGHBOURS = [
  ["192.0.0.0", "0:0:0:0:0:ffff:c000:0", "64:ff9b::c000:0"],
  ["192.0.0.7", "0:0:0:0:0:ffff:c000:7", "64:ff9b::c000:7"],
  ["192.0.0.8", "0:0:0:0:0:ffff:c000:8", "64:ff9b::c000:8"],
  ["192.0.0.11", "0:0:0:0:0:ffff:c000:b", "64:ff9b::c000:b"],
  ["192.0.0.170", "0:0:0:0:0:ffff:c000:aa", "64:ff9b::c000:aa"],
  ["192.0.0.171", "0:0:0:0:0:ffff:c000:ab", "64:ff9b::c000:ab"],
];

describe("reserved address classification", () => {
  for (const [v4, mapped, nat64] of [...RESERVED, ...PRIVATE_BEFORE, ...RESERVED_ANYCAST_NEIGHBOURS]) {
    it(`treats ${v4}, ${mapped} and ${nat64} as private`, () => {
      expect(isPrivateHost(v4)).toBe(true);
      expect(isPrivateHost(mapped)).toBe(true);
      expect(isPrivateHost(`[${mapped}]`)).toBe(true);
      expect(isPrivateHost(nat64)).toBe(true);
    });
  }

  it("treats the NAT64 local-use prefix as private", () => {
    expect(isPrivateHost("64:ff9b:1::1")).toBe(true);
    expect(isPrivateHost("64:ff9b:1:2:3:4:5:6")).toBe(true);
  });

  for (const host of PUBLIC) {
    it(`keeps ${host} public`, () => {
      expect(isPrivateHost(host)).toBe(false);
    });
  }
});

describe("anycast assignments in the blocked special-use range", () => {
  for (const [v4, mapped, nat64] of RESERVED_ANYCAST) {
    it(`blocks ${v4}, ${mapped} and ${nat64}`, () => {
      expect(isPrivateHost(v4)).toBe(true);
      expect(isPrivateHost(mapped)).toBe(true);
      expect(isPrivateHost(`[${mapped}]`)).toBe(true);
      expect(isPrivateHost(nat64)).toBe(true);
    });

    it(`rejects ${v4} in every spelling under public-only`, () => {
      for (const url of [
        `http://${v4}/`,
        `http://[::ffff:${v4}]/`,
        `http://[${mapped}]/`,
        `http://[${nat64}]/`,
      ]) {
        expect(() => assertOutboundUrlAllowed(url, "public-only"), url).toThrow(OutboundUrlGuardError);
      }
    });

    it(`rejects ${v4} as a resolved address under public-only`, () => {
      expect(() => assertResolvedAddressAllowed(v4, "public-only")).toThrow(OutboundUrlGuardError);
      expect(() => assertResolvedAddressAllowed(mapped, "public-only")).toThrow(OutboundUrlGuardError);
      expect(() => assertResolvedAddressAllowed(nat64, "public-only")).toThrow(OutboundUrlGuardError);
    });
  }

  it("keeps the other addresses in the same block blocked", () => {
    for (const [v4, mapped, nat64] of RESERVED_ANYCAST_NEIGHBOURS) {
      expect(isPrivateHost(v4), v4).toBe(true);
      expect(() => assertResolvedAddressAllowed(v4, "public-only"), v4).toThrow(OutboundUrlGuardError);
      expect(() => assertOutboundUrlAllowed(`http://${v4}/`, "public-only"), v4).toThrow(
        OutboundUrlGuardError
      );
      expect(isPrivateHost(mapped), mapped).toBe(true);
      expect(isPrivateHost(nat64), nat64).toBe(true);
    }
  });

  it("leaves the other guard modes unchanged for the anycast addresses", () => {
    expect(() => assertOutboundUrlAllowed("http://192.0.0.9/", "block-metadata")).not.toThrow();
    expect(() => assertOutboundUrlAllowed("http://192.0.0.10/", "block-metadata")).not.toThrow();
    expect(() => assertOutboundUrlAllowed("http://192.0.0.9/", "none")).not.toThrow();
    expect(() => assertOutboundUrlAllowed("http://192.0.0.10/", "none")).not.toThrow();
  });
});

describe("public-only URL handling", () => {
  for (const [v4, mapped] of RESERVED) {
    for (const url of [`http://${v4}/`, `http://[::ffff:${v4}]/`, `http://[${mapped}]/`]) {
      it(`rejects ${url}`, () => {
        expect(() => assertOutboundUrlAllowed(url, "public-only")).toThrow(OutboundUrlGuardError);
      });
    }
  }

  it("rejects NAT64 forms", () => {
    for (const [, , nat64] of RESERVED) {
      expect(() => assertOutboundUrlAllowed(`http://[${nat64}]/`, "public-only")).toThrow(
        OutboundUrlGuardError
      );
    }
  });

  it("still accepts public URLs", () => {
    for (const url of [
      "https://api.openai.com/v1/models",
      "http://8.8.8.8/",
      "http://223.255.255.255/",
      "http://198.18.0.1/",
      "https://[2001:4860:4860::8888]/",
    ]) {
      expect(() => assertOutboundUrlAllowed(url, "public-only"), url).not.toThrow();
    }
  });

  it("leaves the other guard modes unchanged", () => {
    expect(() => assertOutboundUrlAllowed("http://240.0.0.1/", "block-metadata")).not.toThrow();
    expect(() => assertOutboundUrlAllowed("http://240.0.0.1/", "none")).not.toThrow();
    expect(() => assertOutboundUrlAllowed("http://169.254.169.254/", "block-metadata")).toThrow(
      OutboundUrlGuardError
    );
    expect(() => assertOutboundUrlAllowed("http://127.0.0.1/", "block-metadata")).not.toThrow();
  });
});

describe("resolved address handling", () => {
  it("rejects reserved addresses under public-only", () => {
    for (const address of ["192.0.0.1", "224.0.0.1", "240.0.0.1", "255.255.255.255", "::ffff:f000:1", "64:ff9b::f000:1"]) {
      expect(() => assertResolvedAddressAllowed(address, "public-only"), address).toThrow(
        OutboundUrlGuardError
      );
    }
  });

  it("accepts public answers and keeps other modes unchanged", () => {
    expect(() => assertResolvedAddressAllowed("93.184.216.34", "public-only")).not.toThrow();
    expect(() => assertResolvedAddressAllowed("198.18.0.1", "public-only")).not.toThrow();
    expect(() => assertResolvedAddressAllowed("240.0.0.1", "block-metadata")).not.toThrow();
  });

  function answer(address, family) {
    const lookup = (_host, _options, callback) => callback(null, [{ address, family }]);
    const guarded = createOutboundUrlLookup("public-only", lookup);
    return new Promise((resolve) => guarded("name.test", { all: true }, (error) => resolve(error)));
  }

  it("refuses a lookup answer in a reserved range and passes a public one", async () => {
    expect(await answer("240.0.0.1", 4)).toBeInstanceOf(OutboundUrlGuardError);
    expect(await answer("64:ff9b::f000:1", 6)).toBeInstanceOf(OutboundUrlGuardError);
    expect(await answer("93.184.216.34", 4)).toBeNull();
  });

  it("blocks lookup answers in the anycast allocations", async () => {
    expect(await answer("192.0.0.9", 4)).toBeInstanceOf(OutboundUrlGuardError);
    expect(await answer("192.0.0.10", 4)).toBeInstanceOf(OutboundUrlGuardError);
    expect(await answer("0:0:0:0:0:ffff:c000:9", 6)).toBeInstanceOf(OutboundUrlGuardError);
    expect(await answer("64:ff9b::c000:a", 6)).toBeInstanceOf(OutboundUrlGuardError);
  });

  it("still refuses a lookup answer from the rest of the protocol-assignment block", async () => {
    expect(await answer("192.0.0.8", 4)).toBeInstanceOf(OutboundUrlGuardError);
    expect(await answer("192.0.0.11", 4)).toBeInstanceOf(OutboundUrlGuardError);
    expect(await answer("192.0.0.170", 4)).toBeInstanceOf(OutboundUrlGuardError);
  });
});
