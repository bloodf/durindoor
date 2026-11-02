import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_FINISH } from "../../open-sse/translator/schema/index.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in terminal chunk fixture"); }));
});
afterEach(() => {
  try { expect(fetch).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});

async function consume(terminal) {
  const text = "café 世界 🚪";
  const frame = (event) => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`;
  const wire = frame({ type: "response.created", response: { id: "resp-chunk-fixture", status: "in_progress" } }) +
    frame({ type: "response.output_text.delta", delta: text }) +
    frame(terminal).trimEnd();
  const bytes = new TextEncoder().encode(wire);
  let offset = 0;
  const upstream = new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) { controller.close(); return; }
      // Split CR/LF, JSON tokens, and every multibyte scalar independently.
      controller.enqueue(bytes.slice(offset, ++offset));
    },
  });
  const onStreamComplete = vi.fn();
  const onCoherentTerminal = vi.fn();
  const onComplete = vi.fn();
  const onError = vi.fn();
  const streamController = createStreamController({ onComplete, onError });
  let reader;
  let timer;
  try {
    const result = await handleStreamingResponse({
      providerResponse: new Response(upstream, { headers: { "content-type": "text/event-stream" } }),
      provider: "codex", model: "gpt-fixture", targetFormat: FORMATS.OPENAI_RESPONSES,
      sourceFormat: FORMATS.OPENAI, body: { messages: [{ role: "user", content: "hello" }] },
      stream: true, requestStartTime: Date.now(), streamController, onStreamComplete, onCoherentTerminal,
    });
    expect(result.success).toBe(true);
    reader = result.response.body.getReader();
    const drain = async () => {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let output = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
      }
      output += decoder.decode();
      const events = output.split(/\r?\n/).filter((line) => line.startsWith("data:") && line.trim() !== "data: [DONE]")
        .map((line) => JSON.parse(line.slice(5).trim()));
      return { output, events, text, onStreamComplete, onCoherentTerminal, onComplete, onError };
    };
    return await Promise.race([drain(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Chunked terminal did not reach final Response EOF")), 2000);
    })]);
  } finally {
    clearTimeout(timer);
    streamController.abort("terminal chunk fixture cleanup");
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}

function expectSettled(result) {
  expect(result.output).not.toContain("�");
  expect(result.onStreamComplete).toHaveBeenCalledTimes(1);
  expect(result.onComplete).toHaveBeenCalledTimes(1);
  expect(result.onError).not.toHaveBeenCalled();
}

describe("#1089 registered Responses terminals across CRLF and UTF-8 byte boundaries", () => {
  it("retains an unterminated incomplete terminal as one length finish, not stop or failure", async () => {
    const result = await consume({ type: "response.incomplete", response: {
      id: "resp-chunk-fixture", status: "incomplete", incomplete_details: { reason: "max_output_tokens" },
    } });
    expectSettled(result);
    expect(result.events.flatMap((event) => event.choices || []).map((choice) => choice.delta?.content || "").join("")).toBe(result.text);
    expect(result.events.flatMap((event) => event.choices || []).filter((choice) => choice.finish_reason != null)
      .map((choice) => choice.finish_reason)).toEqual([OPENAI_FINISH.LENGTH]);
    expect(result.events.some((event) => event.error)).toBe(false);
    expect(result.onStreamComplete.mock.calls[0][0].upstreamError).toBeUndefined();
    expect(result.onCoherentTerminal).toHaveBeenCalledTimes(1);
  });

  it("retains an unterminated nested response.failed reason and raw error without coherent success", async () => {
    const error = { type: "server_error", code: "fixture_failure", message: "失敗 café 🚪" };
    const result = await consume({ type: "response.failed", response: {
      id: "resp-chunk-fixture", status: "failed", error,
    } });
    expectSettled(result);
    const content = result.events.flatMap((event) => event.choices || []).map((choice) => choice.delta?.content || "").join("");
    // Current registered translator deliberately exposes this nested failure as text plus stop.
    expect(content).toBe(`${result.text}[Error] ${error.message}`);
    expect(result.events.flatMap((event) => event.choices || []).filter((choice) => choice.finish_reason != null)
      .map((choice) => choice.finish_reason)).toEqual([OPENAI_FINISH.STOP]);
    expect(result.onStreamComplete.mock.calls[0][0].upstreamError).toEqual(error);
    expect(result.onCoherentTerminal).not.toHaveBeenCalled();
  });
});
