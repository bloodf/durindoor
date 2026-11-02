// Port of decolua/9router f5f88039 (#4761): current Claude families accept PDF input.
import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("Claude PDF input capability", () => {
  it.each([
    "claude-opus-5.5", "claude-opus-5", "claude-opus-4.8", "claude-opus-4-7",
    "claude-sonnet-5", "claude-sonnet-5-5", "claude-sonnet-4.6",
    "claude-haiku-4-5-20251001", "claude-haiku-5.5", "claude-fable-5-1",
  ])("%s advertises pdf", (id) => {
    expect(getCapabilitiesForModel("claude", id).pdf).toBe(true);
  });

  it("keeps legacy claude-3 fallbacks without a PDF claim", () => {
    expect(getCapabilitiesForModel("claude", "claude-3-5-sonnet-20241022").pdf).not.toBe(true);
  });
});
