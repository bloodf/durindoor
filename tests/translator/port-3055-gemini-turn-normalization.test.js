import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { fixMissingToolResponses } from "../../open-sse/translator/concerns/toolCall.js";
import { CLAUDE_BLOCK, GEMINI_ROLE, OPENAI_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";

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
});
