import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("Antigravity suspension cooldown", () => {
  it.each(["antigravity", "ag"])("uses a 24-hour cooldown for TOS or validation errors (%s)", (provider) => {
    for (const message of ["TOS_VIOLATION", "VALIDATION_REQUIRED"]) {
      expect(checkFallbackError(403, message, 0, provider).cooldownMs).toBe(24 * 60 * 60 * 1000);
    }
  });

  it("keeps the ordinary 403 cooldown for unrelated providers and messages", () => {
    expect(checkFallbackError(403, "tos_violation", 0, "openai").cooldownMs).toBe(2 * 60 * 1000);
    expect(checkFallbackError(403, "Forbidden", 0, "antigravity").cooldownMs).toBe(2 * 60 * 1000);
  });
});
