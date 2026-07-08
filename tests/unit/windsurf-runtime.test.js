import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function encodeVarint(value) {
  const bytes = [];
  let v = value >>> 0;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7f);
  return new Uint8Array(bytes);
}

function concatBytes(arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const array of arrays) {
    out.set(array, offset);
    offset += array.length;
  }
  return out;
}

function encodeField(fieldNum, payload) {
  return concatBytes([encodeVarint((fieldNum << 3) | 2), encodeVarint(payload.length), payload]);
}

function encodeString(fieldNum, value) {
  return encodeField(fieldNum, new TextEncoder().encode(value));
}

function makeFrame(flag, payload) {
  const frame = new Uint8Array(5 + payload.length);
  frame[0] = flag;
  new DataView(frame.buffer).setUint32(1, payload.length, false);
  frame.set(payload, 5);
  return frame;
}

function textFromSseLine(line) {
  return JSON.parse(line.slice("data: ".length));
}

describe("Windsurf runtime wire helpers", () => {
  it("normalizes OmniRoute model aliases and passes unknown models through", async () => {
    const { __windsurfInternals } = await import("../../open-sse/executors/windsurf.js");

    expect(__windsurfInternals.resolveWsModelId("swe-1.6-fast")).toBe("swe-1-6-fast");
    expect(__windsurfInternals.resolveWsModelId("gpt-5.5")).toBe("gpt-5-5-medium");
    expect(__windsurfInternals.resolveWsModelId("claude-sonnet-4.6")).toBe("claude-sonnet-4-6");
    expect(__windsurfInternals.resolveWsModelId("gemini-2.5-pro")).toBe("MODEL_GOOGLE_GEMINI_2_5_PRO");
    expect(__windsurfInternals.resolveWsModelId("some-unknown-model")).toBe("some-unknown-model");
  });

  it("converts OpenAI text messages into Windsurf chat messages", async () => {
    const { __windsurfInternals } = await import("../../open-sse/executors/windsurf.js");

    expect(__windsurfInternals.openAIMessagesToWs([
      {
        role: "user",
        content: [
          { type: "text", text: "Part A " },
          { type: "text", text: "Part B" },
        ],
      },
      { role: "tool", content: "result", tool_call_id: "call_1" },
      { content: undefined },
    ])).toEqual([
      { role: "user", content: "Part A Part B", toolCallId: undefined },
      { role: "tool", content: "result", toolCallId: "call_1" },
      { role: "user", content: "", toolCallId: undefined },
    ]);
  });

  it("wraps and parses gRPC-web frames while ignoring truncated payloads", async () => {
    const { __windsurfInternals } = await import("../../open-sse/executors/windsurf.js");
    const enc = new TextEncoder();
    const first = __windsurfInternals.grpcWebFrame(enc.encode("hello"));
    const second = makeFrame(0x80, enc.encode("grpc-status: 0\r\n"));
    const truncated = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x64, 1, 2, 3]);

    expect(first[0]).toBe(0);
    expect(new DataView(first.buffer).getUint32(1, false)).toBe(5);

    const { frames, incomplete } = __windsurfInternals.parseGrpcWebFrames(
      __windsurfInternals.concatBytes([first, second, truncated])
    );
    expect(frames).toHaveLength(2);
    expect(new TextDecoder().decode(frames[0].payload)).toBe("hello");
    expect(frames[1].flag).toBe(0x80);
    expect(incomplete).toBe(true);
  });

  it("decodes content, done usage, and upstream error protobuf chunks", async () => {
    const { __windsurfInternals } = await import("../../open-sse/executors/windsurf.js");
    const { encodeField, encodeString, encodeVarint, decodeCompletionChunk, concatBytes } = __windsurfInternals;

    const contentChunk = encodeField(1, encodeString(1, "hello"));
    expect(decodeCompletionChunk(contentChunk)).toEqual({ kind: "content", text: "hello" });

    const usageStats = concatBytes([
      encodeVarint((1 << 3) | 0),
      encodeVarint(7),
      encodeVarint((2 << 3) | 0),
      encodeVarint(11),
    ]);
    const doneChunk = encodeField(3, encodeField(1, usageStats));
    expect(decodeCompletionChunk(doneChunk)).toEqual({
      kind: "done",
      promptTokens: 7,
      completionTokens: 11,
    });

    const errorChunk = encodeField(4, encodeString(1, "quota exhausted"));
    expect(decodeCompletionChunk(errorChunk)).toEqual({
      kind: "error",
      message: "quota exhausted",
    });
  });

  it("encodes token, model, and chat messages into GetChatMessage protobuf", async () => {
    const { __windsurfInternals } = await import("../../open-sse/executors/windsurf.js");
    const request = __windsurfInternals.buildGetChatMessageRequest("ws-token", "swe-1-6", [
      { role: "user", content: "hello" },
    ]);
    const framed = __windsurfInternals.grpcWebFrame(request);

    expect(__windsurfInternals.parseGrpcWebFrames(framed).frames[0].payload).toEqual(request);
    expect(new TextDecoder().decode(request)).toContain("swe-1-6");
    expect(new TextDecoder().decode(request)).toContain("ws-token");
    expect(new TextDecoder().decode(request)).toContain("hello");
  });
});

describe("Windsurf executor behavior", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts framed protobuf through proxy-aware fetch and converts gRPC-web content to SSE", async () => {
    const calls = [];
    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({
      proxyAwareFetch: vi.fn(async (url, init, proxyOptions) => {
        calls.push({ url, init, proxyOptions });
        const enc = new TextEncoder();
        const payload = encodeField(1, encodeString(1, "pong"));
        const trailer = makeFrame(0x80, enc.encode("grpc-status: 0\r\n"));
        return new Response(concatBytes([makeFrame(0x00, payload), trailer]), {
          status: 200,
          headers: { "Content-Type": "application/grpc-web+proto" },
        });
      }),
    }));

    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const result = await new WindsurfExecutor().execute({
      model: "swe-1.6-fast",
      body: { messages: [{ role: "user", content: "ping" }] },
      credentials: { accessToken: "ws-token" },
      proxyOptions: { strictProxy: true },
      upstreamExtraHeaders: { "X-Test": "1" },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("LanguageServerService/GetChatMessage");
    expect(calls[0].proxyOptions).toEqual({ strictProxy: true });
    expect(calls[0].init.headers.Authorization).toBe("Bearer ws-token");
    expect(calls[0].init.headers["X-Test"]).toBe("1");
    expect(calls[0].init.body[0]).toBe(0);
    expect(result.transformedBody).toBeNull();

    const text = await result.response.text();
    const dataLines = text.split("\n").filter((line) => line.startsWith("data: ") && line !== "data: [DONE]");
    expect(textFromSseLine(dataLines[0]).choices[0].delta.role).toBe("assistant");
    expect(textFromSseLine(dataLines[1]).choices[0].delta.content).toBe("pong");
    expect(text).toContain("data: [DONE]");
  });

  it("collects gRPC-web chunks into a non-streaming OpenAI chat completion", async () => {
    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({
      proxyAwareFetch: vi.fn(async () => {
        const usageStats = concatBytes([
          encodeVarint((1 << 3) | 0),
          encodeVarint(5),
          encodeVarint((2 << 3) | 0),
          encodeVarint(2),
        ]);
        const body = concatBytes([
          makeFrame(0x00, encodeField(1, encodeString(1, "hel"))),
          makeFrame(0x00, encodeField(1, encodeString(1, "lo"))),
          makeFrame(0x00, encodeField(3, encodeField(1, usageStats))),
          makeFrame(0x80, new TextEncoder().encode("grpc-status: 0\r\n")),
        ]);
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/grpc-web+proto" },
        });
      }),
    }));

    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const result = await new WindsurfExecutor().execute({
      model: "swe-1.6-fast",
      body: { messages: [{ role: "user", content: "ping" }] },
      stream: false,
      credentials: { accessToken: "ws-token" },
    });

    expect(result.response.headers.get("content-type")).toContain("application/json");
    const body = await result.response.json();
    expect(body).toMatchObject({
      object: "chat.completion",
      model: "swe-1.6-fast",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "hello" },
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 2,
        total_tokens: 7,
      },
    });
  });

  it("turns upstream error chunks into 502 errors", async () => {
    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({
      proxyAwareFetch: vi.fn(async () => {
        const payload = encodeField(4, encodeString(1, "bad token"));
        const enc = new TextEncoder();
        const trailer = makeFrame(0x80, enc.encode("grpc-status: 0\r\n"));
        return new Response(concatBytes([makeFrame(0x00, payload), trailer]), { status: 200 });
      }),
    }));

    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const result = await new WindsurfExecutor().execute({
      model: "swe-1",
      body: { messages: [{ role: "user", content: "ping" }] },
      credentials: { accessToken: "ws-token" },
    });

    expect(result.response.status).toBe(502);
    const body = await result.response.json();
    expect(body.error.message).toBe("bad token");
    expect(body.error.code).toBe("upstream_error");
  });

  it("detects truncated gRPC-web frames as incomplete", async () => {
    const { __windsurfInternals } = await import("../../open-sse/executors/windsurf.js");
    const enc = new TextEncoder();
    const fullFrame = __windsurfInternals.grpcWebFrame(enc.encode("hi"));
    const truncated = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x64, 1, 2, 3]);
    const { frames, incomplete } = __windsurfInternals.parseGrpcWebFrames(
      __windsurfInternals.concatBytes([fullFrame, truncated])
    );
    expect(frames).toHaveLength(1);
    expect(incomplete).toBe(true);

    const only = __windsurfInternals.parseGrpcWebFrames(fullFrame);
    expect(only.frames).toHaveLength(1);
    expect(only.incomplete).toBe(false);
  });

  it("surfaces truncated final frames as non-streaming errors", async () => {
    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({
      proxyAwareFetch: vi.fn(async () => {
        const truncated = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x64, 1, 2, 3]);
        return new Response(truncated, { status: 200 });
      }),
    }));
    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const result = await new WindsurfExecutor().execute({
      model: "swe-1",
      body: { messages: [{ role: "user", content: "ping" }] },
      stream: false,
      credentials: { accessToken: "ws-token" },
    });
    expect(result.response.status).toBe(502);
    const body = await result.response.json();
    expect(body.error.message).toBe("Incomplete gRPC-web frame");
  });

  it("surfaces truncated final frames as streaming 502 errors", async () => {
    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({
      proxyAwareFetch: vi.fn(async () => {
        const truncated = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x64, 1, 2, 3]);
        return new Response(truncated, { status: 200 });
      }),
    }));
    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const result = await new WindsurfExecutor().execute({
      model: "swe-1",
      body: { messages: [{ role: "user", content: "ping" }] },
      credentials: { accessToken: "ws-token" },
    });
    expect(result.response.status).toBe(502);
    const body = await result.response.json();
    expect(body.error.message).toContain("Incomplete");
    expect(body.error.code).toBe("upstream_error");
  });

  it("returns 502 when streaming response lacks a gRPC OK trailer", async () => {
    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({
      proxyAwareFetch: vi.fn(async () => {
        const payload = encodeField(1, encodeString(1, "pong"));
        return new Response(makeFrame(0x00, payload), { status: 200 });
      }),
    }));
    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const result = await new WindsurfExecutor().execute({
      model: "swe-1",
      body: { messages: [{ role: "user", content: "ping" }] },
      credentials: { accessToken: "ws-token" },
    });
    expect(result.response.status).toBe(502);
    const body = await result.response.json();
    expect(body.error.message).toContain("Missing gRPC OK trailer");
    expect(body.error.code).toBe("upstream_error");
  });

  it("returns 502 when streaming gRPC trailer reports a non-zero status", async () => {
    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({
      proxyAwareFetch: vi.fn(async () => {
        const enc = new TextEncoder();
        const payload = encodeField(1, encodeString(1, "pong"));
        const trailer = makeFrame(0x80, enc.encode("grpc-status: 7\r\ngrpc-message: permission denied\r\n"));
        return new Response(concatBytes([makeFrame(0x00, payload), trailer]), { status: 200 });
      }),
    }));
    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const result = await new WindsurfExecutor().execute({
      model: "swe-1",
      body: { messages: [{ role: "user", content: "ping" }] },
      credentials: { accessToken: "ws-token" },
    });
    expect(result.response.status).toBe(502);
    const body = await result.response.json();
    expect(body.error.message).toContain("permission denied");
    expect(body.error.code).toBe("upstream_error");
  });

  it("returns 502 when non-streaming response lacks a gRPC OK trailer", async () => {
    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({
      proxyAwareFetch: vi.fn(async () => {
        const payload = encodeField(1, encodeString(1, "pong"));
        return new Response(makeFrame(0x00, payload), { status: 200 });
      }),
    }));
    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const result = await new WindsurfExecutor().execute({
      model: "swe-1",
      body: { messages: [{ role: "user", content: "ping" }] },
      stream: false,
      credentials: { accessToken: "ws-token" },
    });
    expect(result.response.status).toBe(502);
    const body = await result.response.json();
    expect(body.error.message).toContain("Missing gRPC OK trailer");
    expect(body.error.code).toBe("upstream_error");
  });

  it("rejects requests with image or audio media parts", async () => {
    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const executor = new WindsurfExecutor();

    const withImage = await executor.execute({
      model: "swe-1",
      body: {
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "describe" },
            { type: "image_url", image_url: { url: "https://example.com/img.png" } },
          ],
        }],
      },
      credentials: { accessToken: "ws-token" },
    });
    expect(withImage.response.status).toBe(400);
    expect(await withImage.response.text()).toContain("Media files are not supported for Windsurf");
    expect(withImage.isClientError).toBe(true);

    const withAudio = await executor.execute({
      model: "swe-1",
      body: {
        messages: [{
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: "base64", format: "wav" } },
          ],
        }],
      },
      credentials: { accessToken: "ws-token" },
    });
    expect(withAudio.response.status).toBe(400);
    expect(withAudio.isClientError).toBe(true);
  });

  it("rejects legacy OpenAI function-calling requests", async () => {
    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const executor = new WindsurfExecutor();

    const withFunctions = await executor.execute({
      model: "swe-1",
      body: {
        messages: [{ role: "user", content: "ping" }],
        functions: [{ name: "x", parameters: { type: "object" } }],
        function_call: "auto",
      },
      credentials: { accessToken: "ws-token" },
    });
    expect(withFunctions.response.status).toBe(400);
    expect(withFunctions.isClientError).toBe(true);

    const withFunctionResult = await executor.execute({
      model: "swe-1",
      body: { messages: [{ role: "function", name: "x", content: "result" }] },
      credentials: { accessToken: "ws-token" },
    });
    expect(withFunctionResult.response.status).toBe(400);
    expect(withFunctionResult.isClientError).toBe(true);

    const withAssistantFunctionCall = await executor.execute({
      model: "swe-1",
      body: { messages: [{ role: "assistant", content: null, function_call: { name: "x", arguments: "{}" } }] },
      credentials: { accessToken: "ws-token" },
    });
    expect(withAssistantFunctionCall.response.status).toBe(400);
    expect(withAssistantFunctionCall.isClientError).toBe(true);
  });

  it("rejects modern OpenAI tool-calling requests", async () => {
    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const executor = new WindsurfExecutor();

    const resWithTools = await executor.execute({
      model: "swe-1",
      body: { messages: [{ role: "user", content: "ping" }], tools: [{ type: "function", function: { name: "x" } }] },
      credentials: { accessToken: "ws-token" },
    });
    expect(resWithTools.response.status).toBe(400);
    expect(resWithTools.isClientError).toBe(true);
    const toolsBody = await resWithTools.response.text();
    expect(toolsBody).toContain("Tool calling is not supported for Windsurf");

    const resWithToolResult = await executor.execute({
      model: "swe-1",
      body: { messages: [{ role: "tool", content: "result", tool_call_id: "call_1" }] },
      credentials: { accessToken: "ws-token" },
    });
    expect(resWithToolResult.response.status).toBe(400);
    expect(resWithToolResult.isClientError).toBe(true);

    const resWithAssistantToolCalls = await executor.execute({
      model: "swe-1",
      body: { messages: [{ role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "x", arguments: "{}" } }] }] },
      credentials: { accessToken: "ws-token" },
    });
    expect(resWithAssistantToolCalls.response.status).toBe(400);
    expect(resWithAssistantToolCalls.isClientError).toBe(true);
  });

  it("marks tool rejections as client errors so they do not lock the account", async () => {
    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const executor = new WindsurfExecutor();

    const result = await executor.execute({
      model: "swe-1",
      body: { messages: [{ role: "user", content: "ping" }], tools: [{ type: "function", function: { name: "x" } }] },
      credentials: { accessToken: "ws-token" },
    });
    expect(result.response.status).toBe(400);
    expect(result.isClientError).toBe(true);
  });
});
