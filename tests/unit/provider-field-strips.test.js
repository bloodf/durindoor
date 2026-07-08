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
});
