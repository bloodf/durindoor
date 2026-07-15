import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CLAUDE_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";

const cases = [
  // OmniRoute #7061: an explicit zero budget means Gemini dynamic thinking and
  // must survive as thinkingBudget: 0 (a truthy check dropped it).
  { name: "preserves budget_tokens: 0 (dynamic thinking)", budget: 0, expectedBudget: 0 },
  // No budget specified still falls through to the auto branch (thinkingBudget: -1).
  { name: "falls through to auto when budget_tokens is undefined", budget: undefined, expectedBudget: -1 },
  // A positive budget keeps its exact value.
  { name: "preserves an explicit positive budget", budget: 8192, expectedBudget: 8192 },
];

describe("Claude to Gemini thinking budget", () => {
  for (const { name, budget, expectedBudget } of cases) {
    it(name, () => {
      const result = translateRequest(
        FORMATS.CLAUDE,
        FORMATS.GEMINI,
        "gemini-2.5-pro",
        {
          messages: [{ role: ROLE.USER, content: [{ type: CLAUDE_BLOCK.TEXT, text: "hi" }] }],
          thinking: { type: "enabled", budget_tokens: budget },
        },
        false,
        { apiKey: "test" },
        "gemini",
      );

      expect(result.generationConfig.thinkingConfig).toEqual({
        thinkingBudget: expectedBudget,
        includeThoughts: true,
      });
    });
  }
});
