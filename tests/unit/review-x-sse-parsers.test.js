import { describe, expect, it, vi } from "vitest";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(),
  saveRequestDetail: vi.fn(),
  saveRequestUsage: vi.fn(),
}));

const enc = new TextEncoder();
const dec = new TextDecoder();

const streamOf = (text, size = 7) =>
  new ReadableStream({
    start(controller) {
      for (let i = 0; i < text.length; i += size) controller.enqueue(enc.encode(text.slice(i, i + size)));
      controller.close();
    },
  });

// Pretty-printed JSON so the payload spans several `data:` lines.
const dataFrames = (payloads, { multiline }) =>
  payloads
    .map((payload) =>
      multiline
        ? JSON.stringify(payload, null, 1)
            .split("\n")
            .map((line) => `data: ${line}`)
            .join("\n")
        : `data: ${JSON.stringify(payload)}`,
    )
    .join("\n\n") + "\n\n";

const toEol = (text, eol) => text.replace(/\n/g, eol);

const responsesPayloads = [
  { type: "response.created", response: { id: "resp_1", created_at: 1700000000 } },
  { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "m1", role: "assistant", content: [{ type: "output_text", text: "hi" }] } },
  { type: "response.completed", response: { id: "resp_1", usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } } },
];

const chatPayloads = [
  { id: "c1", choices: [{ index: 0, delta: { role: "assistant", content: "Hel" } }] },
  { id: "c1", choices: [{ index: 0, delta: { content: "lo" } }] },
  { id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } },
];

async function toJson(text) {
  const result = await convertResponsesStreamToJson(streamOf(text));
  return { ...result, id: result.id, created_at: result.created_at };
}

async function transform(text) {
  const out = streamOf(text).pipeThrough(createResponsesApiTransformStream());
  const reader = out.getReader();
  let result = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    result += dec.decode(value);
  }
  // response ids / timestamps are generated per run; normalise them.
  return result.replace(/"created_at":\d+/g, '"created_at":0');
}

describe("streamToJsonConverter SSE framing", () => {
  const baseline = dataFrames(responsesPayloads, { multiline: false });

  it("parses CRLF and CR streams like the LF stream", async () => {
    const expected = await toJson(baseline);
    expect(expected.status).toBe("completed");
    expect(expected.output).toHaveLength(1);
    expect(await toJson(toEol(baseline, "\r\n"))).toEqual(expected);
    expect(await toJson(toEol(baseline, "\r"))).toEqual(expected);
  });

  it("joins multi-line data frames like single-line frames", async () => {
    const expected = await toJson(baseline);
    for (const eol of ["\n", "\r\n", "\r"]) {
      expect(await toJson(toEol(dataFrames(responsesPayloads, { multiline: true }), eol))).toEqual(expected);
    }
  });
});

describe("responsesTransformer SSE framing", () => {
  const baseline = dataFrames(chatPayloads, { multiline: false }) + "data: [DONE]\n\n";
  const multiline = dataFrames(chatPayloads, { multiline: true }) + "data: [DONE]\n\n";

  it("emits Responses events for a well-formed LF stream", async () => {
    const out = await transform(baseline);
    expect(out).toContain("event: response.output_text.delta");
    expect(out).toContain("event: response.completed");
  });

  it("parses CRLF and CR streams like the LF stream", async () => {
    const expected = await transform(baseline);
    expect(await transform(toEol(baseline, "\r\n"))).toBe(expected);
    expect(await transform(toEol(baseline, "\r"))).toBe(expected);
  });

  it("joins multi-line data frames like single-line frames", async () => {
    const expected = await transform(baseline);
    for (const eol of ["\n", "\r\n", "\r"]) {
      expect(await transform(toEol(multiline, eol))).toBe(expected);
    }
  });
});
