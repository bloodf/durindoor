import { describe, expect, it } from "vitest";
import { cloakClaudeTools, decloakToolName } from "../../open-sse/utils/claudeCloaking.js";
import { CLAUDE_TOOL_SUFFIX as suffix } from "../../open-sse/config/appConstants.js";

describe("upstream PR #5879 Claude cloaked history", () => {
  it("normalizes repeated suffixes only for declared client tools", () => {
    const { body } = cloakClaudeTools({
      tools: [{ name: "read", input_schema: { type: "object" } }],
      tool_choice: { type: "tool", name: `read${suffix}${suffix}` },
      messages: [{ role: "assistant", content: [
        { type: "tool_use", name: `read${suffix}${suffix}` },
        { type: "tool_use", name: `other${suffix}${suffix}` },
        { type: "tool_result", content: [{ type: "tool_reference", tool_name: `read${suffix}${suffix}` }] },
      ] }],
    });
    expect(decloakToolName(`read${suffix}${suffix}`, null, true)).toBe("read");
    expect(body.tool_choice.name).toBe(`read${suffix}`);
    expect(body.messages[0].content[0].name).toBe(`read${suffix}`);
    expect(body.messages[0].content[1].name).toBe(`other${suffix}${suffix}`);
    expect(body.messages[0].content[2].content[0].tool_name).toBe(`read${suffix}`);
  });
});
