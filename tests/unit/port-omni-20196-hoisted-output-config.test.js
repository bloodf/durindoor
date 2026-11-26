import { describe, expect, it } from "vitest";

import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";

const systemTurn = (effort, content = [{ type: "text", text: "style" }]) => ({
  role: "system",
  content,
  output_config: { effort },
});
const userTurn = () => ({ role: "user", content: [{ type: "text", text: "hi" }] });

describe("OmniRoute #20196 - lifted system turns keep their output_config", () => {
  for (const foldSystemTurns of [false, true]) {
    it(`moves the directive to the top level (foldSystemTurns=${foldSystemTurns})`, () => {
      const body = { model: "claude-sonnet-4-6", messages: [systemTurn("high"), userTurn()] };

      normalizeClaudePassthrough(body, body.model, "claude", null, { foldSystemTurns });

      expect(body.output_config).toEqual({ effort: "high" });
    });

    it(`keeps an explicit top-level value (foldSystemTurns=${foldSystemTurns})`, () => {
      const body = {
        model: "claude-sonnet-4-6",
        output_config: { effort: "low" },
        messages: [systemTurn("high", "style"), userTurn()],
      };

      normalizeClaudePassthrough(body, body.model, "claude", null, { foldSystemTurns });

      expect(body.output_config).toEqual({ effort: "low" });
    });
  }
});
