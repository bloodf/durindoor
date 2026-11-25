import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("9router #5853 free model capabilities", () => {
  it("resolves a colon-free seat using the matching free model capabilities", () => {
    expect(getCapabilitiesForModel("openrouter", "longcat-2.0:free").contextWindow).toBe(1000000);
  });
});
