import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";

// Issue #1089: parent reproduced T7; post-repair verification remains parent-owned.
const schema = { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false };
const chat = (strict) => ({
  messages: [{ role: ROLE.USER, content: "Search for trees" }],
  tools: [{ type: OPENAI_BLOCK.FUNCTION, function: { name: "search", parameters: schema, strict } }],
});

describe("v5 registered tool flags", () => {
  it.each([false, true])("preserves explicit strict=%s through Responses and back", (strict) => {
    const responses = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", chat(strict), false);
    expect(responses.tools[0]).toMatchObject({ name: "search", strict, parameters: schema });
    const restored = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", responses, false);
    expect(restored.tools[0].function).toMatchObject({ name: "search", strict, parameters: schema });
  });

  it("preserves a client's ban on parallel calls when lowering Chat to Responses", () => {
    const translated = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", {
      ...chat(false), parallel_tool_calls: false,
    }, false);
    expect(translated.parallel_tool_calls).toBe(false);
    const enabled = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", {
      ...chat(false), parallel_tool_calls: true,
    }, false);
    expect(enabled.parallel_tool_calls).toBe(true);
    const absent = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", chat(false), false);
    expect(absent).not.toHaveProperty("parallel_tool_calls");
  });
});
