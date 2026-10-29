/**
 * #1335 — pair tool results with tool calls by call id within the current
 * assistant turn. Cross-turn stray results are dropped; real current-turn
 * results are preserved even when a stray precedes them.
 */
import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { fixMissingToolResponses } from "../../open-sse/translator/concerns/toolCall.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  CLAUDE_BLOCK,
  OPENAI_BLOCK,
  RESPONSES_ITEM,
  ROLE,
} from "../../open-sse/translator/schema/index.js";

const CHAT = FORMATS.OPENAI;
const CLAUDE = FORMATS.CLAUDE;
const GEMINI = FORMATS.GEMINI;
const RESPONSES = FORMATS.OPENAI_RESPONSES;

const tools = [
  { type: OPENAI_BLOCK.FUNCTION, function: { name: "a", parameters: { type: "object" } } },
  { type: OPENAI_BLOCK.FUNCTION, function: { name: "b", parameters: { type: "object" } } },
];

const call = (id, name) => ({
  id,
  type: OPENAI_BLOCK.FUNCTION,
  function: { name, arguments: "{}" },
});

const chatRequest = (target, messages) =>
  translateRequest(CHAT, target, target === CLAUDE ? "claude-sonnet-4-5" : target === GEMINI ? "gemini-2.5-pro" : "m", {
    messages: structuredClone(messages),
    tools,
  }, false);

const responsesRequest = (body, target = CHAT) =>
  translateRequest(RESPONSES, target, "m", structuredClone(body), false);

describe("#1335 turn-scoped tool-result pairing", () => {
  it("leaves a plain single-turn call/result pair unchanged", () => {
    const messages = [
      { role: ROLE.USER, content: "go" },
      { role: ROLE.ASSISTANT, content: null, tool_calls: [call("c1", "a")] },
      { role: ROLE.TOOL, tool_call_id: "c1", content: "done" },
    ];

    expect(chatRequest(CHAT, messages).messages).toEqual(messages);

    expect(chatRequest(CLAUDE, messages).messages).toEqual([
      { role: ROLE.USER, content: [{ type: CLAUDE_BLOCK.TEXT, text: "go" }] },
      {
        role: ROLE.ASSISTANT,
        content: [{
          type: CLAUDE_BLOCK.TOOL_USE,
          id: "c1",
          name: "a",
          input: {},
          cache_control: { type: "ephemeral" },
        }],
      },
      {
        role: ROLE.USER,
        content: [{ type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "c1", content: "done" }],
      },
    ]);

    expect(chatRequest(RESPONSES, messages).input).toEqual([
      { type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "go" }] },
      { type: RESPONSES_ITEM.FUNCTION_CALL, call_id: "c1", name: "a", arguments: "{}" },
      { type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: "c1", output: "done" },
    ]);
  });

  it("pairs out-of-order results to the current turn by call id", () => {
    const messages = [
      { role: ROLE.USER, content: "go" },
      { role: ROLE.ASSISTANT, content: null, tool_calls: [call("c1", "a"), call("c2", "b")] },
      { role: ROLE.TOOL, tool_call_id: "c2", content: "second" },
      { role: ROLE.TOOL, tool_call_id: "c1", content: "first" },
    ];

    const body = { messages: structuredClone(messages) };
    fixMissingToolResponses(body);
    expect(body.messages).toEqual(messages);

    // Claude's prepare pass reorders tool_result blocks to match tool_use order;
    // content must still sit under the correct call id.
    expect(chatRequest(CLAUDE, messages).messages.at(-1)).toEqual({
      role: ROLE.USER,
      content: [
        { type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "c1", content: "first" },
        { type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "c2", content: "second" },
      ],
    });

    expect(chatRequest(RESPONSES, messages).input.filter((item) => item.type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT)).toEqual([
      { type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: "c2", output: "second" },
      { type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: "c1", output: "first" },
    ]);
  });

  it("synthesizes a missing current-turn result and does not invent extras", () => {
    const messages = [
      { role: ROLE.USER, content: "go" },
      { role: ROLE.ASSISTANT, content: null, tool_calls: [call("c1", "a"), call("c2", "b")] },
      { role: ROLE.TOOL, tool_call_id: "c1", content: "only-first" },
    ];

    const body = { messages: structuredClone(messages) };
    fixMissingToolResponses(body);
    expect(body.messages).toEqual([
      { role: ROLE.USER, content: "go" },
      { role: ROLE.ASSISTANT, content: null, tool_calls: [call("c1", "a"), call("c2", "b")] },
      { role: ROLE.TOOL, tool_call_id: "c1", content: "only-first" },
      { role: ROLE.TOOL, tool_call_id: "c2", content: "[No response received]" },
    ]);
  });

  it("drops a duplicate cross-turn call id and keeps the current-turn result", () => {
    const messages = [
      { role: ROLE.USER, content: "first" },
      { role: ROLE.ASSISTANT, content: null, tool_calls: [call("old", "a")] },
      { role: ROLE.TOOL, tool_call_id: "old", content: "old-result" },
      { role: ROLE.ASSISTANT, content: "mid" },
      { role: ROLE.USER, content: "second" },
      { role: ROLE.ASSISTANT, content: null, tool_calls: [call("new", "b")] },
      { role: ROLE.TOOL, tool_call_id: "old", content: "wrong-cross-turn" },
      { role: ROLE.TOOL, tool_call_id: "new", content: "new-result" },
    ];

    const body = { messages: structuredClone(messages) };
    fixMissingToolResponses(body);
    expect(body.messages).toEqual([
      { role: ROLE.USER, content: "first" },
      { role: ROLE.ASSISTANT, content: null, tool_calls: [call("old", "a")] },
      { role: ROLE.TOOL, tool_call_id: "old", content: "old-result" },
      { role: ROLE.ASSISTANT, content: "mid" },
      { role: ROLE.USER, content: "second" },
      { role: ROLE.ASSISTANT, content: null, tool_calls: [call("new", "b")] },
      { role: ROLE.TOOL, tool_call_id: "new", content: "new-result" },
    ]);

    const claude = chatRequest(CLAUDE, messages);
    const toolResults = claude.messages.flatMap((message) =>
      Array.isArray(message.content) ? message.content.filter((block) => block.type === CLAUDE_BLOCK.TOOL_RESULT) : []);
    expect(toolResults).toEqual([
      { type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "old", content: "old-result" },
      { type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "new", content: "new-result" },
    ]);
    expect(JSON.stringify(claude.messages)).not.toContain("[No response received]");
    expect(JSON.stringify(claude.messages)).not.toContain("wrong-cross-turn");

    const gemini = chatRequest(GEMINI, messages);
    const responses = gemini.contents.flatMap((entry) =>
      (entry.parts || []).filter((part) => part.functionResponse).map((part) => part.functionResponse));
    expect(responses).toEqual([
      {
        id: "old",
        name: "a",
        response: { result: { result: "old-result" } },
      },
      {
        id: "new",
        name: "b",
        response: { result: { result: "new-result" } },
      },
    ]);
    expect(JSON.stringify(gemini.contents)).not.toContain("wrong-cross-turn");
    expect(JSON.stringify(gemini.contents)).not.toContain("[No response received]");

    const responsesOut = chatRequest(RESPONSES, messages);
    expect(responsesOut.input.filter((item) => item.type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT)).toEqual([
      { type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: "old", output: "old-result" },
      { type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: "new", output: "new-result" },
    ]);
  });

  it("does not pair a Responses function_call_output across an intervening assistant message", () => {
    const out = responsesRequest({
      input: [
        { type: RESPONSES_ITEM.FUNCTION_CALL, call_id: "old", name: "lookup", arguments: "{}" },
        {
          type: RESPONSES_ITEM.MESSAGE,
          role: ROLE.ASSISTANT,
          content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text: "new turn" }],
        },
        { type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: "old", output: "result" },
      ],
    }, CHAT);

    expect(out.messages).toEqual([
      { role: ROLE.ASSISTANT, content: "new turn" },
    ]);
    expect(out.messages.filter((message) => message.tool_call_id === "old")).toHaveLength(0);
  });

  it("still merges same-turn trailing assistant text before tool outputs", () => {
    const out = responsesRequest({
      input: [
        {
          type: RESPONSES_ITEM.MESSAGE,
          role: ROLE.ASSISTANT,
          content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text: "first" }],
        },
        { type: RESPONSES_ITEM.FUNCTION_CALL, call_id: "c1", name: "lookup", arguments: "{}" },
        {
          type: RESPONSES_ITEM.MESSAGE,
          role: ROLE.ASSISTANT,
          content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text: "second" }],
        },
        { type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: "c1", output: "done" },
      ],
    }, CHAT);

    expect(out.messages).toEqual([
      {
        role: ROLE.ASSISTANT,
        content: "first\nsecond",
        tool_calls: [call("c1", "lookup")],
      },
      { role: ROLE.TOOL, tool_call_id: "c1", content: "done" },
    ]);
  });
});
