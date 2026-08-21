// Port of decolua/9router PR #2681: Kiro's nested tool_call wrapper must be
// complete and valid before any client-visible tool call is emitted.
import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { KIRO_MAX_TOOL_CALL_WRAPPER_BYTES } from "../../open-sse/config/kiroConstants.js";

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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Kiro nested tool_call wrapper — upstream #2681", () => {
  it("forwards a truncated wrapper as a structured Claude error without a tool block", async () => {
    const providerStream = executorStream([
      createMockFrame("toolUseEvent", {
        toolUseId: "wrapper-1",
        name: "tool_call",
        input: '{"name":"read_file","arguments":',
      }),
      createMockFrame("messageStopEvent", {}),
    ]);
    const translated = providerStream.pipeThrough(createSSETransformStreamWithLogger(
      FORMATS.KIRO,
      FORMATS.CLAUDE,
      "kiro",
      null,
      null,
      "claude-test",
    ));

    const output = await readAll(translated);

    expect(output).toContain("event: error");
    expect(output).toContain('"code":"invalid_kiro_tool_call"');
    expect(output).toContain("input must be valid JSON");
    expect(output).not.toContain('"type":"tool_use"');
    expect(output).not.toContain('"finish_reason":"tool_calls"');
  });

  it("keeps a complete wrapper byte-identical to the pre-validation stream", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const input = { name: "read_file", arguments: { path: "/tmp/a" } };
    const framesFor = (name) => [
      createMockFrame("toolUseEvent", {
        toolUseId: "wrapper-1",
        name,
        input,
      }),
      createMockFrame("messageStopEvent", {}),
    ];

    const output = await readAll(executorStream(framesFor("tool_call")));
    // `tool_calm` has the same byte length as `tool_call` but routes through
    // Kiro's untouched pre-validation tool emitter. Normalizing only that
    // dispatch marker leaves its real framing, usage, and terminal bytes intact.
    const preValidationOutput = (
      await readAll(executorStream(framesFor("tool_calm")))
    ).replace('"name":"tool_calm"', '"name":"tool_call"');

    expect(output).toBe(preValidationOutput);
  });

  it("rejects an incomplete wrapper at the byte cap instead of buffering without bound", async () => {
    const oversizedFragment = "x".repeat(KIRO_MAX_TOOL_CALL_WRAPPER_BYTES + 1);
    const output = await readAll(executorStream([
      createMockFrame("toolUseEvent", {
        toolUseId: "wrapper-1",
        name: "tool_call",
        input: oversizedFragment,
      }),
    ]));

    expect(output).toContain('"code":"invalid_kiro_tool_call"');
    expect(output).toContain(`exceeds ${KIRO_MAX_TOOL_CALL_WRAPPER_BYTES} bytes`);
    expect(output).not.toContain('"tool_calls"');
    expect(output.length).toBeLessThan(2048);
  });
});
