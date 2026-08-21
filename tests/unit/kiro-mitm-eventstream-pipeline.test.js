import { describe, expect, it } from "vitest";

const { pipeTransformedEventStream } = require("../../src/mitm/handlers/base.js");
const { convertOpenAIToKiro, crc32, initKiroState } = require("../../src/mitm/handlers/kiro.js");
function responseRecorder() {
  const response = {
    writes: [],
    writeHead(...args) { response.status = args; },
    write(value) { response.writes.push(Buffer.from(value)); },
    end() { response.ended = true; },
  };
  return response;
}

function parseFrames(buffer) {
  const output = [];
  for (let offset = 0; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const frame = buffer.subarray(offset, offset + length);
    expect(length).toBeGreaterThan(15);
    expect(frame.readUInt32BE(8)).toBe(crc32(frame.subarray(0, 8)));
    expect(frame.readUInt32BE(length - 4)).toBe(crc32(frame.subarray(0, length - 4)));
    output.push(frame);
    offset += length;
  }
  return output;
}

function eventType(frame) {
  const headersLength = frame.readUInt32BE(4);
  let offset = 12;
  const end = offset + headersLength;
  while (offset < end) {
    const nameLength = frame[offset++];
    const name = frame.subarray(offset, offset + nameLength).toString();
    offset += nameLength + 1;
    const valueLength = frame.readUInt16BE(offset);
    offset += 2;
    const value = frame.subarray(offset, offset + valueLength).toString();
    offset += valueLength;
    if (name === ":event-type") return value;
  }
  return null;
}

function decodeFrame(frame) {
  const headers = {};
  const headersLength = frame.readUInt32BE(4);
  let offset = 12;
  const end = offset + headersLength;
  while (offset < end) {
    const nameLength = frame[offset++];
    const name = frame.subarray(offset, offset + nameLength).toString();
    offset += nameLength;
    expect(frame[offset++]).toBe(7);
    const valueLength = frame.readUInt16BE(offset);
    offset += 2;
    headers[name] = frame.subarray(offset, offset + valueLength).toString();
    offset += valueLength;
  }
  return {
    headers,
    payload: JSON.parse(frame.subarray(end, frame.length - 4).toString()),
  };
}

function frames(value) {
  return Array.isArray(value) ? value : [value];
}

describe("Kiro MITM EventStream response pipeline", () => {
  it("writes one valid initial-response frame before chat frames", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{}}]}\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const response = responseRecorder();
    await pipeTransformedEventStream({ body }, response, convertOpenAIToKiro, initKiroState("chosen-model"));
    const output = parseFrames(Buffer.concat(response.writes));
    expect(output.map(eventType)).toEqual(["initial-response", "assistantResponseEvent", "messageStopEvent"]);
    expect(output.filter((frame) => eventType(frame) === "initial-response")).toHaveLength(1);
    expect(response.ended).toBe(true);
  });

  it("emits identical content and text when flushing buffered reasoning", () => {
    const state = initKiroState("chosen-model");
    const initial = frames(convertOpenAIToKiro({ choices: [{ delta: { content: "<thinking>buffered thought" } }] }, state));
    expect(initial.map(eventType)).toEqual(["initial-response"]);

    const [reasoningFrame] = parseFrames(Buffer.concat(frames(convertOpenAIToKiro(null, state))));
    expect(decodeFrame(reasoningFrame)).toEqual({
      headers: {
        ":message-type": "event",
        ":event-type": "reasoningContentEvent",
        ":content-type": "application/json",
      },
      payload: { text: "<thinking>buffered thought", content: "<thinking>buffered thought", modelId: "chosen-model" },
    });
  });

  it("emits identical content and text for explicit reasoning content", () => {
    const state = initKiroState("chosen-model");
    const output = parseFrames(Buffer.concat(frames(convertOpenAIToKiro({
      choices: [{ delta: { reasoning_content: "explicit thought" } }],
    }, state))));
    const reasoningFrame = output.find((frame) => eventType(frame) === "reasoningContentEvent");

    expect(decodeFrame(reasoningFrame)).toEqual({
      headers: {
        ":message-type": "event",
        ":event-type": "reasoningContentEvent",
        ":content-type": "application/json",
      },
      payload: { text: "explicit thought", content: "explicit thought", modelId: "chosen-model" },
    });
  });

  it("emits identical content and text for a completed thinking block", () => {
    const state = initKiroState("chosen-model");
    const output = parseFrames(Buffer.concat(frames(convertOpenAIToKiro({
      choices: [{ delta: { content: "<thinking>complete thought</thinking>" } }],
    }, state))));
    const reasoningFrame = output.find((frame) => eventType(frame) === "reasoningContentEvent");

    expect(decodeFrame(reasoningFrame)).toEqual({
      headers: {
        ":message-type": "event",
        ":event-type": "reasoningContentEvent",
        ":content-type": "application/json",
      },
      payload: { text: "complete thought", content: "complete thought", modelId: "chosen-model" },
    });
  });
});
