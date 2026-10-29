/**
 * #1343 — Chat-source routes to Claude and OpenAI Chat must sanitize dotted /
 * overlong tool names on the request (declarations, tool_choice, history) and
 * restore the client's original names on stream and non-stream responses.
 *
 * Does not cover Responses→* (pivot / #1384 direct Responses→Chat).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { decloakToolNames } from "../../open-sse/utils/claudeCloaking.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const DOTTED = "ns.search";
const VALID = "read_file";
const schema = {
  type: "object",
  properties: { q: { type: "string" } },
  required: ["q"],
};

const chatBody = (name, extra = {}) => ({
  messages: [
    { role: ROLE.USER, content: "hi" },
    {
      role: ROLE.ASSISTANT,
      tool_calls: [{ id: "c1", type: OPENAI_BLOCK.FUNCTION, function: { name, arguments: "{}" } }],
    },
    { role: ROLE.TOOL, tool_call_id: "c1", name, content: "ok" },
  ],
  tools: [{ type: OPENAI_BLOCK.FUNCTION, function: { name, description: "d", parameters: schema } }],
  tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name } },
  ...extra,
});

function encodeChunks(...chunks) {
  return chunks
    .map((c) => `data: ${JSON.stringify(c)}`)
    .concat(["", "data: [DONE]", ""])
    .join("\n");
}

function parseSseEvents(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .filter((payload) => payload && payload !== "[DONE]")
    .map((payload) => JSON.parse(payload));
}

async function readStream(transform, payloads) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(encodeChunks(...payloads)));
      controller.close();
    },
  });
  const output = stream.pipeThrough(transform);
  const reader = output.getReader();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return parseSseEvents(text + decoder.decode());
}

/** Chat client ← Claude provider (formats differ → translate stream). */
async function streamClaudeToChat(requestBody, toolNameMap, payloads) {
  return readStream(createSSETransformStreamWithLogger(
    FORMATS.CLAUDE,
    FORMATS.OPENAI,
    "test",
    null,
    toolNameMap,
    "m",
    null,
    requestBody,
    null,
    null,
    "off",
    null,
    requestBody,
  ), payloads);
}

/** Chat client ← OpenAI provider (same-format → passthrough stream). */
async function streamChatPassthrough(requestBody, toolNameMap, payloads) {
  return readStream(createPassthroughStreamWithLogger(
    "test",
    null,
    toolNameMap,
    "m",
    null,
    requestBody,
    null,
    null,
    FORMATS.OPENAI,
    null,
    requestBody,
    false,
    null,
  ), payloads);
}

afterEach(() => vi.restoreAllMocks());

describe("Chat→Claude tool-name sanitize (#1343)", () => {
  it("sanitizes declarations, tool_choice, and history with one round-trip map", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "claude-sonnet-4-5",
      chatBody(DOTTED),
      false,
    );
    const alias = out.tools[0].name;
    expect(alias).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(alias).not.toBe(DOTTED);
    expect(out.tool_choice.name).toBe(alias);
    const historyUse = out.messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .find((b) => b.type === "tool_use");
    expect(historyUse.name).toBe(alias);
    expect(out._toolNameMap.get(alias)).toBe(DOTTED);
  });

  it("leaves already-valid names byte-for-byte unchanged", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "claude-sonnet-4-5",
      chatBody(VALID),
      false,
    );
    expect(out.tools[0].name).toBe(VALID);
    expect(out.tool_choice.name).toBe(VALID);
  });

  it("keeps null and non-string tool names on the same path as main", () => {
    const body = {
      messages: [{ role: ROLE.USER, content: "hi" }],
      tools: [
        { type: OPENAI_BLOCK.FUNCTION, function: { name: null, description: "d", parameters: schema } },
        { type: OPENAI_BLOCK.FUNCTION, function: { name: 12, description: "d", parameters: schema } },
      ],
    };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", body, false);
    // Aliaser leaves null/non-string alone; openai-to-claude's empty-prefix concat
    // stringifies them the same way main did before #1343.
    expect(out.tools[0].name).toBe("null");
    expect(out.tools[1].name).toBe("12");
  });

  it("restores the original name on Claude→Chat non-stream and stream", async () => {
    const requestBody = chatBody(DOTTED);
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "claude-sonnet-4-5",
      structuredClone(requestBody),
      false,
    );
    const alias = translated.tools[0].name;
    const toolNameMap = translated._toolNameMap;

    const claudeBody = {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-5",
      content: [{ type: "tool_use", id: "c1", name: alias, input: { q: "a" } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const decloaked = decloakToolNames(claudeBody, toolNameMap);
    const nonstream = translateNonStreamingResponse(decloaked, FORMATS.CLAUDE, FORMATS.OPENAI, {
      toolNameMap,
      requestBody,
    });
    expect(nonstream.choices[0].message.tool_calls[0].function.name).toBe(DOTTED);

    const events = await streamClaudeToChat(requestBody, toolNameMap, [
      { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "m", content: [] } },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "c1", name: alias, input: {} },
      },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":\"a\"}" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ]);
    const toolChunk = events.find((e) => e.choices?.[0]?.delta?.tool_calls?.[0]?.function?.name);
    expect(toolChunk.choices[0].delta.tool_calls[0].function.name).toBe(DOTTED);
  });
});

describe("Chat→OpenAI tool-name sanitize (#1343)", () => {
  it("sanitizes declarations, tool_choice, and history with one round-trip map", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "m", chatBody(DOTTED), false);
    const alias = out.tools[0].function.name;
    expect(alias).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(alias).not.toBe(DOTTED);
    expect(out.tool_choice.function.name).toBe(alias);
    expect(out.messages[1].tool_calls[0].function.name).toBe(alias);
    expect(out.messages[2].name).toBe(alias);
    expect(out._toolNameMap.get(alias)).toBe(DOTTED);
  });

  it("leaves already-valid names byte-for-byte unchanged", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "m", chatBody(VALID), false);
    expect(out.tools[0].function.name).toBe(VALID);
    expect(out.tool_choice.function.name).toBe(VALID);
    expect(out.messages[1].tool_calls[0].function.name).toBe(VALID);
    expect((out._toolNameMap?.size) ?? 0).toBe(0);
  });

  it("keeps null and non-string tool names unchanged", () => {
    const body = {
      messages: [{ role: ROLE.USER, content: "hi" }],
      tools: [
        { type: OPENAI_BLOCK.FUNCTION, function: { name: null, description: "d", parameters: schema } },
        { type: OPENAI_BLOCK.FUNCTION, function: { name: { x: 1 }, description: "d", parameters: schema } },
      ],
      tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: null } },
    };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "m", body, false);
    expect(out.tools[0].function.name).toBeNull();
    expect(out.tools[1].function.name).toEqual({ x: 1 });
    expect(out.tool_choice.function.name).toBeNull();
  });

  it("restores a provided alias map on same-format Chat non-stream", () => {
    // Hand-built map: proves the non-stream same-format path restores even when
    // the request clamp ran elsewhere (chatCore). Fails on main before #1343.
    const alias = "ns_search_d2c032363399";
    const toolNameMap = new Map([[alias, DOTTED]]);
    const completion = {
      id: "x",
      object: "chat.completion",
      choices: [{
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: ROLE.ASSISTANT,
          tool_calls: [{
            id: "call_1",
            type: OPENAI_BLOCK.FUNCTION,
            function: { name: alias, arguments: "{}" },
          }],
        },
      }],
    };
    const out = translateNonStreamingResponse(completion, FORMATS.OPENAI, FORMATS.OPENAI, { toolNameMap });
    expect(out.choices[0].message.tool_calls[0].function.name).toBe(DOTTED);
  });

  it("restores the original name on Chat non-stream and stream", async () => {
    const requestBody = chatBody(DOTTED);
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "m",
      structuredClone(requestBody),
      false,
    );
    const alias = translated.tools[0].function.name;
    const toolNameMap = translated._toolNameMap;
    expect(alias).not.toBe(DOTTED);
    expect(toolNameMap.get(alias)).toBe(DOTTED);

    const completion = {
      id: "x",
      object: "chat.completion",
      choices: [{
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: ROLE.ASSISTANT,
          tool_calls: [{
            id: "call_1",
            type: OPENAI_BLOCK.FUNCTION,
            function: { name: alias, arguments: "{}" },
          }],
        },
      }],
    };
    const nonstream = translateNonStreamingResponse(completion, FORMATS.OPENAI, FORMATS.OPENAI, {
      toolNameMap,
      requestBody,
    });
    expect(nonstream.choices[0].message.tool_calls[0].function.name).toBe(DOTTED);

    const events = await streamChatPassthrough(requestBody, toolNameMap, [{
      id: "x",
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_1",
            type: OPENAI_BLOCK.FUNCTION,
            function: { name: alias, arguments: "{}" },
          }],
        },
        finish_reason: "tool_calls",
      }],
    }]);
    expect(events[0].choices[0].delta.tool_calls[0].function.name).toBe(DOTTED);
  });
});

describe("Chat sanitize does not touch Responses→Claude pivot (#1343)", () => {
  it("still aliases Responses→Claude via the existing pivot map", () => {
    const out = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.CLAUDE,
      "claude-sonnet-4-5",
      {
        input: "hi",
        tools: [{ type: OPENAI_BLOCK.FUNCTION, name: DOTTED, description: "d", parameters: schema }],
        tool_choice: { type: OPENAI_BLOCK.FUNCTION, name: DOTTED },
      },
      false,
    );
    const alias = out.tools[0].name;
    expect(alias).not.toBe(DOTTED);
    expect(out._toolNameMap.get(alias)).toBe(DOTTED);
  });
});
