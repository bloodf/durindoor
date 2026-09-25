// Port of OmniRoute #14234: a bare provider 403 with no quota signal was
// classified as insufficient_quota, misleading quota-recovery/cooldown logic
// into treating a plain permission refusal as billing exhaustion. This emits
// the neutral permission_denied code/message for a 403 instead, with no
// other status defaults changed.
import { describe, expect, it } from "vitest";
import { buildErrorBody, errorResponse } from "../../open-sse/utils/error.js";
import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../../open-sse/config/errorConfig.js";

describe("port 14234 — neutral 403 code for non-quota refusals", () => {
  it("classifies a bare 403 as permission_denied, not insufficient_quota", () => {
    expect(ERROR_TYPES[403]).toEqual({ type: "permission_error", code: "permission_denied" });
    expect(DEFAULT_ERROR_MESSAGES[403]).toBe("Permission denied");
  });

  it("buildErrorBody keeps the upstream message but uses the neutral type/code", () => {
    expect(buildErrorBody(403, "You do not have access to this model")).toEqual({
      error: {
        message: "You do not have access to this model",
        type: "permission_error",
        code: "permission_denied",
      },
    });
  });

  it("errorResponse defaults an empty 403 message to the neutral 'Permission denied' body", async () => {
    const response = errorResponse(403, "");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { message: "Permission denied", type: "permission_error", code: "permission_denied" },
    });
  });

  it("leaves every other status's error type/code untouched", () => {
    expect(ERROR_TYPES[401]).toEqual({ type: "authentication_error", code: "invalid_api_key" });
    expect(ERROR_TYPES[402]).toEqual({ type: "billing_error", code: "payment_required" });
    expect(ERROR_TYPES[429]).toEqual({ type: "rate_limit_error", code: "rate_limit_exceeded" });
  });
});
