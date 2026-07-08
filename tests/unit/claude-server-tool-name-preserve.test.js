import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cloakClaudeTools } from "../../open-sse/utils/claudeCloaking.js";

describe("cloakClaudeTools preserves Anthropic server tool literal names", () => {
  it("keeps message history and tool_choice references to declared server tools", () => {
    const body = {
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 8 },
        { name: "mixture_of_agents" },
      ],
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_1", name: "web_search", input: { query: "x" } },
            { type: "tool_use", id: "toolu_2", name: "mixture_of_agents", input: {} },
          ],
        },
      ],
      tool_choice: { type: "tool", name: "mixture_of_agents" },
    };

    const { body: cloaked } = cloakClaudeTools(body);

    const tools = cloaked.tools;
    assert.equal(tools[0].name, "web_search");
    assert.equal(tools[1].name, "mixture_of_agents_ide");

    const blocks = cloaked.messages[0].content;
    assert.equal(blocks[0].name, "web_search");
    assert.equal(blocks[1].name, "mixture_of_agents_ide");

    assert.equal(cloaked.tool_choice.name, "mixture_of_agents_ide");
  });

  it("does not rewrite tool_choice for a server tool", () => {
    const body = {
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      tool_choice: { type: "tool", name: "web_search" },
    };

    const { body: cloaked } = cloakClaudeTools(body);

    assert.equal(cloaked.tools[0].name, "web_search");
    assert.equal(cloaked.tool_choice.name, "web_search");
  });
});
