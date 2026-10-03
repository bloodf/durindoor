import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// Dashed Claude identifiers must retain their specific capability rule rather
// than falling through to generic Claude matching.
describe("Claude Opus context capability precedence", () => {
  it("uses specific dashed Opus rule before generic Claude matching", () => {
    const dashed = getCapabilitiesForModel("cc", "claude-opus-4-8");
    const canonical = getCapabilitiesForModel("cc", "claude-opus-4.8");
    expect(dashed.contextWindow).toBe(canonical.contextWindow);
    expect(dashed.thinkingFormat).toBe("claude-adaptive");
    expect(dashed.thinkingFormat).toBe(canonical.thinkingFormat);
  });
});
