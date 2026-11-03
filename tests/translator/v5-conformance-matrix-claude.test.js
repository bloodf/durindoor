import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("#1089 Claude Messages client conformance", () => {
  it("already-present: Claude tool input_schema and cache_control survive Claude target", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, "claude-sonnet-4-5", {
      max_tokens: 100,
      system: [{ type: "text", text: "rules", cache_control: { type: "ephemeral" } }],
      tools: [{ name: "ns.search", description: "find", input_schema: { type: "object", properties: { q: { type: "string" } } }, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "text", text: "find", cache_control: { type: "ephemeral" } }] }],
    }, false);
    expect(out.tools[0].input_schema.properties.q.type).toBe("string");
    expect(out.tools[0].cache_control.type).toBe("ephemeral");
    expect(out.system[0].cache_control.type).toBe("ephemeral");
    // prepareClaudeRequest strips user-block cache_control by design; only system/tools/last assistant keep it.
    expect(out.messages[0].content[0].cache_control).toBeUndefined();
  });

  it("already-present: OpenAI source cache_control survives Claude target", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", {
      messages: [
        { role: "system", content: [{ type: "text", text: "rules", cache_control: { type: "ephemeral" } }] },
        { role: "user", content: [{ type: "text", text: "find", cache_control: { type: "ephemeral" } }] },
      ],
    }, false);
    const blocks = [...(out.system || []), ...out.messages.flatMap((m) => m.content)];
    expect(blocks.some((b) => b.cache_control?.type === "ephemeral")).toBe(true);
  });

  const streamTo = (stopReason, withStop = true) => {
    const state = initState(FORMATS.CLAUDE);
    const events = [
      { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "x", content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 2 } },
      ...(withStop ? [{ type: "message_stop" }] : []),
    ];
    return events.flatMap((e) => translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, e, state) || []);
  };

  it("already-present: Claude stop_reason maps to OpenAI finish_reason", () => {
    const chunks = streamTo("max_tokens");
    expect(chunks.at(-1).choices[0].finish_reason).toBe("length");
  });

  it("already-present: Claude stream terminal completes OpenAI stream with one finish", () => {
    const chunks = streamTo("end_turn");
    expect(chunks.at(-1).choices[0].finish_reason).toBe("stop");
    expect(chunks.filter((c) => c.choices?.[0]?.finish_reason).length).toBe(1);
  });
});

const { CLAUDE, OPENAI: CHAT, OPENAI_RESPONSES: RESPONSES, GEMINI } = FORMATS;

const keywordSchema = {
  type: "object",
  properties: { type: { type: "string" }, properties: { type: "array", items: { type: "string" } } },
  required: ["type"],
};

const claudeBody = (extra = {}) => ({
  max_tokens: 100,
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "ns.search", input: { type: "a" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "ok" }] }] },
  ],
  tools: [{ name: "ns.search", description: "S", input_schema: keywordSchema, strict: true }],
  ...extra,
});

const fromClaude = (target, extra) => translateRequest(CLAUDE, target, "m", structuredClone(claudeBody(extra)), false);

describe("#1089 Claude Messages client requests to Chat, Responses and Gemini", () => {
  it.each([[CHAT, (o) => o.tools[0].function], [RESPONSES, (o) => o.tools[0]]])(
    "keeps the tool name, keyword-named properties and strict true for %s", (target, pick) => {
      const tool = pick(fromClaude(target));
      expect(tool.name).toBe("ns.search");
      expect(tool.parameters).toEqual(keywordSchema);
      expect(tool.strict).toBe(true);
    });

  it("keeps the tool name and keyword-named properties for Gemini", () => {
    const decl = fromClaude(GEMINI).tools[0].functionDeclarations[0];
    expect(decl.name).toBe("ns.search");
    expect(decl.parameters.properties.properties).toBeDefined();
  });

  it.each([
    [{ type: "auto" }, "auto", "AUTO"],
    [{ type: "any" }, "required", "ANY"],
    [{ type: "none" }, "none", "NONE"],
  ])("maps tool_choice %j to Chat/Responses %s and Gemini %s", (tool_choice, openai, gemini) => {
    expect(fromClaude(CHAT, { tool_choice }).tool_choice).toBe(openai);
    expect(fromClaude(RESPONSES, { tool_choice }).tool_choice).toBe(openai);
    expect(fromClaude(GEMINI, { tool_choice }).toolConfig.functionCallingConfig.mode).toBe(gemini);
  });

  it("maps a named tool_choice to Chat, Responses and Gemini", () => {
    const tool_choice = { type: "tool", name: "ns.search" };
    expect(fromClaude(CHAT, { tool_choice }).tool_choice).toEqual({ type: "function", function: { name: "ns.search" } });
    expect(fromClaude(RESPONSES, { tool_choice }).tool_choice).toEqual({ type: "function", name: "ns.search" });
    expect(fromClaude(GEMINI, { tool_choice }).toolConfig.functionCallingConfig).toEqual({ mode: "ANY", allowedFunctionNames: ["ns.search"] });
  });

  it("carries disable_parallel_tool_use as parallel_tool_calls false for Chat and Responses", () => {
    const tool_choice = { type: "auto", disable_parallel_tool_use: true };
    expect(fromClaude(CHAT, { tool_choice }).parallel_tool_calls).toBe(false);
    expect(fromClaude(RESPONSES, { tool_choice }).parallel_tool_calls).toBe(false);
    expect(fromClaude(CHAT, { tool_choice: { type: "auto" } }).parallel_tool_calls).toBeUndefined();
    // OpenAI rejects parallel_tool_calls without tools.
    expect(fromClaude(CHAT, { tools: undefined, tool_choice }).parallel_tool_calls).toBeUndefined();
  });

  it("pairs tool_result with tool_use for Chat, Responses and Gemini", () => {
    const chat = fromClaude(CHAT);
    expect(chat.messages[2]).toMatchObject({ role: "tool", tool_call_id: chat.messages[1].tool_calls[0].id });
    const resp = fromClaude(RESPONSES);
    expect(resp.input.find((i) => i.type === "function_call_output").call_id).toBe(resp.input.find((i) => i.type === "function_call").call_id);
    const gem = fromClaude(GEMINI);
    expect(gem.contents[1].parts[0].functionCall.name).toBe("ns.search");
    expect(JSON.stringify(gem.contents[2])).toContain("ok");
  });

  it.each([[CHAT], [RESPONSES], [GEMINI]])("rejects malformed tool schemas with HTTP 400 for %s", (target) => {
    const tools = [{ name: "x", input_schema: { type: "object", properties: "bad" } }];
    expect(() => fromClaude(target, { tools, tool_choice: undefined })).toThrowError(expect.objectContaining({ statusCode: 400 }));
  });

  it("coerces string numeric schema constraints for Chat and Gemini", () => {
    const tools = [{ name: "x", input_schema: { type: "object", properties: { n: { type: "integer", minimum: "1", maximum: "5" } } } }];
    expect(fromClaude(CHAT, { tools }).tools[0].function.parameters.properties.n).toMatchObject({ minimum: 1, maximum: 5 });
    expect(fromClaude(GEMINI, { tools }).tools[0].functionDeclarations[0].parameters.properties.n).toMatchObject({ minimum: 1, maximum: 5 });
  });

  it("replaces inline tool_result image bytes with a media-type label for Chat and Responses (by contract)", () => {
    const messages = claudeBody().messages.slice();
    messages[2] = { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "ok" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] }] };
    const chat = fromClaude(CHAT, { messages });
    expect(chat.messages[2].content).toBe("ok\n[tool result omitted image: image/png]");
    expect(JSON.stringify(fromClaude(RESPONSES, { messages }))).not.toContain("AAAA");
  });
});

describe("#1089 Gemini replies to a Claude Messages client", () => {
  const run = (parts, finishReason) => {
    const state = initState(CLAUDE);
    const chunk = { response: { candidates: [{ content: { role: "model", parts }, finishReason }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }, modelVersion: "g" };
    return translateResponse(GEMINI, CLAUDE, chunk, state) || [];
  };

  it("emits tool_use for a functionCall and a tool_use stop_reason", () => {
    const events = run([{ functionCall: { name: "ns.search", args: { type: "a" } } }], "STOP");
    expect(events.find((e) => e.content_block?.type === "tool_use").content_block.name).toBe("ns.search");
    expect(events.find((e) => e.type === "message_delta").delta.stop_reason).toBe("tool_use");
  });

  it("maps MAX_TOKENS to max_tokens", () => {
    const events = run([{ text: "partial" }], "MAX_TOKENS");
    expect(events.find((e) => e.type === "message_delta").delta.stop_reason).toBe("max_tokens");
  });
});
