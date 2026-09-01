import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { fixMissingToolResponses } from "../../open-sse/translator/concerns/toolCall.js";
import { CLAUDE_BLOCK, GEMINI_ROLE, OPENAI_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { claudeToGeminiRequest } from "../../open-sse/translator/request/claude-to-gemini.js";


const translateToGemini = (messages) => translateRequest(
  FORMATS.OPENAI,
  FORMATS.GEMINI,
  "gemini-test",
  { messages },
  false,
  null,
  "gemini",
);

/** Regression coverage for decolua/9router#3055 Gemini turn normalization. */
describe("Gemini turn normalization", () => {
  it("keeps an empty function response separate from following user text", () => {
    const result = translateToGemini([
      { role: ROLE.USER, content: "Run it" },
      {
        role: ROLE.ASSISTANT,
        content: null,
        tool_calls: [{
          id: "call_1",
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: "run", arguments: "{}" },
        }],
      },
      { role: ROLE.TOOL, tool_call_id: "call_1", content: "" },
      { role: ROLE.USER, content: "What happened?" },
    ]);

    expect(result.contents.slice(-2)).toEqual([
      {
        role: GEMINI_ROLE.USER,
        parts: [{
          functionResponse: {
            id: "call_1",
            name: "run",
            response: { result: { result: "" } },
          },
        }],
      },
      { role: GEMINI_ROLE.USER, parts: [{ text: "What happened?" }] },
    ]);
  });

  it("appends a user continuation after terminal model text", () => {
    const result = translateToGemini([
      { role: ROLE.USER, content: "Hello" },
      { role: ROLE.ASSISTANT, content: "Hi" },
    ]);

    expect(result.contents.at(-1)).toEqual({
      role: GEMINI_ROLE.USER,
      parts: [{ text: "Continue" }],
    });
  });

  it("appends synthetic function responses after terminal model tool calls", () => {
    const result = openaiToGeminiRequest("gemini-test", {
      messages: [
        { role: ROLE.USER, content: "Run it" },
        {
          role: ROLE.ASSISTANT,
          content: null,
          tool_calls: [{
            id: "call_1",
            type: OPENAI_BLOCK.FUNCTION,
            function: { name: "run", arguments: "{}" },
          }],
        },
      ],
    }, false);

    expect(result.contents.at(-1)).toEqual({
      role: GEMINI_ROLE.USER,
      parts: [{
        functionResponse: {
          id: "call_1",
          name: "run",
          response: { result: "No response provided" },
        },
      }],
    });
  });

  it("inserts Claude-shaped missing tool results for Claude history", () => {
    const body = {
      system: "Be helpful",
      messages: [{
        role: ROLE.ASSISTANT,
        content: [{ type: CLAUDE_BLOCK.TOOL_USE, id: "toolu_1", name: "run", input: {} }],
      }],
    };

    fixMissingToolResponses(body);

    expect(body.messages.at(-1)).toEqual({
      role: ROLE.USER,
      content: [{
        type: CLAUDE_BLOCK.TOOL_RESULT,
        tool_use_id: "toolu_1",
        content: "[No response received]",
      }],
    });
  });

  it("recognizes an existing Claude-shaped tool result", () => {
    const body = {
      messages: [
        {
          role: ROLE.ASSISTANT,
          content: [{ type: CLAUDE_BLOCK.TOOL_USE, id: "toolu_1", name: "run", input: {} }],
        },
        {
          role: ROLE.USER,
          content: [{ type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "toolu_1", content: "" }],
        },
      ],
    };

    fixMissingToolResponses(body);

    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].content[0]).toEqual({
      type: CLAUDE_BLOCK.TOOL_RESULT,
      tool_use_id: "toolu_1",
      content: "",
    });
  });

  it("leaves an already legal wrapped Claude Antigravity history unchanged", () => {
    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.ANTIGRAVITY,
      "claude-opus-test",
      {
        messages: [
          { role: ROLE.USER, content: "Hello" },
          { role: ROLE.ASSISTANT, content: "Hi" },
          { role: ROLE.USER, content: "Carry on" },
        ],
      },
      false,
      { projectId: "project-1", connectionId: "connection-1" },
      "antigravity",
    );

    expect(result.request.contents).toEqual([
      { role: GEMINI_ROLE.USER, parts: [{ text: "Hello" }] },
      { role: GEMINI_ROLE.MODEL, parts: [{ text: "Hi" }] },
      { role: GEMINI_ROLE.USER, parts: [{ text: "Carry on" }] },
    ]);
  });

  describe("collision-safe Gemini tool names (decolua/9router#3637)", () => {
    const prefix = "mcp_tool_" + "x".repeat(64);
    const longA = `${prefix}_alpha`;
    const longB = `${prefix}_beta`;
    const schema = { type: "object", properties: {} };
    const declarationNames = (result) => result.tools[0].functionDeclarations.map((tool) => tool.name);

    it("keeps Claude declarations, choice, history, and response restoration on one alias map", () => {
      const invalid = `9/${longA}`;
      const result = claudeToGeminiRequest("gemini-test", {
        tools: [
          { name: invalid, input_schema: schema },
          { name: `9/${longB}`, input_schema: schema },
          { name: "short_name", input_schema: schema },
        ],
        tool_choice: { type: "tool", name: invalid },
        messages: [
          { role: ROLE.ASSISTANT, content: [{ type: CLAUDE_BLOCK.TOOL_USE, id: "toolu_1", name: invalid, input: {}, thoughtSignature: "signature" }] },
          { role: ROLE.USER, content: [{ type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "toolu_1", content: "ok" }] },
        ],
      }, false);

      const names = declarationNames(result);
      expect(new Set(names).size).toBe(3);
      expect(names.every((name) => name.length <= 64)).toBe(true);
      expect(names[2]).toBe("short_name");
      expect(result.toolConfig.functionCallingConfig).toEqual({ mode: "ANY", allowedFunctionNames: [names[0]] });
      expect(result.contents[0].parts[0].functionCall.name).toBe(names[0]);
      expect(result.contents[1].parts[0].functionResponse.name).toBe(names[0]);

      const state = initState(FORMATS.CLAUDE);
      state.toolNameMap = result._toolNameMap;
      const response = translateResponse(FORMATS.GEMINI, FORMATS.CLAUDE, {
        candidates: [{ content: { parts: [{ functionCall: { id: "toolu_2", name: names[0], args: {} } }] } }],
      }, state);
      expect(response.find((event) => event.type === "content_block_start")?.content_block.name).toBe(invalid);
    });

    it("restores an unchanged mixed-case Claude tool name from a lowercased Gemini response", () => {
      const original = "MyCustomTool";
      const result = claudeToGeminiRequest("gemini-test", {
        tools: [{ name: original, input_schema: schema }],
        messages: [{ role: ROLE.USER, content: "Run it" }],
      }, false);

      expect(declarationNames(result)).toEqual([original]);
      expect(result._toolNameMap.get(original.toLowerCase())).toBe(original);

      const state = initState(FORMATS.CLAUDE);
      state.toolNameMap = result._toolNameMap;
      const response = translateResponse(FORMATS.GEMINI, FORMATS.CLAUDE, {
        candidates: [{ content: { parts: [{ functionCall: { id: "toolu_1", name: original.toLowerCase(), args: {} } }] } }],
      }, state);
      expect(response.find((event) => event.type === "content_block_start")?.content_block.name).toBe(original);
    });

    it("keeps OpenAI declarations, choice, history, and response restoration on one alias map", () => {
      const result = openaiToGeminiRequest("gemini-test", {
        tools: [
          { type: OPENAI_BLOCK.FUNCTION, function: { name: longA, parameters: schema } },
          { type: OPENAI_BLOCK.FUNCTION, function: { name: longB, parameters: schema } },
          { type: OPENAI_BLOCK.FUNCTION, function: { name: "short_name", parameters: schema } },
        ],
        tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: longA } },
        messages: [
          { role: ROLE.ASSISTANT, tool_calls: [{ id: "call_1", type: OPENAI_BLOCK.FUNCTION, function: { name: longA, arguments: "{}" } }] },
          { role: ROLE.TOOL, tool_call_id: "call_1", content: "ok" },
        ],
      }, false);

      const names = declarationNames(result);
      expect(new Set(names).size).toBe(3);
      expect(names.every((name) => name.length <= 64)).toBe(true);
      expect(names[2]).toBe("short_name");
      expect(result.toolConfig.functionCallingConfig).toEqual({ mode: "ANY", allowedFunctionNames: [names[0]] });
      expect(result.contents[0].parts[0].functionCall.name).toBe(names[0]);
      expect(result.contents[1].parts[0].functionResponse.name).toBe(names[0]);

      const state = initState(FORMATS.OPENAI);
      state.toolNameMap = result._toolNameMap;
      const response = translateResponse(FORMATS.GEMINI, FORMATS.OPENAI, {
        candidates: [{ content: { parts: [{ functionCall: { id: "call_2", name: names[1], args: {} } }] } }],
      }, state);
      expect(response.find((chunk) => chunk.choices?.[0]?.delta?.tool_calls)?.choices[0].delta.tool_calls[0].function.name).toBe(longB);
    });

    it("keeps same-prefix Antigravity declarations distinct and exposes aliases for response decloaking", () => {
      const result = new AntigravityExecutor().transformRequest("gemini-test", {
        request: {
          contents: [
            { role: GEMINI_ROLE.MODEL, parts: [{ functionCall: { name: longA, args: {} } }] },
            { role: GEMINI_ROLE.USER, parts: [{ functionResponse: { name: longA, response: { result: "ok" } } }] },
          ],
          toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [longA] } },
          tools: [{ functionDeclarations: [
            { name: longA, parameters: schema },
            { name: longB, parameters: schema },
          ] }],
        },
      }, true, { projectId: "project-1", connectionId: "connection-1" });

      const names = declarationNames(result.request);
      expect(new Set(names).size).toBe(2);
      expect(names.every((name) => name.length <= 64)).toBe(true);
      expect(result._toolNameMap.get(names[0])).toBe(longA);
      expect(result._toolNameMap.get(names[1])).toBe(longB);
      expect(Object.keys(result)).not.toContain("_toolNameMap");
      expect(result.request.contents[0].parts[0].functionCall.name).toBe(names[0]);
      expect(result.request.contents[1].parts[0].functionResponse.name).toBe(names[0]);
      expect(result.request.toolConfig.functionCallingConfig.allowedFunctionNames).toEqual([names[0]]);

      const state = initState(FORMATS.OPENAI);
      state.toolNameMap = result._toolNameMap;
      const response = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, {
        response: { candidates: [{ content: { parts: [{ functionCall: { name: names[1], args: {} } }] } }] },
      }, state);
      expect(response.find((chunk) => chunk.choices?.[0]?.delta?.tool_calls)?.choices[0].delta.tool_calls[0].function.name).toBe(longB);
    });
  });
});
