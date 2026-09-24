// OmniRoute #14582 (content stall vs transport failure in stream abandon
// reasons) and #14585 (request-scoped SSE errors stay out of cooldowns).
import { describe, expect, it, vi } from "vitest";
import {
  classifyStreamAbandonReason,
  extractStreamErrorPayload,
  isRequestScopedStreamError,
} from "../../open-sse/utils/streamLifecycle.js";
import { buildOnStreamComplete } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
  appendRequestLog: vi.fn(() => Promise.resolve()),
}));

describe("classifyStreamAbandonReason (#14582)", () => {
  it.each([
    [new Error("stream stall timeout"), "stall_timeout"],
    [new Error("stream ttft timeout (200000ms)"), "ttft_timeout"],
    [new TypeError("terminated"), "stream_terminated"],
    ["Agent execution terminated due to error", "stream_terminated"],
    [new Error("read ECONNRESET"), "stream_error"],
    [new Error("socket hang up"), "stream_error"],
    [null, "stream_error"],
  ])("classifies %s as %s", (error, expected) => {
    expect(classifyStreamAbandonReason(error)).toBe(expected);
  });
});

describe("extractStreamErrorPayload", () => {
  it("reads OpenAI, Anthropic and Responses error envelopes", () => {
    expect(extractStreamErrorPayload({ error: { type: "invalid_request_error", message: "bad" } }))
      .toEqual({ type: "invalid_request_error", code: undefined, message: "bad" });
    expect(extractStreamErrorPayload({ type: "error", error: { type: "overloaded_error", message: "busy" } }))
      .toMatchObject({ type: "overloaded_error" });
    expect(extractStreamErrorPayload({
      type: "response.failed",
      response: { error: { code: "context_length_exceeded", message: "too long" } },
    })).toMatchObject({ code: "context_length_exceeded" });
    expect(extractStreamErrorPayload({ type: "error", code: "server_error", message: "boom" }))
      .toMatchObject({ code: "server_error" });
    expect(extractStreamErrorPayload({ error: "plain" })).toEqual({ message: "plain" });
  });

  it("ignores frames that are not errors", () => {
    expect(extractStreamErrorPayload(null)).toBeNull();
    expect(extractStreamErrorPayload({ choices: [{ delta: { content: "hi" } }] })).toBeNull();
    expect(extractStreamErrorPayload({ type: "response.failed", response: {} })).toBeNull();
  });
});

describe("isRequestScopedStreamError (#14585)", () => {
  it("flags invalid requests and context overflow by type or code", () => {
    expect(isRequestScopedStreamError({ type: "invalid_request_error" })).toBe(true);
    expect(isRequestScopedStreamError({ code: "context_length_exceeded" })).toBe(true);
    expect(isRequestScopedStreamError({ type: "error", code: "CONTEXT_WINDOW_EXCEEDED" })).toBe(true);
  });

  it("leaves transient and account failures alone", () => {
    expect(isRequestScopedStreamError({ type: "server_error" })).toBe(false);
    expect(isRequestScopedStreamError({ type: "overloaded_error" })).toBe(false);
    expect(isRequestScopedStreamError({ code: "rate_limit_exceeded" })).toBe(false);
    expect(isRequestScopedStreamError(null)).toBe(false);
  });
});

function buildComplete(onEmptyStream) {
  return buildOnStreamComplete({
    provider: "openai",
    model: "gpt-5",
    connectionId: "connection",
    requestStartTime: 1000,
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: true,
    onEmptyStream,
    log: { line: vi.fn(), warn: vi.fn() },
  });
}

describe("empty-stream cooldown skips request-scoped refusals (#14585)", () => {
  it("does not cool down when the empty stream carried an invalid_request_error", () => {
    const onEmptyStream = vi.fn();
    buildComplete(onEmptyStream).onStreamComplete(
      { content: "", upstreamError: { type: "invalid_request_error", message: "bad schema" } },
      { prompt_tokens: 3, completion_tokens: 0 },
      1005,
      null,
    );
    expect(onEmptyStream).not.toHaveBeenCalled();
  });

  it("still cools down an empty stream that carried a transient error", () => {
    const onEmptyStream = vi.fn();
    buildComplete(onEmptyStream).onStreamComplete(
      { content: "", upstreamError: { type: "server_error", message: "boom" } },
      { prompt_tokens: 3, completion_tokens: 0 },
      1005,
      null,
    );
    expect(onEmptyStream).toHaveBeenCalledTimes(1);
  });

  it("passthrough hands the first in-stream error to onStreamComplete", async () => {
    const onStreamComplete = vi.fn();
    const stream = createPassthroughStreamWithLogger("openai", null, null, "gpt-5", null, null, onStreamComplete);
    const drained = new Response(stream.readable).text();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(
      `data: ${JSON.stringify({ error: { type: "invalid_request_error", code: "context_length_exceeded", message: "too long" } })}\n\n`,
    ));
    await writer.write(encoder.encode("data: [DONE]\n\n"));
    await writer.close();
    await drained;

    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(onStreamComplete.mock.calls[0][0].upstreamError).toMatchObject({
      type: "invalid_request_error",
      code: "context_length_exceeded",
    });
  });
});
