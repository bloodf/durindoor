import { describe, it, expect, vi } from "vitest";

vi.mock("../../open-sse/translator/index.js", () => ({
  translateResponse: vi.fn((from, to, chunk) => {
    // Simulate a buggy translator that returns [null] on flush.
    if (chunk === null) return [null];
    return [chunk];
  }),
  initState: vi.fn(() => ({})),
}));
vi.mock("../../open-sse/translator/formats.js", () => ({
  FORMATS: { OPENAI: "openai", OPENAI_RESPONSES: "openai-responses", CLAUDE: "claude" },
}));
vi.mock("../../open-sse/utils/stream.js", () => ({
  formatSSE: vi.fn((chunk) => (chunk == null ? null : `data: ${JSON.stringify(chunk)}\n\n`)),
}));

const { mergeChunksToResponse, createNonStreamingResponse, createStreamingResponse } = await import("../../open-sse/utils/bypassResponse.js");

describe("createNonStreamingResponse", () => {
  it("returns a Chat Completions JSON response for openai sourceFormat", async () => {
    const { response } = await createNonStreamingResponse("openai", "demo", "hello");
    const body = await response.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("hello");
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  it("returns a Responses API JSON object for openai-responses sourceFormat", async () => {
    const { response } = await createNonStreamingResponse("openai-responses", "demo", "hello");
    const body = await response.json();
    expect(body.object).toBe("response");
    expect(body.output[0].content[0].text).toBe("hello");
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });
});

describe("createStreamingResponse", () => {
  it("emits valid OpenAI SSE frames for openai sourceFormat", async () => {
    const { response } = await createStreamingResponse("openai", "demo", "hello");
    const text = await response.text();
    const lines = text.trim().split("\n").filter(Boolean);
    expect(lines[0]).toContain("data: {");
    expect(lines.some(l => l.includes("[DONE]"))).toBe(true);
    expect(text).not.toContain("data: null");
  });

  it("emits OpenAI SSE frames for openai-responses sourceFormat", async () => {
    const { response } = await createStreamingResponse("openai-responses", "demo", "hello");
    const text = await response.text();
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(text).toContain("data: {");
    expect(text).toContain("data: [DONE]");
    expect(text).not.toContain("data: null");
  });
});
describe("mergeChunksToResponse", () => {
  it("reconstructs non-streaming Claude message content from translated chunks", () => {
    const chunks = [
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "demo",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, cache_read_input_tokens: 2 },
        },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello world" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } },
      { type: "message_stop" },
    ];

    const result = mergeChunksToResponse(chunks, "claude");

    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.content).toEqual([{ type: "text", text: "hello world" }]);
    expect(result.stop_reason).toBe("end_turn");
    expect(result.usage).toEqual({ input_tokens: 1, cache_read_input_tokens: 2, output_tokens: 3 });
  });
});
