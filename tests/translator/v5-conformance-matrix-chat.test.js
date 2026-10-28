import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const schema = { type: "object", properties: { type: { type: "string" }, properties: { type: "array", items: { type: "string" } }, items: { type: "string" }, required: { type: "boolean" } }, required: ["type"] };
const chat = { messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "ns.search", description: "Search", parameters: schema, strict: false } }], tool_choice: { type: "function", function: { name: "ns.search" } }, parallel_tool_calls: false };
const completion = (finish_reason = "stop") => ({ id: "x", model: "m", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "c", type: "function", function: { name: "ns.search", arguments: "{}" } }] }, finish_reason }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });

describe("#1089 OpenAI Chat client conformance", () => {
  it("preserves custom schema, strictness, explicit choice, and parallel policy in Chat format", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "m", structuredClone(chat), false);
    expect(out.tools[0].function).toMatchObject({ name: "ns.search", strict: false, parameters: schema });
    expect(out.tool_choice).toEqual(chat.tool_choice);
    expect(out.parallel_tool_calls).toBe(false);
  });

  it("translates custom tools and explicit policies to Claude", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", structuredClone(chat), false);
    expect(out.tools[0]).toMatchObject({ name: "ns.search", input_schema: schema });
    expect(out.tool_choice).toMatchObject({ type: "tool", name: "ns.search" });
  });

  it("translates custom tools to Gemini", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "gemini-2.5-pro", structuredClone(chat), false);
    expect(out.tools).toBeDefined();
  });

  it("keeps tool call and finish reason in Chat non-stream response", () => {
    const out = translateNonStreamingResponse(completion("tool_calls"), FORMATS.OPENAI, FORMATS.OPENAI);
    expect(out.choices[0].message.tool_calls[0].function.name).toBe("ns.search");
    expect(out.choices[0].finish_reason).toBe("tool_calls");
  });

  it("keeps tool call in Chat stream response", () => {
    const state = initState(FORMATS.OPENAI);
    const out = translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c", type: "function", function: { name: "ns.search", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }, state);
    expect(out[0].choices[0].delta.tool_calls[0].function.name).toBe("ns.search");
  });
});
