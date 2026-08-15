import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let n = 0;
  return { randomBytes: vi.fn(() => Buffer.from(`proof-token-${(n += 1)}`)) };
});
vi.mock("node:crypto", () => ({ default: { randomBytes: mocks.randomBytes } }));
const { commitPasswordChangeProof, consumePasswordChangeProof, issuePasswordChangeProof, resetPasswordChangeProofs, reservePasswordChangeProof, releasePasswordChangeProof } = await import("../../src/lib/auth/passwordChangeProof.js");

describe("password-change proof", () => {
  beforeEach(() => {
    resetPasswordChangeProofs();
    vi.restoreAllMocks();
  });

  it("is flow-bound and can only be consumed once", () => {
    const proof = issuePasswordChangeProof("198.51.100.4");
    expect(consumePasswordChangeProof(proof, "198.51.100.5")).toBe(false);
    expect(consumePasswordChangeProof(proof, "198.51.100.4")).toBe(true);
    expect(consumePasswordChangeProof(proof, "198.51.100.4")).toBe(false);
  });

  it("rejects an expired proof", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValueOnce(5 * 60 * 1000 + 1);
    const proof = issuePasswordChangeProof("198.51.100.4");
    expect(consumePasswordChangeProof(proof, "198.51.100.4")).toBe(false);
  });

  it("keeps only one active proof per IP: issuing a new one invalidates the prior", () => {
    const first = issuePasswordChangeProof("198.51.100.4");
    const second = issuePasswordChangeProof("198.51.100.4");
    expect(consumePasswordChangeProof(first, "198.51.100.4")).toBe(false);
    expect(consumePasswordChangeProof(second, "198.51.100.4")).toBe(true);
  });

  it("sweeps expired proofs so they never linger past their TTL", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(0);
    const stale = issuePasswordChangeProof("198.51.100.9");
    vi.spyOn(Date, "now").mockReturnValue(5 * 60 * 1000 + 1);
    issuePasswordChangeProof("198.51.100.10");
    expect(consumePasswordChangeProof(stale, "198.51.100.9")).toBe(false);
  });

  it("evicts the oldest proof once the hard cap is reached", () => {
    const first = issuePasswordChangeProof("198.51.100.1");
    for (let i = 2; i <= 1000; i += 1) {
      issuePasswordChangeProof(`198.51.100.${i % 250}-${i}`);
    }
    issuePasswordChangeProof("198.51.100.overflow");
    expect(consumePasswordChangeProof(first, "198.51.100.1")).toBe(false);
  });

  it("reserve/release keeps a valid proof usable again after a failed write", () => {
    const proof = issuePasswordChangeProof("198.51.100.4");
    const reserved = reservePasswordChangeProof(proof, "198.51.100.4");
    expect(reserved).toMatchObject({ clientIp: "198.51.100.4" });
    expect(consumePasswordChangeProof(proof, "198.51.100.4")).toBe(false);

    releasePasswordChangeProof(proof, reserved);
    expect(consumePasswordChangeProof(proof, "198.51.100.4")).toBe(true);
  });

  it("does not replace a proof while its password update is reserved", () => {
    const proof = issuePasswordChangeProof("198.51.100.4");
    expect(reservePasswordChangeProof(proof, "198.51.100.4")).toMatchObject({ reserved: true });

    expect(issuePasswordChangeProof("198.51.100.4")).toBeNull();
    commitPasswordChangeProof(proof);
    expect(issuePasswordChangeProof("198.51.100.4")).toBeTruthy();
  });

  it("permits only one reserved password mutation across IPs", () => {
    const first = issuePasswordChangeProof("198.51.100.4");
    const second = issuePasswordChangeProof("2001:db8::1");
    expect(reservePasswordChangeProof(first, "198.51.100.4")).toBeTruthy();
    expect(reservePasswordChangeProof(second, "2001:db8::1")).toBeNull();
  });

  it("reserve on a wrong IP or unknown proof returns null without mutating state", () => {
    const proof = issuePasswordChangeProof("198.51.100.4");
    expect(reservePasswordChangeProof(proof, "198.51.100.5")).toBeNull();
    expect(reservePasswordChangeProof("unknown", "198.51.100.4")).toBeNull();
    expect(consumePasswordChangeProof(proof, "198.51.100.4")).toBe(true);
  });

  it("resetPasswordChangeProofs invalidates outstanding proofs for every IP", () => {
    const ipv4 = issuePasswordChangeProof("198.51.100.4");
    const ipv6 = issuePasswordChangeProof("2001:db8::1");
    const other = issuePasswordChangeProof("203.0.113.10");

    resetPasswordChangeProofs();

    expect(reservePasswordChangeProof(ipv4, "198.51.100.4")).toBeNull();
    expect(reservePasswordChangeProof(ipv6, "2001:db8::1")).toBeNull();
    expect(reservePasswordChangeProof(other, "203.0.113.10")).toBeNull();
  });
});
