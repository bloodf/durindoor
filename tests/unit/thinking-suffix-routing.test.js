import { describe, expect, it } from "vitest";
import {
  getModelTargetFormat,
  getModelType,
  getModelUpstreamId,
} from "../../open-sse/config/providerModels.js";
import { parseSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";

describe("request-only thinking suffix routing", () => {
  it("maps the base alias but never sends a recognized suffix upstream", () => {
    expect(getModelUpstreamId("blackbox", "gpt-5.5(high)")).toBe(
      "blackboxai/openai/gpt-5.5",
    );
  });

  it("preserves an unknown parenthesized custom ID byte-for-byte", () => {
    expect(getModelUpstreamId("blackbox", "gpt-5.5(custom)")).toBe(
      "gpt-5.5(custom)",
    );
  });

  it("uses the clean logical ID for target-format and media-kind lookup", () => {
    const claudeModel = parseSuffix("minimax-m3(high)").cleanModel;
    const ttsModel = parseSuffix("tts-1(high)").cleanModel;
    expect(getModelTargetFormat("opencode-go", claudeModel)).toBe("claude");
    expect(getModelType("openai", ttsModel)).toBe("tts");
  });
});
