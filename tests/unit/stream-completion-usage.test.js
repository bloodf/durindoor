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

async function readFrame(reader) {
  const decoder = new TextDecoder();
  let text = "";
  while (!text.endsWith("\n\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
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

  it("builds an OpenAI Responses summary from late response events", async () => {
    const onComplete = vi.fn();
    const transform = createSSETransformStreamWithLogger(
      FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, "openai", null, null, "gpt-test", "connection-1",
      { input: "hello" }, onComplete, "sk-test",
    );

    await pipeText(transform, [
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "late answer" })}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", model: "gpt-test", status: "completed", output: [], usage: { input_tokens: 3, output_tokens: 2 } } })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    expect(onComplete.mock.calls[0][3]).toMatchObject({
      providerResponse: {
        id: "resp_1",
        object: "response",
        status: "completed",
        output: [{ content: [{ type: "output_text", text: "late answer" }] }],
        usage: { input_tokens: 3, output_tokens: 2 },
      },
    });
  });

  it("builds a Claude summary including delayed tool input and usage", async () => {
    const onComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "anthropic", null, null, "claude-test", "connection-1", {}, onComplete, null, FORMATS.CLAUDE,
    );

    await pipeText(transform, [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_1", model: "claude-test", role: "assistant", usage: { input_tokens: 5 } } })}\n\n`,
      `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_1", name: "weather", input: {} } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"city\":\"Paris\"}" } })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 4 } })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ]);

    expect(onComplete.mock.calls[0][3]).toMatchObject({
      providerResponse: {
        id: "msg_1",
        type: "message",
        model: "claude-test",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tool_1", name: "weather", input: { city: "Paris" } }],
        usage: { input_tokens: 5, output_tokens: 4 },
      },
    });
  });

  it("builds a Gemini summary from late terminal candidates and usage metadata", async () => {
    const onComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "gemini", null, null, "gemini-test", "connection-1", {}, onComplete, null, FORMATS.GEMINI,
    );

    await pipeText(transform, [
      `data: ${JSON.stringify({ modelVersion: "gemini-test", candidates: [{ content: { role: "model", parts: [{ text: "late " }] } }] })}\n\n`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "answer" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } })}\n\n`,
    ]);

    expect(onComplete.mock.calls[0][3]).toMatchObject({
      providerResponse: {
        modelVersion: "gemini-test",
        candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "late answer" }] } }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
      },
    });
  });

  it("ingests unterminated passthrough usage and tool metadata into the provider summary", async () => {
    const onComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "openai", null, null, "gpt-test", "connection-1", {}, onComplete,
    );

    await pipeText(transform, [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "tail", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "weather", arguments: "{\"city\":\"Paris\"}" } }] }, finish_reason: "tool_calls" }], usage: { total_tokens: 3 } })}`,
    ]);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toMatchObject({ content: "tail" });
    expect(onComplete.mock.calls[0][1]).toMatchObject({ total_tokens: 3 });
    expect(onComplete.mock.calls[0][3]).toMatchObject({
      providerResponse: {
        usage: { total_tokens: 3 },
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: "tail",
            tool_calls: [{ id: "call_1", function: { name: "weather", arguments: "{\"city\":\"Paris\"}" } }],
          },
        }],
      },
    });
  });

  it("caps the number of scalar usage fields in the provider summary", async () => {
    const onComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "openai", null, null, "gpt-test", "connection-1", {}, onComplete,
    );

    const hugeUsage = {};
    for (let i = 0; i < 200; i++) hugeUsage[`k_${i}`] = i;

    await pipeText(transform, [
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: hugeUsage })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    const providerResponse = onComplete.mock.calls[0][3].providerResponse;
    expect(Object.keys(providerResponse.usage)).toHaveLength(64);
    expect(providerResponse.usage.k_0).toBe(0);
    expect(providerResponse.usage.k_63).toBe(63);
  });

  it("composes Responses function calls from incremental tool events", async () => {
    const onComplete = vi.fn();
    const transform = createSSETransformStreamWithLogger(
      FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, "openai", null, null, "gpt-test", "connection-1",
      { input: "hello" }, onComplete, "sk-test",
    );

    await pipeText(transform, [
      `event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { id: "fc_1", type: "function_call", call_id: "call_1", name: "weather", arguments: "" } })}\n\n`,
      `event: response.function_call_arguments.delta\ndata: ${JSON.stringify({ type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: "{\"city\":" })}\n\n`,
      `event: response.function_call_arguments.done\ndata: ${JSON.stringify({ type: "response.function_call_arguments.done", item_id: "fc_1", output_index: 0, arguments: "{\"city\":\"Paris\"}" })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    expect(onComplete.mock.calls[0][3]).toMatchObject({
      providerResponse: {
        output: [{ id: "fc_1", type: "function_call", call_id: "call_1", name: "weather", arguments: "{\"city\":\"Paris\"}" }],
      },
    });
  });

  it("defers Gemini completion until trailing usage and tool parts arrive", async () => {
    const onComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "gemini", null, null, "gemini-test", "connection-1", {}, onComplete, null, FORMATS.GEMINI,
    );
    const writer = transform.writable.getWriter();
    const reader = transform.readable.getReader();
    const firstWrite = writer.write(encoder.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "answer" }] }, finishReason: "STOP" }] })}\n\n`));
    await readFrame(reader);
    await firstWrite;
    expect(onComplete).not.toHaveBeenCalled();
    const secondWrite = writer.write(encoder.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "weather", args: { city: "Paris" } } }] } }], usageMetadata: { promptTokenCount: 3 } })}\n\n`));
    await readFrame(reader);
    await secondWrite;
    const close = writer.close();
    await reader.read();
    await close;

    expect(onComplete.mock.calls[0][3]).toMatchObject({
      providerResponse: { usageMetadata: { promptTokenCount: 3 }, candidates: [{ content: { parts: [{ text: "answer" }, { functionCall: { name: "weather" } }] } }] },
    });
  });

  it("finalizes translated Gemini summaries after trailing usage and tool parts", async () => {
    const onComplete = vi.fn();
    const transform = createSSETransformStreamWithLogger(
      FORMATS.GEMINI, FORMATS.OPENAI, "gemini", null, null, "gemini-test", "connection-1", {}, onComplete, null,
    );

    await pipeText(transform, [
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "answer" }] }, finishReason: "STOP" }] })}\n\n`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "weather", args: { city: "Paris" } } }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } })}\n\n`,
    ]);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][3]).toMatchObject({
      providerResponse: {
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
        candidates: [{ content: { parts: [{ text: "answer" }, { functionCall: { name: "weather", args: { city: "Paris" } } }] } }],
      },
    });
  });

  it("unwraps Antigravity Gemini responses for provider diagnostics", async () => {
    const onComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "antigravity", null, null, "gemini-test", "connection-1", {}, onComplete, null, FORMATS.ANTIGRAVITY,
    );

    await pipeText(transform, [
      `data: ${JSON.stringify({ response: { modelVersion: "gemini-test", candidates: [{ content: { parts: [{ text: "wrapped" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 2 } } })}\n\n`,
    ]);

    expect(onComplete.mock.calls[0][3]).toMatchObject({
      providerResponse: { modelVersion: "gemini-test", usageMetadata: { promptTokenCount: 2 }, candidates: [{ content: { parts: [{ text: "wrapped" }] } }] },
    });
  });

  it("bounds retained provider summary fields during long streams", async () => {
    const onComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "openai", null, null, "gpt-test", "connection-1", {}, onComplete,
    );
    const oversized = "x".repeat(70 * 1024);
    const toolCalls = Array.from({ length: 65 }, (_, index) => ({ index, id: `call_${index}`, type: "function", function: { name: "tool", arguments: "{}" } }));

    await pipeText(transform, [
      `data: ${JSON.stringify({ model: "m".repeat(1024), choices: [{ delta: { content: oversized, tool_calls: toolCalls }, finish_reason: "tool_calls" }], usage: { total_tokens: 1 } })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    const summary = onComplete.mock.calls[0][3].providerResponse;
    expect(summary.model.length).toBeLessThanOrEqual(256);
    expect(summary.choices[0].message.content.length).toBeLessThanOrEqual(64 * 1024);
    expect(summary.choices[0].message.tool_calls).toHaveLength(64);
  });

  it("rejects oversized Gemini function arguments without inventing fields", async () => {
    const onComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "gemini", null, null, "gemini-test", "connection-1", {}, onComplete, null, FORMATS.GEMINI,
    );

    await pipeText(transform, [
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "weather", args: { city: "x".repeat(16 * 1024) } } }] } }] })}\n\n`,
    ]);

    expect(onComplete.mock.calls[0][3]).toMatchObject({
      providerResponse: { candidates: [{ content: { parts: [{ functionCall: { name: "weather", args: {} } }] } }] },
    });
  });
});
