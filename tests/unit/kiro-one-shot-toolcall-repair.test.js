// Port of decolua/9router PR #2688: malformed nested tool_call wrappers get
// one repair attempt, while valid streams remain unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");

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

function frame(eventType, payload) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const nameBytes = new TextEncoder().encode(":event-type");
  const valueBytes = new TextEncoder().encode(eventType);
  const headerLength = 1 + nameBytes.length + 1 + 2 + valueBytes.length;
  const totalLength = 12 + headerLength + payloadBytes.length + 4;
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headerLength, false);
  view.setUint32(8, crc32(bytes.subarray(0, 8)), false);
  let offset = 12;
  bytes[offset++] = nameBytes.length;
  bytes.set(nameBytes, offset);
  offset += nameBytes.length;
  bytes[offset++] = 7;
  view.setUint16(offset, valueBytes.length, false);
  offset += 2;
  bytes.set(valueBytes, offset);
  offset += valueBytes.length;
  bytes.set(payloadBytes, offset);
  view.setUint32(totalLength - 4, crc32(bytes.subarray(0, totalLength - 4)), false);
  return bytes;
}

function response(frames) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of frames) controller.enqueue(event);
      controller.close();
    },
  }), { status: 200 });
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

const model = "claude-sonnet-4.5";
const credentials = {
  accessToken: "test-key",
  connectionId: "kiro-test",
  providerSpecificData: { authMethod: "api_key" },
};

function requestBody() {
  return {
    conversationState: {
      conversationId: "turn-2688",
      currentMessage: {
        userInputMessage: { content: "Search for the file", modelId: model },
      },
      history: [],
    },
  };
}

const malformed = () => [
  frame("toolUseEvent", {
    toolUseId: "bad-wrapper",
    name: "tool_call",
    input: { arguments: { path: "/tmp/a" } },
  }),
  frame("messageStopEvent", {}),
];

const valid = () => [
  frame("toolUseEvent", {
    toolUseId: "good-wrapper",
    name: "tool_call",
    input: { name: "read_file", arguments: { path: "/tmp/a" } },
  }),
  frame("messageStopEvent", {}),
];

beforeEach(() => fetchMock.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("Kiro one-shot tool_call repair — upstream #2688", () => {
  it("retries one malformed wrapper once with a repair instruction", async () => {
    fetchMock
      .mockResolvedValueOnce(response(malformed()))
      .mockResolvedValueOnce(response(valid()));

    const result = await new KiroExecutor().execute({
      model,
      body: requestBody(),
      stream: true,
      credentials,
    });
    const output = await readAll(result.response.body);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const chunks = output
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6).trim())
      .filter((data) => data && data !== "[DONE]")
      .map((data) => JSON.parse(data));
    const toolCallDeltas = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || []);
    const repairedCall = toolCallDeltas.find((toolCall) => toolCall.id === "good-wrapper");
    const repairedArguments = toolCallDeltas
      .filter((toolCall) => toolCall.index === repairedCall?.index)
      .map((toolCall) => toolCall.function?.arguments || "")
      .join("");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retryBody.conversationState.currentMessage.userInputMessage.content)
      .toContain("Retry the previous response because its Kiro tool_call wrapper was malformed.");
    expect(repairedCall?.function.name).toBe("tool_call");
    expect(JSON.parse(repairedArguments)).toEqual({
      name: "read_file",
      arguments: { path: "/tmp/a" },
    });
    expect(output).not.toContain('"code":"invalid_kiro_tool_call"');
  });

  it("bounds an always-malformed turn at two upstream calls and preserves the validator error shape", async () => {
    fetchMock
      .mockResolvedValueOnce(response(malformed()))
      .mockResolvedValueOnce(response(malformed()));

    const result = await new KiroExecutor().execute({
      model,
      body: requestBody(),
      stream: true,
      credentials,
    });
    const output = await readAll(result.response.body);
    const errorLine = output.split("\n").find((line) => line.startsWith("data: "));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(errorLine.slice(6))).toEqual({
      error: {
        message: "Invalid Kiro tool_call payload: missing nested MCP tool name at input.name",
        type: "invalid_tool_call",
        code: "invalid_kiro_tool_call",
      },
    });
  });

  it("does not retry or alter a well-formed wrapper stream", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const expected = await readAll(
      new KiroExecutor().transformEventStreamToSSE(response(valid()), model).body,
    );
    fetchMock.mockResolvedValueOnce(response(valid()));

    const result = await new KiroExecutor().execute({
      model,
      body: requestBody(),
      stream: true,
      credentials,
    });
    const output = await readAll(result.response.body);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(output).toBe(expected);
  });
});
