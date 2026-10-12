import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CLAUDE_BLOCK, OPENAI_BLOCK, RESPONSES_ITEM, ROLE } from "../../open-sse/translator/schema/index.js";

const schema = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
const chat = (extra = {}) => ({
  messages: [{ role: ROLE.USER, content: "search" }],
  tools: [{ type: OPENAI_BLOCK.FUNCTION, function: { name: "search", parameters: schema } }],
  ...extra,
});
const namespaceRequest = () => ({
  input: [
    { type: RESPONSES_ITEM.FUNCTION_CALL, call_id: "call_previous", name: "search", namespace: "research", arguments: '{"q":"old"}' },
    { type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: "call_previous", output: "old result" },
    { type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: "search again" },
  ],
  tools: [{ type: "namespace", name: "research", tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "search", parameters: schema }] }],
  tool_choice: { type: OPENAI_BLOCK.FUNCTION, name: "search", namespace: "research" },
});

// #1089 T3: helper-only choice coverage does not exercise the second registered hop.
describe("#1274 registered Responses namespace forced choice", () => {
  it.each([FORMATS.CLAUDE, FORMATS.GEMINI])("control: Chat forced selection reaches %s without thinking enabled", (target) => {
    const out = translateRequest(FORMATS.OPENAI, target, target === FORMATS.CLAUDE ? "claude-haiku-4-5" : "gemini-test", chat({
      tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: "search" } },
    }), false);
    if (target === FORMATS.CLAUDE) {
      expect(out.thinking?.type).not.toBe("enabled");
      expect(out.thinking?.type).not.toBe("adaptive");
      expect(out.tool_choice).toEqual({ type: "tool", name: "search" });
    } else {
      expect(out.toolConfig).toEqual({ functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["search"] } });
    }
  });

  it("Claude keeps forced selection on the same alias as declaration and history", () => {
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, "claude-haiku-4-5", namespaceRequest(), false);
    const name = out.tools[0].name;
    const history = out.messages.flatMap((message) => message.content).find((block) => block.type === CLAUDE_BLOCK.TOOL_USE);
    expect(history.name).toBe(name);
    expect(out._toolNameMap.get(name)).toBe("research.search");
    expect(out.tool_choice).toEqual({ type: "tool", name });
  });

  it("Gemini keeps forced selection on the same alias as declaration and history", () => {
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.GEMINI, "gemini-test", namespaceRequest(), false);
    const name = out.tools[0].functionDeclarations[0].name;
    const history = out.contents.flatMap((turn) => turn.parts).find((part) => part.functionCall);
    expect(history.functionCall.name).toBe(name);
    expect(out._toolNameMap.get(name)).toBe("research.search");
    expect(out.toolConfig).toEqual({ functionCallingConfig: { mode: "ANY", allowedFunctionNames: [name] } });
  });
});

// #1089 T5: strict booleans already have field mappings, but no registered Claude round-trip assertion.
describe("#1274 registered Claude strict flags", () => {
  it.each([false, true])("Chat to Claude and back preserves strict=%s", (strict) => {
    const body = chat({ tools: [{ type: OPENAI_BLOCK.FUNCTION, function: { name: "search", parameters: schema, strict } }] });
    const claude = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-haiku-4-5", body, false);
    expect(claude.tools[0]).toMatchObject({ name: "search", input_schema: schema, strict });
    const restored = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", claude, false);
    expect(restored.tools[0].function).toMatchObject({ name: "search", parameters: schema, strict });
  });
});

// #1089 T8: acceptance boundaries of the shared lowering fix, not numeric call enforcement.
describe("#1274 Claude parallel ban guards", () => {
  it("creates auto choice when a tool-bearing caller bans parallel calls without choosing a tool", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-haiku-4-5", chat({ parallel_tool_calls: false }), false);
    expect(out.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(out).not.toHaveProperty("parallel_tool_calls");
  });

  it("does not add a parallel ban when tools are explicitly disabled", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-haiku-4-5", chat({ parallel_tool_calls: false, tool_choice: "none" }), false);
    expect(out.tool_choice).toEqual({ type: "none" });
    expect(out).not.toHaveProperty("parallel_tool_calls");
  });

  it("does not fabricate a tool choice without declarations", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-haiku-4-5", {
      messages: [{ role: ROLE.USER, content: "hello" }], parallel_tool_calls: false,
    }, false);
    expect(out).not.toHaveProperty("tools");
    expect(out).not.toHaveProperty("tool_choice");
    expect(out).not.toHaveProperty("parallel_tool_calls");
  });
});

// #1089 N2/T1: existing custom JSON tests call a helper; exercise the complete JSON dispatch seam.
describe("#1274 Responses custom JSON dispatch", () => {
  it.each([FORMATS.OPENAI, FORMATS.CLAUDE])("keeps raw custom input, call identity and cache usage for %s clients", (client) => {
    const raw = "*** Begin Patch\n+private fixture\n*** End Patch";
    const out = translateNonStreamingResponse({
      id: "resp_fixture", model: "fixture-model", status: "completed",
      output: [{ type: "custom_tool_call", call_id: "call_patch", name: "apply_patch", input: raw }],
      usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13, input_tokens_details: { cached_tokens: 4 } },
    }, FORMATS.OPENAI_RESPONSES, client);
    if (client === FORMATS.CLAUDE) {
      expect(out.content).toEqual([{ type: CLAUDE_BLOCK.TOOL_USE, id: "call_patch", name: "apply_patch", input: { input: raw } }]);
      expect(out.stop_reason).toBe("tool_use");
      expect(out.usage).toMatchObject({ input_tokens: 6, output_tokens: 3, cache_read_input_tokens: 4 });
      expect(out).not.toHaveProperty("output");
    } else {
      expect(out.choices[0].message.tool_calls).toEqual([{ id: "call_patch", type: OPENAI_BLOCK.FUNCTION, function: { name: "apply_patch", arguments: JSON.stringify({ input: raw }) } }]);
      expect(out.choices[0].finish_reason).toBe("tool_calls");
      expect(out.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 3, total_tokens: 13, prompt_tokens_details: { cached_tokens: 4 } });
      expect(out).not.toHaveProperty("output");
    }
  });
});
