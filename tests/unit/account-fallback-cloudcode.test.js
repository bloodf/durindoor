import { describe, expect, it } from "vitest";
import { isRecoverableCloudCodeProject403 } from "../../open-sse/services/accountFallback.js";

describe("Cloud Code account fallback classification", () => {
  it("treats project/API setup 403s as recoverable for Cloud Code providers", () => {
    expect(isRecoverableCloudCodeProject403(
      "antigravity",
      403,
      "Cloud Code Assist API error (403): Cloud AI Companion API has not been used in project 123 before or it is disabled. reason: SERVICE_DISABLED"
    )).toBe(true);
  });

  it("does not treat provider-only or generic 403s as recoverable project errors", () => {
    expect(isRecoverableCloudCodeProject403(
      "gemini-cli",
      403,
      "Cloud Code Assist API error (403): Forbidden"
    )).toBe(false);
  });

  it("keeps account deactivation and ban 403s on normal account cooldown handling", () => {
    expect(isRecoverableCloudCodeProject403(
      "antigravity",
      403,
      "Cloud Code Assist API error (403): Gemini has been disabled in this account for violation of Terms of Service"
    )).toBe(false);

    expect(isRecoverableCloudCodeProject403(
      "gemini-cli",
      403,
      "Cloud Code Assist API error (403): Verify your account to continue."
    )).toBe(false);
  });
});
