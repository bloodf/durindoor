import { describe, expect, it } from "vitest";
import {
  DEFAULT_PORTS,
  MAX_ADDRESSES,
  MAX_PORTS,
  expandCidr,
  normalizeHosts,
  normalizePorts,
  resolveScanTargets,
} from "../../src/lib/lanDiscovery/cidr.js";

describe("lan discovery CIDR / target normalization", () => {
  it("expands a /30 into four addresses", () => {
    expect(expandCidr("192.168.1.0/30")).toEqual({
      ok: true,
      hosts: ["192.168.1.0", "192.168.1.1", "192.168.1.2", "192.168.1.3"],
    });
  });

  it("accepts a /24 (exactly 256 addresses) and rejects a /23", () => {
    const full = expandCidr("10.0.0.0/24");
    expect(full.ok).toBe(true);
    expect(full.hosts).toHaveLength(MAX_ADDRESSES);
    expect(full.hosts[0]).toBe("10.0.0.0");
    expect(full.hosts[255]).toBe("10.0.0.255");

    expect(expandCidr("10.0.0.0/23")).toEqual({
      ok: false,
      error: `cidr expands to more than ${MAX_ADDRESSES} addresses`,
    });
  });

  it("rejects invalid CIDR forms", () => {
    expect(expandCidr("").ok).toBe(false);
    expect(expandCidr("192.168.1.1").ok).toBe(false);
    expect(expandCidr("192.168.1.1/33").ok).toBe(false);
    expect(expandCidr("fe80::/64").ok).toBe(false);
    expect(expandCidr("01.2.3.4/32").ok).toBe(false);
  });

  it("normalizes hosts and enforces the address cap", () => {
    expect(normalizeHosts(["Nas.local", "10.0.0.5"])).toEqual({
      ok: true,
      hosts: ["nas.local", "10.0.0.5"],
    });
    expect(normalizeHosts([]).ok).toBe(false);
    expect(normalizeHosts(["http://evil"]).ok).toBe(false);
    expect(normalizeHosts(["host:8080"]).ok).toBe(false);
    expect(normalizeHosts(Array.from({ length: MAX_ADDRESSES + 1 }, (_, i) => `h${i}`)).ok).toBe(false);
  });

  it("defaults ports and enforces the port cap", () => {
    expect(normalizePorts(undefined)).toEqual({ ok: true, ports: [...DEFAULT_PORTS] });
    expect(normalizePorts([11434, 8000])).toEqual({ ok: true, ports: [11434, 8000] });
    expect(normalizePorts([]).ok).toBe(false);
    expect(normalizePorts([0]).ok).toBe(false);
    expect(normalizePorts(Array.from({ length: MAX_PORTS + 1 }, (_, i) => i + 1)).ok).toBe(false);
  });

  it("requires exactly one of hosts or cidr", () => {
    expect(resolveScanTargets({}).ok).toBe(false);
    expect(resolveScanTargets({ hosts: ["a"], cidr: "10.0.0.1/32" }).ok).toBe(false);
    expect(resolveScanTargets({ hosts: ["a"] })).toEqual({ ok: true, hosts: ["a"] });
    expect(resolveScanTargets({ cidr: "10.0.0.5/32" })).toEqual({ ok: true, hosts: ["10.0.0.5"] });
  });
});
