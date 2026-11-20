import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { normalizeDeferredTools } from "../../open-sse/translator/concerns/deferredTools.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const addition = (name) => ({
  type: "tool_addition",
  tool: {
    type: "tool_definition",
    definition: { name, description: "MCP tool", input_schema: { type: "object", properties: {} } },
  },
});

describe("Kimi deferred MCP tools", () => {
  it("hoists definitions without duplicates, removes empty turns and leaves source untouched", () => {
    const body = {
      tools: [{ name: "existing", input_schema: { type: "object" } }],
      messages: [
        { role: "system", content: [addition("new_tool"), addition("new_tool"), addition("existing")] },
        { role: "user", content: [{ type: "text", text: "run" }, addition("other_tool")] },
      ],
    };

    const result = normalizeDeferredTools(body);

    expect(result.tools.map((t) => t.name)).toEqual(["existing", "new_tool", "other_tool"]);
    expect(result.messages).toEqual([{ role: "user", content: [{ type: "text", text: "run" }] }]);
    // The caller's body stays untouched so another provider attempt can retry it.
    expect(body.messages[0].content).toHaveLength(3);
    expect(body.tools).toHaveLength(1);
  });

  it("keeps the hoisted tool definition intact", () => {
    const body = { messages: [{ role: "user", content: [addition("mcp_tool")] }] };
    const result = normalizeDeferredTools(body);
    expect(result.tools).toEqual([
      { name: "mcp_tool", description: "MCP tool", input_schema: { type: "object", properties: {} } },
    ]);
    expect(result.messages).toEqual([]);
  });

  it("only normalizes Kimi-bound Claude requests", () => {
    const makeBody = () => ({
      messages: [
        { role: "system", content: [{ type: "text", text: "context" }, addition("mcp_tool")] },
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
    });

    const kimi = translateRequest("claude", "claude", "k3", makeBody(), true, null, "kimi");
    expect(kimi.tools.map((t) => t.name)).toContain("mcp_tool");
    expect(JSON.stringify(kimi.messages)).not.toContain("tool_addition");

    // Anthropic's own Claude endpoint keeps the native blocks.
    const claude = translateRequest("claude", "claude", "claude-sonnet-4-6", makeBody(), true, null, "claude");
    expect(JSON.stringify(claude.messages)).toContain("tool_addition");
  });
});
