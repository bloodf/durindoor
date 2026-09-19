import { describe, it, expect } from "vitest";
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  totpCounter,
  buildOtpAuthUri,
  TOTP_STEP_SEC,
} from "../../src/lib/auth/totp.js";

describe("base32 round trip", () => {
  it("encodes and decodes arbitrary bytes", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it("tolerates lowercase and padding on decode", () => {
    const upper = base32Encode(Buffer.from("hello", "utf8"));
    expect(base32Decode(upper.toLowerCase() + "==")).toEqual(Buffer.from("hello", "utf8"));
  });

  it("rejects an invalid character", () => {
    expect(() => base32Decode("!!!!")).toThrow(/Invalid base32/);
  });
});

describe("generateTotpCode", () => {
  // RFC 6238 Appendix B test vector, SHA-1: secret "12345678901234567890",
  // T=59s -> counter 1 -> 8-digit code "94287082"; our 6-digit truncation
  // keeps the low-order digits, i.e. "287082".
  it("matches the RFC 6238 SHA-1 test vector", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890", "ascii"));
    expect(generateTotpCode(secret, 1)).toBe("287082");
  });

  it("pads short codes with leading zeros", () => {
    const code = generateTotpCode(generateTotpSecret(), 0);
    expect(code).toHaveLength(6);
  });
});

describe("verifyTotpCode", () => {
  const secret = generateTotpSecret();

  it("accepts the code for the current step", () => {
    const atMs = 1_700_000_000_000;
    const code = generateTotpCode(secret, totpCounter(atMs));
    expect(verifyTotpCode(secret, code, { atMs })).toBe(true);
  });

  it("accepts a code from one step of skew in either direction", () => {
    const atMs = 1_700_000_000_000;
    const counter = totpCounter(atMs);
    const prevCode = generateTotpCode(secret, counter - 1);
    const nextCode = generateTotpCode(secret, counter + 1);
    expect(verifyTotpCode(secret, prevCode, { atMs })).toBe(true);
    expect(verifyTotpCode(secret, nextCode, { atMs })).toBe(true);
  });

  it("rejects a code outside the accepted skew window", () => {
    const atMs = 1_700_000_000_000;
    const staleCode = generateTotpCode(secret, totpCounter(atMs) - 2);
    expect(verifyTotpCode(secret, staleCode, { atMs })).toBe(false);
  });

  it("never throws on malformed input", () => {
    expect(verifyTotpCode(secret, "not-a-code")).toBe(false);
    expect(verifyTotpCode(secret, "")).toBe(false);
    expect(verifyTotpCode("", "123456")).toBe(false);
    expect(verifyTotpCode(secret, null)).toBe(false);
  });
});

describe("buildOtpAuthUri", () => {
  it("encodes issuer, account, and step parameters", () => {
    const uri = buildOtpAuthUri({ secret: "ABCDEFGH", account: "admin", issuer: "DurinDoor" });
    expect(uri).toMatch(/^otpauth:\/\/totp\/DurinDoor%3Aadmin\?/);
    expect(uri).toContain("secret=ABCDEFGH");
    expect(uri).toContain(`period=${TOTP_STEP_SEC}`);
    expect(uri).toContain("digits=6");
  });
});
