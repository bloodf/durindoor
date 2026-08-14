// OpenAI finish chunks are not terminal for accounting: include_usage streams
// may emit one final usage-only chunk. Gemini terminal candidates, by contrast,
// can complete without a [DONE] sentinel.
import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import {
  createPassthroughStreamWithLogger,
  createSSETransformStreamWithLogger,
} from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));

const encoder = new TextEncoder();

async function pipeText(transform, chunks) {
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(source.pipeThrough(transform)).text();
}

describe("SSE completion accounting", () => {
  it("waits for trailing OpenAI usage after finish_reason in passthrough mode", async () => {
    const onComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "openai", null, null, "gpt-test", "connection-1",
      { messages: [{ role: "user", content: "hello" }] }, onComplete, "sk-test",
    );

    const text = await pipeText(transform, [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "answer" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][1]).toMatchObject({
      prompt_tokens: 12,
      completion_tokens: 4,
      total_tokens: 16,
    });
    expect(onComplete.mock.calls[0][1].estimated).toBeUndefined();
    expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("waits for trailing OpenAI usage after finish_reason in translate mode", async () => {
    const onComplete = vi.fn();
    const transform = createSSETransformStreamWithLogger(
      FORMATS.OPENAI, FORMATS.CLAUDE, "openai", null, null, "gpt-test", "connection-1",
      { messages: [{ role: "user", content: "hello" }] }, onComplete, "sk-test",
    );

    await pipeText(transform, [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "answer" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][1]).toMatchObject({
      prompt_tokens: 12,
      completion_tokens: 4,
      total_tokens: 16,
    });
    expect(onComplete.mock.calls[0][1].estimated).toBeUndefined();
  });

  it("keeps late provider terminal metadata in an incremental OpenAI summary", async () => {
    const onComplete = vi.fn();
    const transform = createSSETransformStreamWithLogger(
      FORMATS.OPENAI, FORMATS.CLAUDE, "openai", null, null, "gpt-test", "connection-1",
      { messages: [{ role: "user", content: "hello" }] }, onComplete, "sk-test",
    );

    await pipeText(transform, [
      `data: ${JSON.stringify({ id: "chatcmpl-1", model: "gpt-test", choices: [{ delta: { reasoning_content: "think " }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "answer", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "weather", arguments: "{\"city\":" } }] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"Paris\"}" } }] }, finish_reason: "tool_calls" }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][3]).toMatchObject({
      providerResponse: {
        object: "chat.completion",
        model: "gpt-test",
        usage: { total_tokens: 16 },
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: "answer",
            reasoning_content: "think",
            tool_calls: [{ id: "call_1", function: { name: "weather", arguments: "{\"city\":\"Paris\"}" } }],
          },
        }],
      },
    });
  });

  it("recognizes direct Gemini candidates as an early terminal shape", async () => {
    const onComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "gemini", null, null, "gemini-test", "connection-1", {}, onComplete, null,
    );
    const writer = transform.writable.getWriter();
    const reader = transform.readable.getReader();
    const write = writer.write(encoder.encode(
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "answer" }] }, finishReason: "STOP" }] })}\n\n`,
    ));
    await reader.read();
    await write;

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toMatchObject({ content: "answer" });
    expect(onComplete.mock.calls[0][1]).toMatchObject({ estimated: true });
    await writer.abort();
  });

  it("does not append an OpenAI [DONE] sentinel for gemini-cli passthrough", async () => {
    const transform = createPassthroughStreamWithLogger("gemini-cli", null, null, "gemini-test");
    const text = await pipeText(transform, [
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "answer" }] }, finishReason: "STOP" }] })}\n\n`,
    ]);
    expect(text).toContain("answer");
    expect(text).not.toContain("data: [DONE]");
  });

  it("normalizes an unterminated passthrough [DONE] without duplicating it", async () => {
    const transform = createPassthroughStreamWithLogger("openai", null, null, "gpt-test");
    const text = await pipeText(transform, ["data: [DONE]"]);

    expect(text).toBe("data: [DONE]\n\n");
    expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
  });
});
