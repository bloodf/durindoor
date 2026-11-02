import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";

// Issue #1089 row T8: shared Chat→Claude must map parallel_tool_calls:false to
// disable_parallel_tool_use and must not forward the OpenAI-only field.
const chat = {
  messages: [{ role: ROLE.USER, content: "hi" }],
  tools: [{ type: OPENAI_BLOCK.FUNCTION, function: { name: "search", parameters: { type: "object" } } }],
  tool_choice: "auto",
  parallel_tool_calls: false,
};

describe("#1089 parallel limit on shared Chat to Claude translation", () => {
  it("carries parallel_tool_calls:false as disable_parallel_tool_use", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", chat, false);
    expect(out.tool_choice).toMatchObject({ disable_parallel_tool_use: true });
  });

  it("does not leak the OpenAI-only field into the Claude body", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", chat, false);
    expect(out).not.toHaveProperty("parallel_tool_calls");
  });
});
