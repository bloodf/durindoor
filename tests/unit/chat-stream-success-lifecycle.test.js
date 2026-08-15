import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  buildOnStreamComplete,
  handleStreamingResponse,
} from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";
import { saveRequestDetail } from "@/lib/usageDb.js";

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

  it("persists capped provider summary after an unterminated stream event", async () => {
    const hugeUsage = {};
    for (let i = 0; i < 200; i++) hugeUsage[`k_${i}`] = i;
    const event = `data: ${JSON.stringify({ choices: [{ delta: { content: "tail", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "weather", arguments: "{}" } }] }, finish_reason: "tool_calls" }], usage: hugeUsage })}`;
    const result = await handleStreamingResponse({
      ...context(vi.fn()),
      providerResponse: new Response(event, { status: 200, headers: { "content-type": "text/event-stream" } }),
    });
    await result.response.text();
    await Promise.resolve();

    const detail = saveRequestDetail.mock.calls.at(-1)[0];
    expect(detail.response.content).toBe("tail");
    expect(detail.tokens).toMatchObject({ k_0: 0, k_63: 63 });
    expect(Object.keys(detail.providerResponse.usage)).toHaveLength(64);
    expect(detail.providerResponse.choices[0]).toMatchObject({ finish_reason: "tool_calls" });
  });
});
