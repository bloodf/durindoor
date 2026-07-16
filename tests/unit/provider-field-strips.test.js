import { describe, expect, it } from "vitest";
import { findOffendingField } from "../../open-sse/config/providerFieldStrips.js";

describe("providerFieldStrips", () => {
  it.each([
    ["Field 'client_metadata' is not supported", "client_metadata"],
    ["Parameter 'thinking' is not allowed", "thinking"],
    ["Invalid field: reasoning", "reasoning"],
    ["'reasoning_budget' exceeds limit", "reasoning_budget"],
  ])("finds documented offending field in: %s", (message, expected) => {
    expect(findOffendingField(message)).toBe(expected);
  });

  it("does not strip top-level thinking when error path is nested under messages.*.content", () => {
    const error = "messages.0.content.0.thinking: Extra inputs are not permitted";
    expect(findOffendingField(error)).toBeNull();
  });

  it("does not treat hyphenated names as underscore variants", () => {
    expect(findOffendingField("reasoning-budget: invalid")).toBeNull();
  });
});
