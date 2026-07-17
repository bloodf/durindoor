import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  buildOnStreamComplete,
  handleStreamingResponse,
} from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

function context(onRequestSuccess, terminalProvenance = "upstream") {
  const completion = buildOnStreamComplete({
    provider: "openai",
    model: "gpt-test",
    connectionId: "conn",
    requestStartTime: Date.now(),
    body: { messages: [{ role: "user", content: "hello" }] },
    stream: true,
    onRequestSuccess,
    getProviderAttemptStartedAt: () => 1234,
    terminalProvenance,
  });
  return {
    provider: "openai",
    model: "gpt-test",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    body: { messages: [{ role: "user", content: "hello" }] },
    stream: true,
    requestStartTime: Date.now(),
    connectionId: "conn",
    streamController: createStreamController({ provider: "openai", model: "gpt-test" }),
    ...completion,
  };
}

describe("stream success lifecycle", () => {
  it("does not clear fallback state for a 200 HTML body", async () => {
    const success = vi.fn();
    const result = await handleStreamingResponse({
      ...context(success),
      providerResponse: new Response("<html><title>upstream failed</title></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    });
    expect(result.success).toBe(false);
    expect(success).not.toHaveBeenCalled();
  });

  it("clears exactly once after an explicit raw OpenAI terminal", async () => {
    const success = vi.fn();
    const sse = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const result = await handleStreamingResponse({
      ...context(success),
      providerResponse: new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
    });
    await result.response.text();
    await Promise.resolve();
    expect(success).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith({ attemptStartedAt: 1234 });
  });

  it.each([
    [null, 0],
    ["upstream", 1],
    ["validated", 1],
  ])("gates coherent terminal cleanup by provenance %s", async (terminalProvenance, expectedCalls) => {
    const success = vi.fn();
    const sse = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const result = await handleStreamingResponse({
      ...context(success, terminalProvenance),
      providerResponse: new Response(sse, { headers: { "content-type": "text/event-stream" } }),
    });
    await result.response.text();
    await Promise.resolve();
    expect(success).toHaveBeenCalledTimes(expectedCalls);
  });

  it("does not clear on clean EOF without an upstream terminal", async () => {
    const success = vi.fn();
    const partial = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] })}\n\n`;
    const result = await handleStreamingResponse({
      ...context(success),
      providerResponse: new Response(partial, { status: 200, headers: { "content-type": "text/event-stream" } }),
    });
    await result.response.text();
    await Promise.resolve();
    expect(success).not.toHaveBeenCalled();
  });
});
