import { describe, expect, it } from "vitest";
import { classifyValidationRejection, refineValidationResult } from "../../src/lib/providers/validationRejection.js";

describe("model-specific region refusals", () => {
  const body = "The model gpt-x is not available in your region";

  it("keeps account-wide region refusals explicit", () => {
    expect(classifyValidationRejection(400, "User location is not supported for the API use."))
      .toEqual({ kind: "access_denied", explicit: true });
  });

  it("does not treat a model restriction as an explicit account refusal", () => {
    expect(classifyValidationRejection(404, body)).toEqual({ kind: "access_denied" });
    expect(refineValidationResult({ valid: true }, { status: 404, body })).toEqual({ valid: true });
  });

  it("keeps HTTP 451 explicit even when a model is named", () => {
    expect(classifyValidationRejection(451, body)).toEqual({ kind: "access_denied", explicit: true });
  });
});
