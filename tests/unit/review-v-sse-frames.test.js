import { describe, expect, it, vi } from "vitest";
import { createSseFrameReader, parseSseFrame } from "../../open-sse/utils/sseFrames.js";
import { MAX_PENDING_SSE_LINE_BYTES } from "../../open-sse/utils/pendingSseLine.js";
import { mapInteractionEvents } from "../../open-sse/utils/interactionEvents.js";
import { transformToOllama } from "../../open-sse/utils/ollamaTransform.js";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";
import { parseSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(),
  saveRequestDetail: vi.fn(),
  saveRequestUsage: vi.fn(),
}));

const enc = new TextEncoder();
const splitStream = (text) =>
  new ReadableStream({
    start(controller) {
      for (const part of [text.slice(0, 13), text.slice(13, 37), text.slice(37)]) {
        controller.enqueue(enc.encode(part));
      }
      controller.close();
    },
  });

const multilineCrlfFrame = (first, second, eventName = null) =>
  `: comment\r\n${eventName ? `event: ${eventName}\r\n` : ""}data:  ${first}\r\n data: ignored\r\ndata:${second}\r\n\r\n`;

describe("shared SSE frames", () => {
  it("preserves whitespace after one optional space, joins data lines, ignores comments, and handles split CRLF", () => {
    const reader = createSseFrameReader();
    expect(reader.push(": comment\r\nevent: custom\r\ndata:  one\r\n data: ignored\r\ndata:two\r\n\r")).toEqual([]);
    const frames = reader.push("\n");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      eventName: "custom",
      data: " one\ntwo",
      dataLines: [" one", "two"],
      hasData: true,
    });

    expect(parseSseFrame("event: first\nevent:\ndata\ndata: tail")).toMatchObject({
      eventName: null,
      data: "\ntail",
      dataLines: ["", "tail"],
      hasData: true,
    });

    expect(reader.push("data: unterminated")).toEqual([]);
    expect(reader.flush()[0].data).toBe("unterminated");
    expect(reader.flush()).toEqual([]);
  });

  it("enforces the pending frame byte cap in UTF-8 bytes", () => {
    expect(MAX_PENDING_SSE_LINE_BYTES).toBe(64 * 1024 * 1024);
    const small = createSseFrameReader({ maxBytes: 10 });
    expect(small.push("data: é\n")).toEqual([]);
    expect(() => small.push("éé\n")).toThrowError(
      expect.objectContaining({ code: "invalid_sse_payload" }),
    );
    expect(() => createSseFrameReader({ maxBytes: 10 }).push("data: éééé\n\n")).toThrowError(
      expect.objectContaining({ code: "invalid_sse_payload" }),
    );
  });

  it("decodes equivalent CRLF, multi-line, and whitespace frames identically across all migrated consumers", async () => {
    const chatFrame = multilineCrlfFrame(
      '{"id":"x",',
      '"choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":"stop"}]}',
    );
    const doneFrame = ": trailing comment\r\ndata:  [DONE]\r\n\r\n";
    const wire = chatFrame + doneFrame;

    const interaction = await new Response(
      mapInteractionEvents(splitStream(wire), (event) => event.choices[0].delta.content),
    ).text();
    expect(interaction).toBe("hello");

    expect(parseSSEToOpenAIResponse(wire, "test").choices[0].message.content).toBe("hello");

    const ollama = await transformToOllama(new Response(splitStream(wire)), "test").text();
    const ollamaLines = ollama.trim().split("\n").map((line) => JSON.parse(line));
    expect(ollamaLines[0].message.content).toBe("hello");
    expect(ollamaLines.filter((line) => line.done === true)).toHaveLength(1);

    const responses = await new Response(
      splitStream(wire).pipeThrough(createResponsesApiTransformStream()),
    ).text();
    expect(responses).toContain('"delta":"hello"');

    const completedWire =
      multilineCrlfFrame(
        '{"type":"response.completed",',
        '"response":{"id":"resp_test","output":[{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"hello","annotations":[]}]}]}}',
      ) + doneFrame;
    const json = await convertResponsesStreamToJson(splitStream(completedWire));
    expect(json).toMatchObject({
      id: "resp_test",
      status: "completed",
      output: [
        {
          id: "msg_1",
          content: [{ text: "hello" }],
        },
      ],
    });
  });
});
