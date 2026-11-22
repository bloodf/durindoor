import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Antigravity thinking format", () => {
  it.each([["medium", "medium"], ["xhigh", "high"], ["auto", "high"]])(
    "maps Claude effort %s to Gemini level %s", (effort, level) => {
      const body = { reasoning_effort: effort };
      applyThinking(FORMATS.ANTIGRAVITY, "claude-sonnet-4-6", body, "antigravity");
      expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: level, includeThoughts: true });
      expect(body.thinking).toBeUndefined();
      expect(body.output_config).toBeUndefined();
    });
});
