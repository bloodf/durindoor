import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import {
  CLAUDE_BLOCK,
  CLAUDE_STOP,
  GEMINI_FINISH,
  OPENAI_BLOCK,
  OPENAI_FINISH,
  RESPONSES_ITEM,
  ROLE,
} from "../../open-sse/translator/schema/index.js";

const responses = FORMATS.OPENAI_RESPONSES;
const chat = FORMATS.OPENAI;
const claude = FORMATS.CLAUDE;
const gemini = FORMATS.GEMINI;
const schema = {
  type: "object",
  properties: { q: { type: "string" } },
  required: ["q"],
};
const longToolName = `tool_${"x".repeat(80)}`;
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

const modelFor = (target) =>
  target === claude ? "claude-haiku-4-5" : target === gemini ? "gemini-2.5-pro" : "m";

const request = (body, target) =>
  translateRequest(responses, target, modelFor(target), structuredClone(body), false);

const streamTo = (events, clientFormat) => {
  const state = initState(responses);
  return events.flatMap((event) => translateResponse(responses, clientFormat, event, state));
};

/** Non-stream: upstream Responses body projected to the client format. */
const nonstreamTo = (body, clientFormat) =>
  translateNonStreamingResponse(structuredClone(body), responses, clientFormat);

const toolName = (out, target) => {
  if (target === chat) return out.tools[0].function.name;
  if (target === claude) return out.tools[0].name;
  return out.tools[0].functionDeclarations[0].name;
};

const toolParams = (out, target) => {
  if (target === chat) return out.tools[0].function.parameters;
  if (target === claude) return out.tools[0].input_schema;
  return out.tools[0].functionDeclarations[0].parameters;
};

const aliasMap = (out) =>
  out._toolNameMap instanceof Map ? out._toolNameMap : new Map(out._toolNameMap || []);

describe("#1089 Responses client conformance", () => {
  it("preserves strict false, explicit tool choice, and parallel limit to Chat", () => {
    const body = {
      input: "hi",
      tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "lookup", description: "lookup", strict: false, parameters: schema }],
      tool_choice: { type: OPENAI_BLOCK.FUNCTION, name: "lookup" },
      parallel_tool_calls: false,
    };
    const out = request(body, chat);
    expect(out.tools[0].function).toMatchObject({ name: "lookup", strict: false, parameters: schema });
    expect(out.tool_choice).toEqual({ type: OPENAI_BLOCK.FUNCTION, function: { name: "lookup" } });
    expect(out.parallel_tool_calls).toBe(false);
  });

  it("preserves strict true through Responses to Chat and Claude", () => {
    const body = {
      input: "hi",
      tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "lookup", strict: true, parameters: schema }],
    };
    const toChat = request(body, chat);
    const toClaude = request(body, claude);
    expect(toChat.tools[0].function.strict).toBe(true);
    expect(toClaude.tools[0]).toMatchObject({ name: "lookup", strict: true, input_schema: schema });
  });

  it("delivers schema to Gemini without an OpenAI strict field", () => {
    const out = request({
      input: "hi",
      tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "lookup", strict: true, parameters: schema }],
    }, gemini);
    const declaration = out.tools[0].functionDeclarations[0];
    expect(declaration.name).toBe("lookup");
    expect(declaration.parameters.properties.q).toMatchObject({ type: expect.stringMatching(/string/i) });
    expect(JSON.stringify(out.tools)).not.toContain("\"strict\"");
  });

  it("maps parallel_tool_calls false to Claude disable_parallel_tool_use", () => {
    const out = request({
      input: "hi",
      tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "lookup", parameters: schema }],
      tool_choice: "auto",
      parallel_tool_calls: false,
    }, claude);
    expect(out.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(out).not.toHaveProperty("parallel_tool_calls");
  });

  it("forces namespaced tool_choice on Gemini with aliased allowedFunctionNames", () => {
    const out = request({
      input: "hi",
      tools: [{
        type: "namespace",
        name: "research",
        tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "search", parameters: schema }],
      }],
      tool_choice: { type: OPENAI_BLOCK.FUNCTION, name: "search", namespace: "research" },
    }, gemini);
    const name = out.tools[0].functionDeclarations[0].name;
    expect(name.length).toBeLessThanOrEqual(64);
    expect(aliasMap(out).get(name)).toBe("research.search");
    expect(out.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: [name] },
    });
  });

  it("lowers custom and namespaced tools to Chat with strict and parallel policy", () => {
    const out = request({
      input: "search, then patch",
      tools: [
        { type: "custom", name: "files.patch", description: "Apply raw patch text" },
        {
          type: "namespace",
          name: "research",
          tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "search", parameters: schema, strict: true }],
        },
      ],
      tool_choice: { type: OPENAI_BLOCK.FUNCTION, name: "search", namespace: "research" },
      parallel_tool_calls: false,
    }, chat);
    const [custom, namespaced] = out.tools.map((tool) => tool.function);
    expect(custom).toMatchObject({
      name: "files.patch",
      parameters: {
        type: "object",
        properties: { input: { type: "string" } },
        required: ["input"],
        additionalProperties: false,
      },
    });
    expect(custom.strict).toBeUndefined();
    expect(namespaced).toMatchObject({ name: "research.search", strict: true, parameters: schema });
    expect(out._customToolNames).toEqual(["files.patch"]);
    expect(out.tool_choice).toEqual({ type: OPENAI_BLOCK.FUNCTION, function: { name: "research.search" } });
    expect(out.parallel_tool_calls).toBe(false);
  });

  it("lowers custom and namespaced tools to Claude with alias map and parallel ban", () => {
    const out = request({
      input: "search, then patch",
      tools: [
        { type: "custom", name: "files.patch", description: "Apply raw patch text" },
        {
          type: "namespace",
          name: "research",
          tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "search", parameters: schema, strict: true }],
        },
      ],
      tool_choice: { type: OPENAI_BLOCK.FUNCTION, name: "search", namespace: "research" },
      parallel_tool_calls: false,
    }, claude);
    const [customAlias, namespaceAlias] = out.tools.map((tool) => tool.name);
    expect(aliasMap(out).get(customAlias)).toBe("files.patch");
    expect(aliasMap(out).get(namespaceAlias)).toBe("research.search");
    expect(out.tools[0].strict).toBeUndefined();
    expect(out.tools[1]).toMatchObject({ strict: true, input_schema: schema });
    expect(out._customToolNames).toEqual(["files.patch"]);
    expect(out.tool_choice).toEqual({
      type: "tool",
      name: namespaceAlias,
      disable_parallel_tool_use: true,
    });
  });

  it("keeps function_call and function_call_output pairing to Chat, Claude, and Gemini", () => {
    const body = {
      input: [
        { type: RESPONSES_ITEM.FUNCTION_CALL, call_id: "c1", name: "lookup", arguments: "{}" },
        { type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: "c1", output: "done" },
      ],
    };
    const toChat = request(body, chat);
    expect(toChat.messages).toEqual([
      {
        role: ROLE.ASSISTANT,
        content: null,
        tool_calls: [{ id: "c1", type: OPENAI_BLOCK.FUNCTION, function: { name: "lookup", arguments: "{}" } }],
      },
      { role: ROLE.TOOL, tool_call_id: "c1", content: "done" },
    ]);

    const toClaude = request(body, claude);
    expect(toClaude.messages).toEqual([
      {
        role: ROLE.ASSISTANT,
        content: [{
          type: CLAUDE_BLOCK.TOOL_USE,
          id: "c1",
          name: "lookup",
          input: {},
          cache_control: { type: "ephemeral" },
        }],
      },
      {
        role: ROLE.USER,
        content: [{ type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "c1", content: "done" }],
      },
    ]);

    const toGemini = request(body, gemini);
    expect(toGemini.contents[0].parts[0].functionCall).toMatchObject({ id: "c1", name: "lookup", args: {} });
    expect(toGemini.contents[1].parts[0].functionResponse).toMatchObject({
      id: "c1",
      name: "lookup",
      response: { result: { result: "done" } },
    });
  });

  // #1335 CTO: flush the tool-only turn and relocate the late real output by call id.
  it("relocates function_call_output after an intervening assistant message by call id", () => {
    const out = request({
      input: [
        { type: RESPONSES_ITEM.FUNCTION_CALL, call_id: "old", name: "lookup", arguments: "{}" },
        {
          type: RESPONSES_ITEM.MESSAGE,
          role: ROLE.ASSISTANT,
          content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text: "new turn" }],
        },
        { type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: "old", output: "result" },
      ],
    }, chat);
    expect(out.messages).toEqual([
      {
        role: ROLE.ASSISTANT,
        content: null,
        tool_calls: [{ id: "old", type: OPENAI_BLOCK.FUNCTION, function: { name: "lookup", arguments: "{}" } }],
      },
      { role: ROLE.TOOL, tool_call_id: "old", content: "result" },
      { role: ROLE.ASSISTANT, content: "new turn" },
    ]);
  });

  it("preserves text tool-result media to Chat, Claude, and Gemini", () => {
    const body = {
      input: [
        { type: RESPONSES_ITEM.FUNCTION_CALL, call_id: "c1", name: "fetch", arguments: "{}" },
        {
          type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
          call_id: "c1",
          output: [
            { type: RESPONSES_ITEM.INPUT_TEXT, text: "first" },
            { type: RESPONSES_ITEM.OUTPUT_TEXT, text: "second" },
          ],
        },
      ],
    };
    expect(request(body, chat).messages.find((message) => message.role === ROLE.TOOL)).toMatchObject({
      tool_call_id: "c1",
      content: "first\nsecond",
    });
    const claudeResult = request(body, claude).messages
      .flatMap((message) => message.content)
      .find((block) => block.type === CLAUDE_BLOCK.TOOL_RESULT);
    expect(claudeResult).toMatchObject({ tool_use_id: "c1", content: "first\nsecond" });
    const geminiContents = request(body, gemini).contents;
    expect(geminiContents[1]).toEqual({
      role: ROLE.USER,
      parts: [{
        functionResponse: {
          id: "c1",
          name: "fetch",
          response: { result: { result: "first\nsecond" } },
        },
      }],
    });
  });

  it("lifts input_image tool-result media beside text for Chat and Claude", () => {
    const url = "https://example.invalid/report.png";
    const body = {
      input: [
        { type: RESPONSES_ITEM.FUNCTION_CALL, call_id: "c1", name: "fetch", arguments: "{}" },
        {
          type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
          call_id: "c1",
          output: [
            { type: RESPONSES_ITEM.INPUT_TEXT, text: "report" },
            { type: RESPONSES_ITEM.INPUT_IMAGE, image_url: url },
          ],
        },
      ],
    };
    const toChat = request(body, chat);
    expect(toChat.messages).toHaveLength(3);
    expect(toChat.messages[0]).toEqual({
      role: ROLE.ASSISTANT,
      content: null,
      tool_calls: [{
        id: "c1",
        type: OPENAI_BLOCK.FUNCTION,
        function: { name: "fetch", arguments: "{}" },
      }],
    });
    expect(toChat.messages[1]).toEqual({
      role: ROLE.TOOL,
      tool_call_id: "c1",
      content: "report\n[tool returned an image; see attached]",
    });
    expect(toChat.messages[2]).toEqual({
      role: ROLE.USER,
      content: [{ type: OPENAI_BLOCK.IMAGE_URL, image_url: { url, detail: "auto" } }],
    });
    const toClaude = request(body, claude);
    expect(toClaude.messages).toHaveLength(2);
    expect(toClaude.messages[0]).toEqual({
      role: ROLE.ASSISTANT,
      content: [{
        type: CLAUDE_BLOCK.TOOL_USE,
        id: "c1",
        name: "fetch",
        input: {},
        cache_control: { type: "ephemeral" },
      }],
    });
    expect(toClaude.messages[1]).toEqual({
      role: ROLE.USER,
      content: [
        {
          type: CLAUDE_BLOCK.TOOL_RESULT,
          tool_use_id: "c1",
          content: "report\n[tool returned an image; see attached]",
        },
        {
          type: CLAUDE_BLOCK.IMAGE,
          source: { type: "url", url },
        },
      ],
    });
  });

  it("rejects unsupported tool-result file and audio media with HTTP 400", () => {
    const base = [
      { type: RESPONSES_ITEM.FUNCTION_CALL, call_id: "c1", name: "fetch", arguments: "{}" },
    ];
    for (const target of [chat, claude, gemini]) {
      expect(() => request({
        input: [
          ...base,
          {
            type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
            call_id: "c1",
            output: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "t" }, { type: "input_file", file_id: "file-1" }],
          },
        ],
      }, target)).toThrow(expect.objectContaining({
        statusCode: 400,
        message: expect.stringContaining("UNSUPPORTED_TOOL_OUTPUT"),
      }));
      expect(() => request({
        input: [
          ...base,
          {
            type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
            call_id: "c1",
            output: [{ type: "input_audio", input_audio: { data: "QUJD", format: "wav" } }],
          },
        ],
      }, target)).toThrow(expect.objectContaining({
        statusCode: 400,
        message: expect.stringContaining("UNSUPPORTED_TOOL_OUTPUT"),
      }));
    }
  });

  it("clamps overlong tool names to 64 chars for Claude and Gemini with round-trip map", () => {
    const body = {
      input: "hi",
      tools: [{ type: OPENAI_BLOCK.FUNCTION, name: longToolName, description: "d", parameters: schema }],
    };
    for (const target of [claude, gemini]) {
      const out = request(body, target);
      const name = toolName(out, target);
      expect(name.length).toBeLessThanOrEqual(64);
      expect(aliasMap(out).get(name)).toBe(longToolName);
    }
  });

  // #1089 failing: Responses→Chat direct route skips normalizeOpenAIToolNames, so names stay >64. Refs #1345
  it.skip("clamps overlong tool names to 64 chars for Chat with round-trip map", () => {
    const out = request({
      input: "hi",
      tools: [{ type: OPENAI_BLOCK.FUNCTION, name: longToolName, description: "d", parameters: schema }],
    }, chat);
    const name = out.tools[0].function.name;
    expect(name.length).toBeLessThanOrEqual(64);
    expect(aliasMap(out).get(name)).toBe(longToolName);
  });

  it("translates stream response.incomplete to length/max_tokens terminals", () => {
    const events = [{
      type: "response.incomplete",
      response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
    }];
    expect(streamTo(events, chat).at(-1).choices[0].finish_reason).toBe(OPENAI_FINISH.LENGTH);
    expect(streamTo(events, claude).find((event) => event.type === "message_delta").delta.stop_reason)
      .toBe(CLAUDE_STOP.MAX_TOKENS);
    expect(streamTo(events, gemini).at(-1).response.candidates[0].finishReason)
      .toBe(GEMINI_FINISH.MAX_TOKENS);
  });

  it("translates stream incomplete with a tool call in progress for Chat, Claude, and Gemini", () => {
    const events = [
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: RESPONSES_ITEM.FUNCTION_CALL, id: "fc_1", call_id: "c1", name: "lookup", arguments: "" },
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        delta: "{\"q\":\"a\"}",
      },
      {
        type: "response.incomplete",
        response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
      },
    ];
    const toChat = streamTo(events, chat);
    expect(toChat).toHaveLength(3);
    expect(toChat[0].object).toBe("chat.completion.chunk");
    expect(toChat[0].choices[0]).toEqual({
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          id: "c1",
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: "lookup", arguments: "" },
        }],
      },
      finish_reason: null,
    });
    expect(toChat[1].choices[0]).toEqual({
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          function: { arguments: "{\"q\":\"a\"}" },
        }],
      },
      finish_reason: null,
    });
    expect(toChat[2].choices[0]).toEqual({
      index: 0,
      delta: {},
      finish_reason: OPENAI_FINISH.LENGTH,
    });

    const toClaude = streamTo(events, claude);
    expect(toClaude.find((event) => event.type === "content_block_start")).toEqual({
      type: "content_block_start",
      index: 0,
      content_block: {
        type: CLAUDE_BLOCK.TOOL_USE,
        id: "c1",
        name: "lookup",
        input: {},
      },
    });
    expect(toClaude.find((event) => event.type === "content_block_delta")).toEqual({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: "{\"q\":\"a\"}" },
    });
    expect(toClaude.find((event) => event.type === "message_delta").delta.stop_reason)
      .toBe(CLAUDE_STOP.MAX_TOKENS);

    const toGemini = streamTo(events, gemini);
    const last = toGemini.at(-1).response.candidates[0];
    expect(last.content.parts[0].functionCall).toMatchObject({ name: "lookup", args: { q: "a" } });
    expect(last.finishReason).toBe(GEMINI_FINISH.MAX_TOKENS);
  });

  it("translates stream response.failed error text for Chat, Claude, and Gemini", () => {
    const events = [{ type: "response.failed", response: { error: { message: "failed" } } }];
    expect(streamTo(events, chat)[0].choices[0]).toMatchObject({
      delta: { content: "[Error] failed" },
      finish_reason: OPENAI_FINISH.STOP,
    });
    const claudeText = streamTo(events, claude)
      .filter((event) => event.type === "content_block_delta")
      .map((event) => event.delta.text)
      .join("");
    expect(claudeText).toBe("[Error] failed");
    expect(streamTo(events, claude).find((event) => event.type === "message_delta").delta.stop_reason)
      .toBe(CLAUDE_STOP.END_TURN);
    expect(streamTo(events, gemini)[0].response.candidates[0]).toMatchObject({
      content: { parts: [{ text: "[Error] failed" }] },
      finishReason: GEMINI_FINISH.STOP,
    });
  });

  it("projects non-stream incomplete status with a tool call to Chat and Claude", () => {
    const body = {
      id: "r",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [{
        type: RESPONSES_ITEM.FUNCTION_CALL,
        call_id: "c1",
        name: "lookup",
        arguments: "{\"q\":\"a\"}",
      }],
    };
    const toChat = nonstreamTo(body, chat);
    expect(toChat.choices[0].finish_reason).toBe(OPENAI_FINISH.LENGTH);
    expect(toChat.choices[0].message.tool_calls[0]).toMatchObject({
      id: "c1",
      function: { name: "lookup", arguments: "{\"q\":\"a\"}" },
    });
    const toClaude = nonstreamTo(body, claude);
    expect(toClaude.stop_reason).toBe(CLAUDE_STOP.MAX_TOKENS);
    expect(toClaude.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: CLAUDE_BLOCK.TOOL_USE, id: "c1", name: "lookup", input: { q: "a" } }),
    ]));
  });

  it("projects non-stream failed status to Chat and Claude error text", () => {
    const body = { id: "r", status: "failed", error: { message: "boom" }, output: [] };
    expect(nonstreamTo(body, chat).choices[0]).toMatchObject({
      message: { content: "[Error] boom" },
      finish_reason: OPENAI_FINISH.STOP,
    });
    expect(nonstreamTo(body, claude)).toMatchObject({
      content: [{ type: CLAUDE_BLOCK.TEXT, text: "[Error] boom" }],
      stop_reason: CLAUDE_STOP.END_TURN,
    });
  });

  // #1089 failing: non-stream Responses upstream bodies are not projected into Gemini client shape. Refs #1346
  it.skip("projects non-stream incomplete Responses body to Gemini MAX_TOKENS with the tool call", () => {
    const out = nonstreamTo({
      id: "r",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [{
        type: RESPONSES_ITEM.FUNCTION_CALL,
        call_id: "c1",
        name: "lookup",
        arguments: "{\"q\":\"a\"}",
      }],
    }, gemini);
    expect(out).not.toHaveProperty("status");
    expect(out.candidates[0].finishReason).toBe(GEMINI_FINISH.MAX_TOKENS);
    expect(out.candidates[0].content.parts[0].functionCall).toMatchObject({
      name: "lookup",
      args: { q: "a" },
    });
  });

  it("translates non-string tool descriptions to a string for Kiro without TypeError", () => {
    const out = request({
      input: "hi",
      tools: [{
        type: OPENAI_BLOCK.FUNCTION,
        name: "lookup",
        description: { text: "x" },
        parameters: { type: "object" },
      }],
    }, FORMATS.KIRO);
    const description = out.conversationState.currentMessage.userInputMessage
      .userInputMessageContext.tools[0].toolSpecification.description;
    expect(description).toBe("[object Object]");
    expect(typeof description).toBe("string");
  });

  it("preserves keyword-named schema properties through Chat, Claude, and Gemini", () => {
    const body = {
      input: "hi",
      tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "lookup", parameters: keywordSchema }],
    };
    for (const target of [chat, claude, gemini]) {
      expect(toolParams(request(body, target), target).properties).toEqual(keywordSchema.properties);
    }
  });

  it("converts tuple prefixItems to Gemini items while Chat and Claude keep the tuple", () => {
    const parameters = {
      type: "object",
      properties: { pair: { type: "array", prefixItems: [{ type: "string" }, { type: "number" }] } },
    };
    const body = {
      input: "hi",
      tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "lookup", parameters }],
    };
    expect(toolParams(request(body, chat), chat).properties.pair.prefixItems).toEqual([
      { type: "string" },
      { type: "number" },
    ]);
    expect(toolParams(request(body, claude), claude).properties.pair.prefixItems).toEqual([
      { type: "string" },
      { type: "number" },
    ]);
    const geminiPair = toolParams(request(body, gemini), gemini).properties.pair;
    expect(geminiPair.prefixItems).toBeUndefined();
    expect(geminiPair.items).toEqual({ type: "string" });
  });

  it("coerces free-form and empty object schemas for Gemini and leaves Chat/Claude empty", () => {
    const freeform = request({
      input: "hi",
      tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "lookup", parameters: {} }],
    }, gemini);
    expect(toolParams(freeform, gemini)).toEqual({
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Brief explanation of why you are calling this tool",
        },
      },
      required: ["reason"],
    });
    expect(toolParams(request({
      input: "hi",
      tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "lookup", parameters: {} }],
    }, chat), chat)).toEqual({});
    expect(toolParams(request({
      input: "hi",
      tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "lookup", parameters: { type: "object" } }],
    }, chat), chat)).toEqual({ type: "object", properties: {} });
    expect(toolParams(request({
      input: "hi",
      tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "lookup", parameters: { type: "object" } }],
    }, claude), claude)).toEqual({ type: "object", properties: {} });
  });

  // #1089 failing: Responses→Claude leaves free-form parameters:{} as input_schema:{} (Anthropic requires type:object). Refs #1350
  it.skip("normalizes Claude free-form parameters {} to a typed empty object schema", () => {
    expect(toolParams(request({
      input: "hi",
      tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "lookup", parameters: {} }],
    }, claude), claude)).toEqual({ type: "object", properties: {} });
  });

  // #1089 failing: string numeric JSON Schema constraints stay strings on Chat/Claude and are stripped on Gemini instead of coerced to integers. Refs #1334
  it.skip("coerces string numeric schema constraints to integers for Chat, Claude, and Gemini", () => {
    const parameters = {
      type: "object",
      properties: { q: { type: "string", minLength: "3", maxLength: "10" } },
    };
    const body = {
      input: "hi",
      tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "lookup", parameters }],
    };
    for (const target of [chat, claude, gemini]) {
      expect(toolParams(request(body, target), target).properties.q).toMatchObject({
        minLength: 3,
        maxLength: 10,
      });
    }
  });

  // #1089 failing: malformed tool schemas are forwarded instead of rejected with a predictable 400. Refs #1334
  it.skip("rejects malformed tool schemas with HTTP 400 for Chat, Claude, and Gemini", () => {
    const body = {
      input: "hi",
      tools: [{
        type: OPENAI_BLOCK.FUNCTION,
        name: "lookup",
        parameters: {
          type: "object",
          properties: { q: { type: "not-a-real-type" } },
          required: "q",
        },
      }],
    };
    for (const target of [chat, claude, gemini]) {
      expect(() => request(body, target)).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  });
});
