/**
 * #1345 — Responses→Chat direct route must clamp tool names to 64 chars and
 * restore the client's original name on the response path (stream + non-stream).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_BLOCK } from "../../open-sse/translator/schema/index.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const longToolName = `tool_${"x".repeat(80)}`;
const schema = {
  type: "object",
  properties: { q: { type: "string" } },
  required: ["q"],
};

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

async function streamChatToResponses(requestBody, toolNameMap, payloads) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(encodeChunks(...payloads)));
      controller.close();
    },
  });
  const output = stream.pipeThrough(createSSETransformStreamWithLogger(
    FORMATS.OPENAI,
    FORMATS.OPENAI_RESPONSES,
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
  ));
  const reader = output.getReader();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return parseSseEvents(text + decoder.decode());
}

afterEach(() => vi.restoreAllMocks());

describe("Responses→Chat tool-name clamp (#1345)", () => {
  it("clamps overlong declarations and tool_choice with a round-trip map", () => {
    const out = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI,
      "m",
      {
        input: "hi",
        tools: [{ type: OPENAI_BLOCK.FUNCTION, name: longToolName, description: "d", parameters: schema }],
        tool_choice: { type: OPENAI_BLOCK.FUNCTION, name: longToolName },
      },
      false,
    );
    const clamped = out.tools[0].function.name;
    expect(clamped.length).toBeLessThanOrEqual(64);
    expect(clamped).not.toBe(longToolName);
    expect(out.tool_choice.function.name).toBe(clamped);
    expect(out._toolNameMap.get(clamped)).toBe(longToolName);
  });

  it("restores the original name on Chat→Responses stream and non-stream", async () => {
    const requestBody = {
      input: "hi",
      tools: [{ type: OPENAI_BLOCK.FUNCTION, name: longToolName, description: "d", parameters: schema }],
    };
    const translated = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI,
      "m",
      structuredClone(requestBody),
      false,
    );
    const clamped = translated.tools[0].function.name;
    const toolNameMap = translated._toolNameMap;

    const events = await streamChatToResponses(requestBody, toolNameMap, [{
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: clamped, arguments: "{}" },
          }],
        },
        finish_reason: "tool_calls",
      }],
    }]);
    const added = events.find((e) => e.type === "response.output_item.added")?.item;
    const done = events.find((e) => e.type === "response.output_item.done")?.item;
    expect(added.name).toBe(longToolName);
    expect(done.name).toBe(longToolName);

    const completion = {
      id: "x",
      choices: [{
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: clamped, arguments: "{}" },
          }],
        },
      }],
    };
    const out = translateNonStreamingResponse(completion, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {
      toolNameMap,
      requestBody,
    });
    const call = out.output.find((item) => item.type === "function_call");
    expect(call.name).toBe(longToolName);
  });
});
