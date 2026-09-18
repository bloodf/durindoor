import { describe, it, expect } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

// DeepSeek v4.* dotted releases accept the full low..max effort range on the
// wire (via output_config.effort); non-dotted ids (v4-pro, v4-flash) keep the
// narrower legacy none/high set unless a native-V4 override applies.
describe("getThinkingLevels DeepSeek v4.* dotted releases", () => {
  it("widens dotted v4.1 ids to the full effort range", () => {
    const levels = getThinkingLevels("deepseek", "deepseek-v4.1-pro");
    expect(levels).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
  });

  it("widens dotted ids under any provider (pattern has no provider filter)", () => {
    const levels = getThinkingLevels("opencode-go", "deepseek-v4.1-flash");
    expect(levels).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
  });

  it("keeps codebuddy-cn's own effort set for a dotted id on that gateway", () => {
    const levels = getThinkingLevels("codebuddy-cn", "deepseek-v4.1-pro");
    expect(levels).toEqual(["low", "high", "xhigh"]);
  });

  it("does not widen non-dotted v4 ids", () => {
    const levels = getThinkingLevels("deepseek", "deepseek-v4-pro-max");
    expect(levels).not.toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
  });
});
