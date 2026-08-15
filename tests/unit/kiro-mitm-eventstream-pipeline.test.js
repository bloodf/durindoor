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
});
