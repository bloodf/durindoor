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

  // Command Code resolves every DeepSeek id through its own provider default
  // (thinkingFormat "commandcode", no disable state) — the dotted-id rule above
  // must not hand it the generic deepseek "none" option meant for gateways that
  // actually speak the deepseek wire format.
  it("keeps Command Code's own effort set for a dotted id, not the generic none..max deepseek set", () => {
    const levels = getThinkingLevels("commandcode", "deepseek/deepseek-v4.1-flash");
    expect(levels).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(levels).not.toContain("none");
  });

  it("applies the same Command Code scoping via the cmc alias", () => {
    const levels = getThinkingLevels("cmc", "deepseek/deepseek-v4.1-flash");
    expect(levels).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(levels).not.toContain("none");
  });
});
