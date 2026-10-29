import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CLAUDE_STOP, GEMINI_FINISH, GEMINI_ROLE, OPENAI_BLOCK, OPENAI_FINISH, ROLE } from "../../open-sse/translator/schema/index.js";

const CHAT = FORMATS.OPENAI;
const CLAUDE = FORMATS.CLAUDE;
const GEMINI = FORMATS.GEMINI;
const RESPONSES = FORMATS.OPENAI_RESPONSES;
const KIRO = FORMATS.KIRO;

const keywordSchema = {
  type: "object",
  properties: {
    type: { type: "string" },
    properties: { type: "array", items: { type: "string" } },
    items: { type: "string" },
    required: { type: "boolean" },
  },
  required: ["type"],
};

const namespacedTool = (strict = false, parameters = keywordSchema) => ({
  type: OPENAI_BLOCK.FUNCTION,
  function: { name: "ns.search", description: "Search", parameters, strict },
});

const chatBody = (extra = {}) => ({
  messages: [{ role: ROLE.USER, content: "hi" }],
  tools: [namespacedTool(false)],
  tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: "ns.search" } },
  parallel_tool_calls: false,
  ...extra,
});

const modelFor = (target) => {
  if (target === CLAUDE) return "claude-sonnet-4-5";
  if (target === GEMINI) return "gemini-2.5-pro";
  return "m";
};

const request = (target, body, stream = false) =>
  translateRequest(CHAT, target, modelFor(target), structuredClone(body), stream);

const completion = (finish_reason, message) => ({
  id: "chat-1089",
  model: "m",
  object: "chat.completion",
  choices: [{ index: 0, message, finish_reason }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

const toolMessage = {
  role: ROLE.ASSISTANT,
  content: null,
  tool_calls: [{ id: "c", type: OPENAI_BLOCK.FUNCTION, function: { name: "ns.search", arguments: '{"type":"a"}' } }],
};

const textMessage = (content = "partial") => ({ role: ROLE.ASSISTANT, content });

const nonstream = (target, finish, message = textMessage()) =>
  translateNonStreamingResponse(completion(finish, message), CHAT, target);

const streamTo = (target, chunks, requestBody) => {
  const state = initState(target === RESPONSES ? RESPONSES : CHAT, requestBody);
  return chunks.flatMap((chunk) => translateResponse(CHAT, target, chunk, state) || []);
};

const geminiDecl = (out) => out.tools[0].functionDeclarations[0];
const kiroTool = (out) =>
  out.conversationState?.currentMessage?.userInputMessage?.userInputMessageContext?.tools?.[0]
  || out.history?.find((entry) => entry.userInputMessage)?.userInputMessage?.userInputMessageContext?.tools?.[0];

describe("#1089 OpenAI Chat client conformance — tools and policies", () => {
  it("preserves namespaced tool, keyword schema, strict false, named choice, and parallel false in Chat", () => {
    const out = request(CHAT, chatBody());
    expect(out.tools[0].function).toMatchObject({
      name: "ns.search",
      strict: false,
      parameters: keywordSchema,
    });
    expect(out.tool_choice).toEqual({ type: OPENAI_BLOCK.FUNCTION, function: { name: "ns.search" } });
    expect(out.parallel_tool_calls).toBe(false);
  });

  it("translates namespaced tool, keyword schema, and named choice to Claude", () => {
    const out = request(CLAUDE, chatBody());
    expect(out.tools[0]).toMatchObject({
      name: "ns.search",
      input_schema: keywordSchema,
      strict: false,
    });
    expect(out.tool_choice).toMatchObject({ type: "tool", name: "ns.search", disable_parallel_tool_use: true });
  });

  it("translates namespaced tool, keyword schema, and named choice to Gemini", () => {
    const out = request(GEMINI, chatBody());
    expect(geminiDecl(out)).toEqual({
      name: "ns.search",
      description: "Search",
      parameters: keywordSchema,
    });
    expect(out.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["ns.search"] },
    });
    expect(JSON.stringify(out.tools)).not.toContain('"strict"');
  });

  it("translates namespaced tool and strict false to Responses", () => {
    const out = request(RESPONSES, chatBody());
    expect(out.tools[0]).toEqual({
      type: OPENAI_BLOCK.FUNCTION,
      name: "ns.search",
      description: "Search",
      parameters: keywordSchema,
      strict: false,
    });
    expect(out.parallel_tool_calls).toBe(false);
  });

  it.each([true, false])("preserves explicit strict=%s through Claude", (strict) => {
    const out = request(CLAUDE, chatBody({
      tools: [namespacedTool(strict)],
      tool_choice: "auto",
    }));
    expect(out.tools[0].strict).toBe(strict);
    expect(out.tools[0].input_schema).toEqual(keywordSchema);
  });

  it.each([true, false])("preserves explicit strict=%s through Responses", (strict) => {
    const out = request(RESPONSES, chatBody({
      tools: [namespacedTool(strict)],
      tool_choice: "auto",
    }));
    expect(out.tools[0].strict).toBe(strict);
    expect(out.tools[0].parameters).toEqual(keywordSchema);
  });

  it("delivers schema to Gemini without an OpenAI strict field when strict is true", () => {
    const out = request(GEMINI, chatBody({
      tools: [namespacedTool(true)],
      tool_choice: "auto",
    }));
    expect(geminiDecl(out).parameters).toEqual(keywordSchema);
    expect(JSON.stringify(out.tools)).not.toContain('"strict"');
  });

  it.each([
    ["auto", { type: "auto", disable_parallel_tool_use: true }],
    ["none", { type: "none" }],
    ["required", { type: "any", disable_parallel_tool_use: true }],
  ])("maps tool_choice %s to Claude", (choice, expected) => {
    const out = request(CLAUDE, chatBody({ tool_choice: choice }));
    expect(out.tool_choice).toEqual(expected);
  });

  it("maps named tool_choice to Gemini ANY with allowedFunctionNames", () => {
    const out = request(GEMINI, chatBody({
      tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: "ns.search" } },
    }));
    expect(out.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["ns.search"] },
    });
  });

  // #1089 failing: #1328 Chat→Gemini only maps named function tool_choice; string auto is dropped.
  it.skip("maps tool_choice auto to Gemini AUTO mode", () => {
    const out = request(GEMINI, chatBody({ tool_choice: "auto", parallel_tool_calls: true }));
    expect(out.toolConfig).toEqual({ functionCallingConfig: { mode: "AUTO" } });
  });

  // #1089 failing: #1328 Chat→Gemini only maps named function tool_choice; string none is dropped.
  it.skip("maps tool_choice none to Gemini NONE mode", () => {
    const out = request(GEMINI, chatBody({ tool_choice: "none" }));
    expect(out.toolConfig).toEqual({ functionCallingConfig: { mode: "NONE" } });
  });

  // #1089 failing: #1328 Chat→Gemini only maps named function tool_choice; string required is dropped.
  it.skip("maps tool_choice required to Gemini ANY mode", () => {
    const out = request(GEMINI, chatBody({ tool_choice: "required", parallel_tool_calls: true }));
    expect(out.toolConfig).toEqual({ functionCallingConfig: { mode: "ANY" } });
  });

  // #1089 failing: #1329 openaiToOpenAIResponsesRequest never copies tool_choice from Chat.
  it.skip("preserves tool_choice auto on Chat to Responses", () => {
    const out = request(RESPONSES, chatBody({ tool_choice: "auto" }));
    expect(out.tool_choice).toBe("auto");
  });

  // #1089 failing: #1329 openaiToOpenAIResponsesRequest never copies tool_choice from Chat.
  it.skip("preserves tool_choice none on Chat to Responses", () => {
    const out = request(RESPONSES, chatBody({ tool_choice: "none" }));
    expect(out.tool_choice).toBe("none");
  });

  // #1089 failing: #1329 openaiToOpenAIResponsesRequest never copies tool_choice from Chat.
  it.skip("preserves tool_choice required on Chat to Responses", () => {
    const out = request(RESPONSES, chatBody({ tool_choice: "required" }));
    expect(out.tool_choice).toBe("required");
  });

  // #1089 failing: #1329 openaiToOpenAIResponsesRequest never copies tool_choice from Chat.
  it.skip("preserves named tool_choice on Chat to Responses", () => {
    const out = request(RESPONSES, chatBody({
      tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: "ns.search" } },
    }));
    expect(out.tool_choice).toEqual({ type: OPENAI_BLOCK.FUNCTION, name: "ns.search" });
  });

  it("carries parallel_tool_calls false as Claude disable_parallel_tool_use", () => {
    const out = request(CLAUDE, chatBody({ tool_choice: "auto", parallel_tool_calls: false }));
    expect(out.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(out).not.toHaveProperty("parallel_tool_calls");
  });

  it("leaves Claude unrestricted when parallel_tool_calls is true", () => {
    const out = request(CLAUDE, chatBody({ tool_choice: "auto", parallel_tool_calls: true }));
    expect(out.tool_choice).toEqual({ type: "auto" });
    expect(out.tool_choice.disable_parallel_tool_use).toBeUndefined();
  });

  it("preserves parallel_tool_calls false and true on Chat to Responses", () => {
    expect(request(RESPONSES, chatBody({ tool_choice: "auto", parallel_tool_calls: false })).parallel_tool_calls).toBe(false);
    expect(request(RESPONSES, chatBody({ tool_choice: "auto", parallel_tool_calls: true })).parallel_tool_calls).toBe(true);
  });

  it("does not invent a Claude parallel ban from max_tool_calls", () => {
    const out = request(CLAUDE, chatBody({ tool_choice: "auto", parallel_tool_calls: true, max_tool_calls: 1 }));
    expect(out.tool_choice?.disable_parallel_tool_use).not.toBe(true);
    expect(out).not.toHaveProperty("max_tool_calls");
  });
});

describe("#1089 OpenAI Chat client conformance — terminals", () => {
  it("maps non-stream length to Claude max_tokens with text", () => {
    const out = nonstream(CLAUDE, OPENAI_FINISH.LENGTH);
    expect(out.stop_reason).toBe(CLAUDE_STOP.MAX_TOKENS);
    expect(out.content[0]).toEqual({ type: "text", text: "partial" });
  });

  it("maps non-stream length to Gemini MAX_TOKENS with text", () => {
    const out = nonstream(GEMINI, OPENAI_FINISH.LENGTH);
    expect(out.candidates[0]).toMatchObject({
      finishReason: GEMINI_FINISH.MAX_TOKENS,
      content: { role: GEMINI_ROLE.MODEL, parts: [{ text: "partial" }] },
    });
    expect(out).not.toHaveProperty("choices");
  });

  // #1089 failing: #1331 Chat→Responses non-stream copies finish_reason "length" into status instead of incomplete/max_output_tokens.
  it.skip("maps non-stream length to Responses incomplete with max_output_tokens", () => {
    const out = nonstream(RESPONSES, OPENAI_FINISH.LENGTH);
    expect(out.status).toBe("incomplete");
    expect(out.incomplete_details).toEqual({ reason: "max_output_tokens" });
    expect(out.output[0].content[0]).toMatchObject({ type: "output_text", text: "partial" });
  });

  it("maps non-stream content_filter to Gemini SAFETY", () => {
    const out = nonstream(GEMINI, OPENAI_FINISH.CONTENT_FILTER);
    expect(out.candidates[0].finishReason).toBe(GEMINI_FINISH.SAFETY);
    expect(out.candidates[0].content.parts[0].text).toBe("partial");
  });

  // #1089 failing: #1331 Chat→Responses non-stream copies finish_reason "content_filter" into status instead of incomplete/content_filter.
  it.skip("maps non-stream content_filter to Responses incomplete with content_filter", () => {
    const out = nonstream(RESPONSES, OPENAI_FINISH.CONTENT_FILTER);
    expect(out.status).toBe("incomplete");
    expect(out.incomplete_details).toEqual({ reason: "content_filter" });
    expect(out.output[0].content[0].text).toBe("partial");
  });

  // #1089 failing: #1331 Chat→Responses non-stream copies finish_reason "error" into status instead of failed with an error object.
  it.skip("maps non-stream error finish to Responses failed with error object", () => {
    const out = nonstream(RESPONSES, OPENAI_FINISH.ERROR);
    expect(out.status).toBe("failed");
    expect(out.error).toEqual(expect.any(Object));
    expect(out.output[0].content[0].text).toBe("partial");
  });

  // #1089 failing: #1330 Chat JSON error finish collapses to Claude end_turn instead of an error terminal.
  it.skip("maps non-stream error finish to a Claude error terminal", () => {
    const out = nonstream(CLAUDE, OPENAI_FINISH.ERROR);
    expect(out.stop_reason).not.toBe(CLAUDE_STOP.END_TURN);
    expect(out).toMatchObject({ type: "error" });
  });

  // #1089 failing: #1330 Chat JSON error finish collapses to Gemini STOP instead of an abort reason.
  it.skip("maps non-stream error finish to a Gemini abort finishReason", () => {
    const out = nonstream(GEMINI, OPENAI_FINISH.ERROR);
    expect(out.candidates[0].finishReason).not.toBe(GEMINI_FINISH.STOP);
    expect(out.candidates[0].finishReason).toBe(GEMINI_FINISH.OTHER);
  });

  it("emits Claude stream length as message_delta max_tokens", () => {
    const events = streamTo(CLAUDE, [{
      id: "x",
      choices: [{ index: 0, delta: { content: "hi" }, finish_reason: OPENAI_FINISH.LENGTH }],
    }]);
    expect(events.find((event) => event.type === "content_block_delta").delta).toEqual({
      type: "text_delta",
      text: "hi",
    });
    expect(events.find((event) => event.type === "message_delta").delta.stop_reason).toBe(CLAUDE_STOP.MAX_TOKENS);
  });

  it("emits Gemini stream length as MAX_TOKENS with text", () => {
    const [out] = streamTo(GEMINI, [{
      id: "x",
      choices: [{ index: 0, delta: { content: "hi" }, finish_reason: OPENAI_FINISH.LENGTH }],
    }]);
    expect(out.response.candidates[0]).toMatchObject({
      finishReason: GEMINI_FINISH.MAX_TOKENS,
      content: { role: GEMINI_ROLE.MODEL, parts: [{ text: "hi" }] },
    });
  });

  it("emits Gemini stream content_filter as SAFETY with text", () => {
    const [out] = streamTo(GEMINI, [{
      id: "x",
      choices: [{ index: 0, delta: { content: "hi" }, finish_reason: OPENAI_FINISH.CONTENT_FILTER }],
    }]);
    expect(out.response.candidates[0]).toMatchObject({
      finishReason: GEMINI_FINISH.SAFETY,
      content: { role: GEMINI_ROLE.MODEL, parts: [{ text: "hi" }] },
    });
  });

  it("emits Claude stream error as an Anthropic error event", () => {
    const events = streamTo(CLAUDE, [{
      id: "x",
      choices: [{ index: 0, delta: { content: "boom" }, finish_reason: OPENAI_FINISH.ERROR }],
    }]);
    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: { type: "api_error", message: expect.any(String) },
    });
  });

  it("emits Gemini stream error as OTHER finishReason", () => {
    const [out] = streamTo(GEMINI, [{
      id: "x",
      choices: [{ index: 0, delta: { content: "boom" }, finish_reason: OPENAI_FINISH.ERROR }],
    }]);
    expect(out.response.candidates[0].finishReason).toBe(GEMINI_FINISH.OTHER);
    expect(out.response.candidates[0].content.parts[0].text).toBe("boom");
  });

  // #1089 failing: #1331 Chat→Responses stream flush reports response.completed after finish_reason length.
  it.skip("emits Responses stream incomplete for Chat length finish", () => {
    const events = streamTo(RESPONSES, [
      { id: "x", choices: [{ index: 0, delta: { content: "partial" }, finish_reason: OPENAI_FINISH.LENGTH }] },
      null,
    ]);
    const incomplete = events.find((event) => event.event === "response.incomplete" || event.data?.type === "response.incomplete");
    expect(incomplete).toBeTruthy();
    expect(events.some((event) => event.event === "response.completed")).toBe(false);
  });

  // #1089 failing: #1331 Chat→Responses stream flush never emits response.failed for finish_reason error.
  it.skip("emits Responses stream failed for Chat error finish", () => {
    const events = streamTo(RESPONSES, [
      { id: "x", choices: [{ index: 0, delta: { content: "boom" }, finish_reason: OPENAI_FINISH.ERROR }] },
      null,
    ]);
    const failed = events.find((event) => event.event === "response.failed" || event.data?.type === "response.failed");
    expect(failed).toBeTruthy();
  });
});

describe("#1089 OpenAI Chat client conformance — tool calls and media", () => {
  it("keeps tool call identity and finish_reason in Chat non-stream", () => {
    const out = nonstream(CHAT, OPENAI_FINISH.TOOL_CALLS, toolMessage);
    expect(out.choices[0].finish_reason).toBe(OPENAI_FINISH.TOOL_CALLS);
    expect(out.choices[0].message.tool_calls[0]).toEqual({
      id: "c",
      type: OPENAI_BLOCK.FUNCTION,
      function: { name: "ns.search", arguments: '{"type":"a"}' },
    });
  });

  it("keeps tool call identity and finish_reason in Chat stream", () => {
    const [out] = streamTo(CHAT, [{
      id: "x",
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "c",
            type: OPENAI_BLOCK.FUNCTION,
            function: { name: "ns.search", arguments: '{"type":"a"}' },
          }],
        },
        finish_reason: OPENAI_FINISH.TOOL_CALLS,
      }],
    }]);
    expect(out.choices[0].finish_reason).toBe(OPENAI_FINISH.TOOL_CALLS);
    expect(out.choices[0].delta.tool_calls[0]).toEqual({
      index: 0,
      id: "c",
      type: OPENAI_BLOCK.FUNCTION,
      function: { name: "ns.search", arguments: '{"type":"a"}' },
    });
  });

  it("projects non-stream tool calls to Claude tool_use", () => {
    const out = nonstream(CLAUDE, OPENAI_FINISH.TOOL_CALLS, toolMessage);
    expect(out.stop_reason).toBe(CLAUDE_STOP.TOOL_USE);
    expect(out.content[0]).toMatchObject({ type: "tool_use", id: "c", name: "ns.search", input: { type: "a" } });
  });

  it("projects non-stream tool calls to Gemini functionCall", () => {
    const out = nonstream(GEMINI, OPENAI_FINISH.TOOL_CALLS, toolMessage);
    expect(out.candidates[0].content.parts[0].functionCall).toEqual({
      id: "c",
      name: "ns.search",
      args: { type: "a" },
    });
  });

  it("projects non-stream tool calls to Responses function_call", () => {
    const out = nonstream(RESPONSES, OPENAI_FINISH.TOOL_CALLS, toolMessage);
    expect(out.output[0]).toMatchObject({
      type: "function_call",
      call_id: "c",
      name: "ns.search",
      arguments: '{"type":"a"}',
    });
  });

  it("streams tool calls to Claude with tool_use stop", () => {
    const events = streamTo(CLAUDE, [{
      id: "x",
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "c",
            type: OPENAI_BLOCK.FUNCTION,
            function: { name: "ns.search", arguments: '{"type":"a"}' },
          }],
        },
        finish_reason: OPENAI_FINISH.TOOL_CALLS,
      }],
    }]);
    const start = events.find((event) => event.type === "content_block_start");
    expect(start.content_block).toMatchObject({ type: "tool_use", id: "c", name: "ns.search" });
    expect(events.find((event) => event.type === "message_delta").delta.stop_reason).toBe(CLAUDE_STOP.TOOL_USE);
  });

  it("streams tool calls to Gemini with functionCall name and args", () => {
    const [out] = streamTo(GEMINI, [{
      id: "x",
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "c",
            type: OPENAI_BLOCK.FUNCTION,
            function: { name: "ns.search", arguments: '{"type":"a"}' },
          }],
        },
        finish_reason: OPENAI_FINISH.TOOL_CALLS,
      }],
    }]);
    expect(out.response.candidates[0].content.parts[0].functionCall).toMatchObject({
      name: "ns.search",
      args: { type: "a" },
    });
  });

  it("streams tool calls to Responses with call identity and completed arguments", () => {
    const events = streamTo(RESPONSES, [
      {
        id: "x",
        choices: [{
          index: 0,
          delta: {
            role: ROLE.ASSISTANT,
            tool_calls: [{
              index: 0,
              id: "c",
              type: OPENAI_BLOCK.FUNCTION,
              function: { name: "ns.search", arguments: "" },
            }],
          },
        }],
      },
      {
        id: "x",
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: '{"type":"a"}' } }] },
          finish_reason: OPENAI_FINISH.TOOL_CALLS,
        }],
      },
    ], chatBody());
    const added = events.find((event) => event.event === "response.output_item.added");
    expect(added.data.item).toMatchObject({
      type: "function_call",
      call_id: "c",
      name: "ns.search",
    });
    const done = events.find((event) => event.event === "response.function_call_arguments.done");
    expect(done.data.arguments).toBe('{"type":"a"}');
  });

  const mediaBody = {
    messages: [
      { role: ROLE.USER, content: "hi" },
      {
        role: ROLE.ASSISTANT,
        content: null,
        tool_calls: [{ id: "c1", type: OPENAI_BLOCK.FUNCTION, function: { name: "fetch", arguments: "{}" } }],
      },
      {
        role: ROLE.TOOL,
        tool_call_id: "c1",
        content: [
          { type: OPENAI_BLOCK.TEXT, text: "see" },
          { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: "https://example.invalid/a.png" } },
        ],
      },
    ],
    tools: [{ type: OPENAI_BLOCK.FUNCTION, function: { name: "fetch", parameters: { type: "object" } } }],
  };

  // #1089 failing: #1332 Chat→Claude leaves OpenAI image_url blocks inside tool_result instead of Claude image sources.
  it.skip("converts tool-result image_url media to Claude image blocks", () => {
    const out = request(CLAUDE, mediaBody);
    const result = out.messages.find((message) =>
      Array.isArray(message.content) && message.content.some((block) => block.type === "tool_result"));
    const toolResult = result.content.find((block) => block.type === "tool_result");
    expect(toolResult.tool_use_id).toBe("c1");
    expect(toolResult.content).toEqual(expect.arrayContaining([
      { type: "text", text: "see" },
      { type: "image", source: { type: "url", url: "https://example.invalid/a.png" } },
    ]));
    expect(JSON.stringify(toolResult)).not.toContain("image_url");
  });

  it("keeps tool-result image URL visible through Gemini functionResponse", () => {
    const out = request(GEMINI, mediaBody);
    const response = out.contents.find((entry) =>
      entry.parts?.some((part) => part.functionResponse?.id === "c1"));
    expect(JSON.stringify(response.parts[0].functionResponse.response)).toContain("https://example.invalid/a.png");
    expect(response.parts[0].functionResponse.name).toBe("fetch");
  });

  // #1089 failing: #1332 Chat→Responses stringifies tool-result image parts into output text instead of media items.
  it.skip("preserves tool-result image media on Chat to Responses", () => {
    const out = request(RESPONSES, mediaBody);
    const output = out.input.find((item) => item.type === "function_call_output" && item.call_id === "c1");
    expect(output.output).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "input_text", text: "see" }),
      expect.objectContaining({ type: "input_image", image_url: "https://example.invalid/a.png" }),
    ]));
  });

  const pairingBody = {
    messages: [
      { role: ROLE.USER, content: "first" },
      {
        role: ROLE.ASSISTANT,
        content: null,
        tool_calls: [{ id: "old", type: OPENAI_BLOCK.FUNCTION, function: { name: "a", arguments: "{}" } }],
      },
      { role: ROLE.TOOL, tool_call_id: "old", content: "old-result" },
      { role: ROLE.ASSISTANT, content: "mid" },
      { role: ROLE.USER, content: "second" },
      {
        role: ROLE.ASSISTANT,
        content: null,
        tool_calls: [{ id: "new", type: OPENAI_BLOCK.FUNCTION, function: { name: "b", arguments: "{}" } }],
      },
      { role: ROLE.TOOL, tool_call_id: "old", content: "wrong-cross-turn" },
      { role: ROLE.TOOL, tool_call_id: "new", content: "new-result" },
    ],
    tools: [
      { type: OPENAI_BLOCK.FUNCTION, function: { name: "a", parameters: { type: "object" } } },
      { type: OPENAI_BLOCK.FUNCTION, function: { name: "b", parameters: { type: "object" } } },
    ],
  };

  // #1335: turn-scoped pairing by call id (stray cross-turn results dropped).
  it("pairs Claude tool results only within the current assistant turn", () => {
    const out = request(CLAUDE, pairingBody);
    const toolResults = out.messages.flatMap((message) =>
      Array.isArray(message.content) ? message.content.filter((block) => block.type === "tool_result") : []);
    const current = toolResults.find((block) => block.tool_use_id === "new");
    expect(current).toMatchObject({ tool_use_id: "new", content: "new-result" });
    expect(toolResults.some((block) => block.tool_use_id === "old" && block.content === "wrong-cross-turn")).toBe(false);
    expect(JSON.stringify(out.messages)).not.toContain("[No response received]");
  });

  // #1335: turn-scoped pairing by call id (stray cross-turn results dropped).
  it("pairs Gemini tool results only within the current assistant turn", () => {
    const out = request(GEMINI, pairingBody);
    const responses = out.contents.flatMap((entry) =>
      (entry.parts || []).filter((part) => part.functionResponse).map((part) => part.functionResponse));
    const current = responses.find((part) => part.id === "new" || part.name === "b");
    expect(current).toMatchObject({ name: "b" });
    expect(JSON.stringify(current.response)).toContain("new-result");
    expect(JSON.stringify(out.contents)).not.toContain("wrong-cross-turn");
    expect(JSON.stringify(out.contents)).not.toContain("[No response received]");
  });

  // #1335: turn-scoped pairing by call id (stray cross-turn results dropped).
  it("pairs Responses tool results only within the current assistant turn", () => {
    const out = request(RESPONSES, pairingBody);
    const outputs = out.input.filter((item) => item.type === "function_call_output");
    expect(outputs.map((item) => [item.call_id, item.output])).toEqual([
      ["old", "old-result"],
      ["new", "new-result"],
    ]);
  });
});

describe("#1089 OpenAI Chat client conformance — #1091 schema edges", () => {
  // #1089 failing: #1333 Kiro calls description.trim on non-string object descriptions and throws TypeError.
  it.skip("coerces object tool descriptions before Kiro trim", () => {
    const out = request(KIRO, chatBody({
      tools: [{
        type: OPENAI_BLOCK.FUNCTION,
        function: { name: "lookup", description: { text: "find things" }, parameters: { type: "object", properties: {} } },
      }],
      tool_choice: "auto",
    }));
    expect(kiroTool(out).toolSpecification).toMatchObject({
      name: "lookup",
      description: expect.any(String),
    });
    expect(kiroTool(out).toolSpecification.description.length).toBeGreaterThan(0);
  });

  // #1089 failing: #1333 Kiro calls description.trim on numeric descriptions and throws TypeError.
  it.skip("coerces numeric tool descriptions before Kiro trim", () => {
    const out = request(KIRO, chatBody({
      tools: [{
        type: OPENAI_BLOCK.FUNCTION,
        function: { name: "lookup", description: 42, parameters: { type: "object", properties: {} } },
      }],
      tool_choice: "auto",
    }));
    expect(kiroTool(out).toolSpecification).toMatchObject({
      name: "lookup",
      description: expect.any(String),
    });
  });

  it("fills empty Kiro descriptions with a Tool: name fallback", () => {
    const out = request(KIRO, chatBody({
      tools: [{
        type: OPENAI_BLOCK.FUNCTION,
        function: { name: "lookup", description: "", parameters: { type: "object", properties: {} } },
      }],
      tool_choice: "auto",
    }));
    expect(kiroTool(out).toolSpecification).toEqual({
      name: "lookup",
      description: "Tool: lookup",
      inputSchema: { json: { type: "object", properties: {}, required: [] } },
    });
  });

  it("converts Gemini tuple prefixItems into items", () => {
    const schema = {
      type: "object",
      properties: {
        pair: { type: "array", prefixItems: [{ type: "string" }, { type: "number" }], items: false },
      },
    };
    const out = request(GEMINI, chatBody({
      tools: [namespacedTool(false, schema)],
      tool_choice: "auto",
    }));
    expect(geminiDecl(out).parameters).toEqual({
      type: "object",
      properties: { pair: { type: "array", items: { type: "string" } } },
    });
  });

  // #1351 fills missing `properties` on object schemas; free-form additionalProperties stays.
  it("preserves free-form object schemas on Claude", () => {
    const schema = { type: "object", additionalProperties: true };
    const out = request(CLAUDE, chatBody({
      tools: [namespacedTool(false, schema)],
      tool_choice: "auto",
    }));
    expect(out.tools[0].input_schema).toEqual({ ...schema, properties: {} });
  });

  it("fills empty schemas for Gemini with a reason placeholder", () => {
    const out = request(GEMINI, chatBody({
      tools: [namespacedTool(false, {})],
      tool_choice: "auto",
    }));
    expect(geminiDecl(out).parameters).toEqual({
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Brief explanation of why you are calling this tool",
        },
      },
      required: ["reason"],
    });
  });

  it("preserves keyword-named properties through Claude, Gemini, and Responses", () => {
    for (const target of [CLAUDE, GEMINI, RESPONSES]) {
      const out = request(target, chatBody({ tool_choice: "auto" }));
      const parameters = target === CLAUDE
        ? out.tools[0].input_schema
        : target === GEMINI
          ? geminiDecl(out).parameters
          : out.tools[0].parameters;
      expect(parameters).toEqual(keywordSchema);
      expect(parameters.properties).toHaveProperty("type");
      expect(parameters.properties).toHaveProperty("properties");
      expect(parameters.properties).toHaveProperty("required");
      expect(parameters.properties).toHaveProperty("items");
    }
  });

  // #1089 failing: #1334 string numeric JSON Schema constraints are forwarded as strings instead of numbers.
  it.skip("coerces string numeric schema constraints for Claude", () => {
    const schema = { type: "object", properties: { n: { type: "number", minimum: "1", maximum: "10" } } };
    const out = request(CLAUDE, chatBody({
      tools: [namespacedTool(false, schema)],
      tool_choice: "auto",
    }));
    expect(out.tools[0].input_schema.properties.n).toEqual({ type: "number", minimum: 1, maximum: 10 });
  });

  // #1089 failing: #1334 string numeric JSON Schema constraints are forwarded as strings instead of numbers.
  it.skip("coerces string numeric schema constraints for Gemini", () => {
    const schema = { type: "object", properties: { n: { type: "number", minimum: "1", maximum: "10" } } };
    const out = request(GEMINI, chatBody({
      tools: [namespacedTool(false, schema)],
      tool_choice: "auto",
    }));
    expect(geminiDecl(out).parameters.properties.n).toEqual({ type: "number", minimum: 1, maximum: 10 });
  });

  // #1089 failing: #1334 string numeric JSON Schema constraints are forwarded as strings instead of numbers.
  it.skip("coerces string numeric schema constraints for Responses", () => {
    const schema = { type: "object", properties: { n: { type: "number", minimum: "1", maximum: "10" } } };
    const out = request(RESPONSES, chatBody({
      tools: [namespacedTool(false, schema)],
      tool_choice: "auto",
    }));
    expect(out.tools[0].parameters.properties.n).toEqual({ type: "number", minimum: 1, maximum: 10 });
  });

  // #1089 failing: #1334 malformed tool schemas are forwarded instead of rejected predictably.
  it.skip("rejects malformed tool schemas for Claude", () => {
    const schema = { type: "object", properties: { x: null }, required: "not-an-array" };
    expect(() => request(CLAUDE, chatBody({
      tools: [namespacedTool(false, schema)],
      tool_choice: "auto",
    }))).toThrow(/schema|invalid|malformed/i);
  });

  // #1089 failing: #1334 malformed tool schemas are forwarded instead of rejected predictably.
  it.skip("rejects malformed tool schemas for Gemini", () => {
    const schema = { type: "object", properties: { x: null }, required: "not-an-array" };
    expect(() => request(GEMINI, chatBody({
      tools: [namespacedTool(false, schema)],
      tool_choice: "auto",
    }))).toThrow(/schema|invalid|malformed/i);
  });

  // #1089 failing: #1334 malformed tool schemas are forwarded instead of rejected predictably.
  it.skip("rejects malformed tool schemas for Responses", () => {
    const schema = { type: "object", properties: { x: null }, required: "not-an-array" };
    expect(() => request(RESPONSES, chatBody({
      tools: [namespacedTool(false, schema)],
      tool_choice: "auto",
    }))).toThrow(/schema|invalid|malformed/i);
  });
});
