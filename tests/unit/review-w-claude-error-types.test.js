import { describe, expect, it } from "vitest";
import { createErrorResult } from "../../open-sse/utils/error.js";
import { ERROR_TYPES } from "../../open-sse/config/errorConfig.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const expectedTypes = [
  [400, "invalid_request_error"],
  [401, "authentication_error"],
  [402, "permission_error"],
  [403, "permission_error"],
  [404, "not_found_error"],
  [413, "request_too_large"],
  [429, "rate_limit_error"],
  [500, "api_error"],
  [502, "api_error"],
  [503, "overloaded_error"],
  [504, "timeout_error"],
  [529, "overloaded_error"]
];

describe("Claude error envelope types", () => {
  it.each(expectedTypes)("maps HTTP %s to %s", async (status, type) => {
    const result = createErrorResult(status, "failed", undefined, null, null, null, status, FORMATS.CLAUDE);
    expect(await result.response.json()).toEqual({
      type: "error",
      error: { type, message: "failed" }
    });
  });

  it.each(expectedTypes)("keeps OpenAI HTTP %s error type unchanged", async (status) => {
    const result = createErrorResult(status, "failed", undefined, null, null, null, status, FORMATS.OPENAI);
    const body = await result.response.json();
    expect(body.error.type).toBe(ERROR_TYPES[status]?.type ?? "server_error");
  });
});
