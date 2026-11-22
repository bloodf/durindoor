import { describe, expect, it, vi } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}

function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum = (checksum >>> 8) ^ CRC32_TABLE[(checksum ^ byte) & 0xff];
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function createMockFrame(eventType, payload) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const headerNameBytes = new TextEncoder().encode(":event-type");
  const headerValueBytes = new TextEncoder().encode(eventType);
  const headerLength = 1 + headerNameBytes.length + 1 + 2 + headerValueBytes.length;
  const totalLength = 12 + headerLength + payloadBytes.length + 4;
  const frame = new Uint8Array(totalLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headerLength, false);
  view.setUint32(8, crc32(frame.subarray(0, 8)), false);
  let offset = 12;
  frame[offset++] = headerNameBytes.length;
  frame.set(headerNameBytes, offset);
  offset += headerNameBytes.length;
  frame[offset++] = 7;
  view.setUint16(offset, headerValueBytes.length, false);
  offset += 2;
  frame.set(headerValueBytes, offset);
  offset += headerValueBytes.length;
  frame.set(payloadBytes, offset);
  view.setUint32(totalLength - 4, crc32(frame.subarray(0, totalLength - 4)), false);
  return frame;
}

function framesStream(frames) {
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(frame);
      controller.close();
    },
  });
}

async function readAll(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return output + decoder.decode();
    output += decoder.decode(value, { stream: true });
  }
}

function executorStream(frames, model = "claude-test") {
  const executor = new KiroExecutor();
  return executor.transformEventStreamToSSE({ body: framesStream(frames) }, model).body;
}

describe("Kiro object argument snapshots", () => {
  it("emits the final snapshot once for each call", async () => {
    const frames = [
      createMockFrame("toolUseEvent", { toolUseId: "a", name: "read", input: { path: "/a" } }),
      createMockFrame("toolUseEvent", { toolUseId: "b", name: "run", input: { cmd: "ls" } }),
      createMockFrame("toolUseEvent", { toolUseId: "a", name: "read", input: { path: "/abc" } }),
      createMockFrame("messageStopEvent", {}),
    ];
    const text = await readAll(executorStream(frames));
    const args = new Map();
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: {") ) continue;
      const chunk = JSON.parse(line.slice(6));
      for (const call of chunk.choices?.[0]?.delta?.tool_calls || []) {
        args.set(call.index, (args.get(call.index) || "") + (call.function?.arguments || ""));
      }
    }
    expect(JSON.parse(args.get(0))).toEqual({ path: "/abc" });
    expect(JSON.parse(args.get(1))).toEqual({ cmd: "ls" });
  });
});
