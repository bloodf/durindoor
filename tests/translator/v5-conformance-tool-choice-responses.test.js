import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";

// #1329 / #1089: Chat→Responses must preserve tool_choice (string and named forms).
const chat = (extra = {}) => ({
  messages: [{ role: ROLE.USER, content: "Search" }],
  tools: [{
    type: OPENAI_BLOCK.FUNCTION,
    function: {
      name: "ns.search",
      description: "Search",
      parameters: { type: "object", properties: { q: { type: "string" } } },
    },
  }],
  ...extra,
});

const toResponses = (body) =>
  translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", structuredClone(body), false);

describe("#1329 Chat tool_choice to Responses", () => {
  it.each(["auto", "none", "required"])("preserves tool_choice %s on Chat to Responses", (choice) => {
    const out = toResponses(chat({ tool_choice: choice }));
    expect(out.tool_choice).toBe(choice);
  });

  it("preserves named tool_choice on Chat to Responses", () => {
    const out = toResponses(chat({
      tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: "ns.search" } },
    }));
    expect(out.tool_choice).toEqual({ type: OPENAI_BLOCK.FUNCTION, name: "ns.search" });
  });

  it("keeps parallel_tool_calls alongside tool_choice", () => {
    expect(toResponses(chat({ tool_choice: "auto", parallel_tool_calls: false })).parallel_tool_calls).toBe(false);
    expect(toResponses(chat({ tool_choice: "auto", parallel_tool_calls: true })).parallel_tool_calls).toBe(true);
  });
});
