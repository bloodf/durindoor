// codebuddy-cn per-model thinking level sets (2026-08 catalog refresh, upstream e014cb537).
// The gateway rejects effort values outside each model's supportedEfforts set even
// though the wire format is "openai" — so PATTERN_THINKING carries provider-scoped rules.
import { describe, it, expect } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

describe("codebuddy-cn thinking levels", () => {
  it("glm-5.3 family offers low/high/max only", () => {
    expect(getThinkingLevels("codebuddy-cn", "glm-5.3")).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("codebuddy-cn", "glm-5.3-flash")).toEqual(["low", "high", "max"]);
  });

  it("deepseek-v4 family offers low/high/xhigh", () => {
    expect(getThinkingLevels("codebuddy-cn", "deepseek-v4-pro")).toEqual(["low", "high", "xhigh"]);
  });

  it("hy3 variants offer low/high; hy4-preview is high-only", () => {
    expect(getThinkingLevels("codebuddy-cn", "hy3")).toEqual(["low", "high"]);
    expect(getThinkingLevels("codebuddy-cn", "hy3-x")).toEqual(["low", "high"]);
    expect(getThinkingLevels("codebuddy-cn", "hy3-preview")).toEqual(["low", "high"]);
    expect(getThinkingLevels("codebuddy-cn", "hy4-preview")).toEqual(["high"]);
    expect(getThinkingLevels("codebuddy-cn", "hy4-preview-x")).toEqual(["high"]);
  });

  it("kimi-k3-1 falls through to the broad Kimi K3 max-only rule", () => {
    expect(getThinkingLevels("codebuddy-cn", "kimi-k3-1")).toEqual(["max"]);
  });

  it("provider-scoped rules do not leak: bigmodel glm-5.3 keeps its own set", () => {
    expect(getThinkingLevels("bigmodel", "glm-5.3")).toEqual(["low", "high", "max"]);
  });
});
