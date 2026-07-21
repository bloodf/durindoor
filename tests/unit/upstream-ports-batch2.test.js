import { describe, it, expect } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("#2667 — codex invalid_encrypted_content does not trigger account fallback", () => {
  it("does not fall back on a 400 invalid_encrypted_content code", () => {
    const r = checkFallbackError(400, '{"error":{"code":"invalid_encrypted_content","message":"..."}}');
    expect(r.shouldFallback).toBe(false);
    expect(r.cooldownMs).toBe(0);
  });

  it("does not fall back on the message-based encrypted-content shape", () => {
    const r = checkFallbackError(400, "Encrypted content could not be verified");
    expect(r.shouldFallback).toBe(false);
  });

  it("still falls back on a genuine transient upstream failure", () => {
    const r = checkFallbackError(503, "service unavailable");
    expect(r.shouldFallback).toBe(true);
  });
});
