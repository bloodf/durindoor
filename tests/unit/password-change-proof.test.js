import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ randomBytes: vi.fn(() => Buffer.from("proof-token")) }));
vi.mock("node:crypto", () => ({ default: { randomBytes: mocks.randomBytes } }));

const { consumePasswordChangeProof, issuePasswordChangeProof, resetPasswordChangeProofs } = await import("../../src/lib/auth/passwordChangeProof.js");

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
});
