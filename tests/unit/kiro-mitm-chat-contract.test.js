import { describe, expect, it } from "vitest";

const { isChatRequest } = require("../../src/mitm/config.js");
const {
  buildEventStreamFrame,
  buildInitialResponseFrame,
  convertOpenAIToKiro,
  crc32,
  initKiroState,
} = require("../../src/mitm/handlers/kiro.js");

function decodeHeaders(frame) {
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
  return headers;
}

function frames(value) {
  return Array.isArray(value) ? value : [value];
}

describe("Kiro MITM chat classification", () => {
  it("classifies root-path GenerateAssistantResponse by x-amz-target", () => {
    expect(isChatRequest("kiro", {
      url: "/",
      headers: { "x-amz-target": "KiroRuntimeService.GenerateAssistantResponse" },
    })).toBe(true);
  });

  it("leaves non-chat Kiro control requests for passthrough", () => {
    expect(isChatRequest("kiro", {
      url: "/",
      headers: { "x-amz-target": "KiroRuntimeService.ListAvailableModels" },
    })).toBe(false);
  });
});

describe("Kiro Smithy EventStream initial response", () => {
  it("builds checksummed frames with a caller-selected content type", () => {
    const frame = buildEventStreamFrame("initial-response", { conversationId: "" }, "application/x-amz-json-1.0");
    expect(frame.readUInt32BE(0)).toBe(frame.length);
    expect(frame.readUInt32BE(8)).toBe(crc32(frame.subarray(0, 8)));
    expect(frame.readUInt32BE(frame.length - 4)).toBe(crc32(frame.subarray(0, frame.length - 4)));
    expect(decodeHeaders(frame)).toMatchObject({
      ":message-type": "event",
      ":event-type": "initial-response",
      ":content-type": "application/x-amz-json-1.0",
    });
    expect(JSON.parse(frame.subarray(12 + frame.readUInt32BE(4), frame.length - 4).toString())).toEqual({ conversationId: "" });
  });

  it("prepends exactly one initial-response frame across empty and content chunks", () => {
    const state = initKiroState("chosen-model");
    const initialOnly = frames(convertOpenAIToKiro({ choices: [{ delta: {} }] }, state));
    const content = frames(convertOpenAIToKiro({ choices: [{ delta: { content: "hello" } }] }, state));
    expect(decodeHeaders(initialOnly[0])[":event-type"]).toBe("initial-response");
    expect(content).toHaveLength(1);
    expect(decodeHeaders(content[0])[":event-type"]).toBe("assistantResponseEvent");
  });

  it("uses Kiro initial response wire format", () => {
    expect(decodeHeaders(buildInitialResponseFrame())[":content-type"]).toBe("application/x-amz-json-1.0");
  });
});
